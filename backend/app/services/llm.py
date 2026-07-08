from __future__ import annotations

import json
import re
import time
from typing import Any, Optional

from openai import OpenAI

from ..config import get_available_models, get_llm_api_key, get_llm_base_url, settings

DEFAULT_JUDGE_MODEL = "gpt-5.4"
BACKUP_JUDGE_MODEL = "gemini-3.5-flash"


def get_client(api_key: str | None = None, base_url: str | None = None) -> Optional[OpenAI]:
    resolved_api_key = api_key if api_key is not None else get_llm_api_key()
    resolved_base_url = base_url or get_llm_base_url()
    if not resolved_api_key:
        return None
    return OpenAI(
        api_key=resolved_api_key,
        base_url=resolved_base_url,
        timeout=settings.llm_timeout_seconds,
    )


def generate_answer(model: str, question: str, system_prompt: str = "") -> dict[str, Any]:
    if model not in get_available_models():
        raise ValueError(f"不支持的模型：{model}")

    started = time.perf_counter()
    client = get_client()
    if client is None:
        return {
            "answer": f"[模拟回答/{model}] 已收到问题：{question}。请在 backend/.env 配置 LIAOBOTS_API_KEY 后调用真实模型。",
            "response_time_ms": int((time.perf_counter() - started) * 1000),
            "mock": True,
        }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": question})
    stream = client.chat.completions.create(model=model, messages=messages, stream=True)
    chunks = []
    for event in stream:
        if event.choices and event.choices[0].delta.content:
            chunks.append(event.choices[0].delta.content)
    return {
        "answer": "".join(chunks),
        "response_time_ms": int((time.perf_counter() - started) * 1000),
        "mock": False,
    }


def judge_answer(
    question: str,
    expected_answer: str,
    model_answer: str,
    model: str = DEFAULT_JUDGE_MODEL,
    answer_model: str = "",
) -> dict[str, Any]:
    hard_judgement = deterministic_judge(question, expected_answer, model_answer)
    if hard_judgement:
        return hard_judgement

    client = get_client()
    if client is None:
        return heuristic_judge(question, expected_answer, model_answer)

    judge_model = resolve_judge_model(model, answer_model)

    prompt = f"""你是独立的大模型问答评审员，不是被评模型。请严格对照“用户问题”和“期望答案/期望行为”评分，不要因为回答礼貌、篇幅长或格式清晰就给保底中分。

评分维度均为 1-5 分：
- 准确性：是否符合事实、工具能力边界和业务约束。
- 完整性：是否覆盖期望答案里的所有关键步骤、限制和前置条件。
- 指令遵循：是否按用户原始任务作答，没有擅自改成泛泛建议。
- 可执行性：是否给出可落地步骤；需要实时工具/提醒工具时，是否明确说明能力限制或调用结果。
- 格式稳定性：结构是否清晰，是否输出报错、伪工具调用、残缺 JSON/XML。
- 用户体验：语气、风险提示和澄清是否适合真实产品。

硬性扣分规则：
1. 回答是调用失败、超时、异常堆栈或空回答：准确性/完整性/指令遵循/可执行性/用户体验必须为 1，格式稳定性最高 2。
2. 只输出工具调用、伪 XML/JSON 调用，未给用户可读结论：准确性、完整性、指令遵循、可执行性最高 2，格式稳定性最高 2。
3. 期望答案要求实时查询、提醒创建、票务/天气/酒店等工具能力时，如果模型没有真实工具结果，只能说明限制并给下一步；不能编造具体天气、车次、价格、余票等。
4. 多步骤任务缺一项时，完整性和可执行性最高 3；关键步骤缺失时最高 2。
5. 低分不等于苛刻：明显不满足期望行为的回答，即使表达自然，也应标记 Badcase。

Badcase 类型只能从以下枚举选择：事实错误、答非所问、信息遗漏、指令不遵循、格式不稳定、场景理解错误、安全边界过度、安全边界不足。

用户问题：{question}
期望答案：{expected_answer}
模型回答：{model_answer}

只输出 JSON，字段包括 accuracy, completeness, instruction_following, actionability, format_stability, user_experience, is_badcase, badcase_type, reason, suggestion。reason 必须说明关键扣分依据。"""
    resp = client.chat.completions.create(model=judge_model, messages=[{"role": "user", "content": prompt}])
    text = resp.choices[0].message.content or "{}"
    try:
        judged = json.loads(extract_json(text))
    except json.JSONDecodeError:
        judged = heuristic_judge(question, expected_answer, model_answer)
        judged["reason"] = f"自动评审 JSON 解析失败，已使用规则化启发式评分。原始返回：{text[:200]}"
    judged = apply_policy_caps(question, expected_answer, model_answer, judged)
    judged["reason"] = f"评审模型：{judge_model}。{judged.get('reason', '')}"
    judged["judge_model"] = judge_model
    return judged


def resolve_judge_model(requested_model: str, answer_model: str = "") -> str:
    if answer_model and requested_model == answer_model:
        for model in get_available_models():
            if model != answer_model:
                return model
        if BACKUP_JUDGE_MODEL != answer_model:
            return BACKUP_JUDGE_MODEL
    return requested_model or DEFAULT_JUDGE_MODEL


def redact_secret(text: str, *secrets: str) -> str:
    safe = text
    for secret in secrets:
        if secret:
            safe = safe.replace(secret, "[已移除 API key]")
    return safe


def test_llm_connection(*, base_url: str, api_key: str, model: str) -> dict[str, Any]:
    if not api_key:
        raise ValueError("请先填写 API Key。")
    if not model:
        raise ValueError("请先选择测试模型。")
    client = get_client(api_key=api_key, base_url=base_url)
    if client is None:
        raise ValueError("请先填写 API Key。")
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "请只回复 ok，用于测试接口连通性。"}],
        max_tokens=8,
    )
    text = resp.choices[0].message.content or ""
    return {"ok": True, "model": model, "message": text.strip()[:100]}


def extract_json(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        return stripped[start:end + 1]
    return stripped


def score_payload(
    *,
    accuracy: int,
    completeness: int,
    instruction_following: int,
    actionability: int,
    format_stability: int,
    user_experience: int,
    badcase_type: str,
    reason: str,
    suggestion: str,
) -> dict[str, Any]:
    scores = [accuracy, completeness, instruction_following, actionability, format_stability, user_experience]
    is_badcase = round(sum(scores) / len(scores), 2) < 3.5 or min(scores) < 3
    return {
        "accuracy": accuracy,
        "completeness": completeness,
        "instruction_following": instruction_following,
        "actionability": actionability,
        "format_stability": format_stability,
        "user_experience": user_experience,
        "is_badcase": is_badcase,
        "badcase_type": badcase_type if is_badcase else "无",
        "reason": reason,
        "suggestion": suggestion,
        "judge_model": "规则评分",
    }


def deterministic_judge(question: str, expected_answer: str, model_answer: str) -> Optional[dict[str, Any]]:
    answer = model_answer.strip()
    lowered = answer.lower()
    if not answer:
        return score_payload(
            accuracy=1,
            completeness=1,
            instruction_following=1,
            actionability=1,
            format_stability=1,
            user_experience=1,
            badcase_type="答非所问",
            reason="硬规则：模型回答为空，无法满足任何评测要求。",
            suggestion="需要返回可读回答；如缺少工具能力，应明确说明限制并给出下一步。",
        )
    if any(token in lowered for token in ["[调用失败/", "readtimeout", "timed out", "apierror", "connectionerror", "traceback"]):
        return score_payload(
            accuracy=1,
            completeness=1,
            instruction_following=1,
            actionability=1,
            format_stability=2,
            user_experience=1,
            badcase_type="格式不稳定",
            reason="硬规则：回答暴露调用失败、超时或接口异常，用户没有得到可用结果。",
            suggestion="对调用失败做重试或降级兜底，不要把底层异常直接作为模型回答展示。",
        )
    if looks_like_unresolved_tool_call(answer):
        return score_payload(
            accuracy=2,
            completeness=1,
            instruction_following=2,
            actionability=1,
            format_stability=1,
            user_experience=2,
            badcase_type="格式不稳定",
            reason="硬规则：回答停留在工具调用/XML/JSON 片段，没有给用户可读结论或能力限制说明。",
            suggestion="工具未实际执行时，应说明当前无法获得实时结果，并给出用户下一步操作或所需授权。",
        )
    return None


def looks_like_unresolved_tool_call(answer: str) -> bool:
    lowered = answer.lower().strip()
    tool_markers = ["<search_web>", "</search_web>", "<query>", "</query>", '"name": "get_weather"', "'name': 'get_weather'"]
    if any(marker in lowered for marker in tool_markers):
        return True
    return bool(re.match(r"^`?\s*call\s*\n?\s*[{`]", lowered))


def expected_requires_tool(expected_answer: str) -> bool:
    return any(token in expected_answer for token in ["实时", "工具", "提醒", "票务", "天气", "酒店", "不能编造", "无工具"])


def apply_policy_caps(question: str, expected_answer: str, model_answer: str, judged: dict[str, Any]) -> dict[str, Any]:
    answer = model_answer.strip()
    answer_has_limitation = any(token in answer for token in ["无法", "不能", "没有权限", "不能直接联网", "无法实时", "无实时"])
    cap_reasons = []

    if expected_requires_tool(expected_answer) and answer_has_limitation:
        judged["completeness"] = min(int(judged.get("completeness", 3)), 3)
        judged["actionability"] = min(int(judged.get("actionability", 3)), 3)
        cap_reasons.append("需要实时/外部工具的任务只说明限制时，完整性和可执行性最高为 3")

    reminder_required = "提醒" in question or "提醒" in expected_answer
    reminder_handled = any(token in answer for token in ["提醒", "闹钟", "日程", "通知", "待办", "无法创建", "不能创建", "提醒工具"])
    if reminder_required and not reminder_handled:
        judged["completeness"] = min(int(judged.get("completeness", 3)), 2)
        judged["actionability"] = min(int(judged.get("actionability", 3)), 2)
        cap_reasons.append("用户要求提醒创建，但回答没有处理提醒步骤")

    if "不能编造" in expected_answer and not answer_has_limitation and mentions_concrete_realtime_result(answer):
        judged["accuracy"] = min(int(judged.get("accuracy", 3)), 2)
        judged["badcase_type"] = "事实错误"
        cap_reasons.append("期望要求不能编造实时数据，但回答给出了疑似具体实时结果")

    for key in ["accuracy", "completeness", "instruction_following", "actionability", "format_stability", "user_experience"]:
        judged[key] = max(1, min(5, int(judged.get(key, 3))))

    scores = [judged[key] for key in ["accuracy", "completeness", "instruction_following", "actionability", "format_stability", "user_experience"]]
    judged["is_badcase"] = bool(judged.get("is_badcase")) or round(sum(scores) / len(scores), 2) < 3.5 or min(scores) < 3
    if judged["is_badcase"] and judged.get("badcase_type") in [None, "", "无"]:
        judged["badcase_type"] = "信息遗漏"
    if cap_reasons:
        judged["reason"] = f"{judged.get('reason', '')} 规则校准：{'；'.join(cap_reasons)}。".strip()
    return judged


def mentions_concrete_realtime_result(answer: str) -> bool:
    weather_words = ["小雨", "中雨", "大雨", "阵雨", "雷阵雨", "晴", "多云", "气温", "降雨概率", "℃"]
    traffic_words = ["车次", "余票", "出发", "到达", "二等座", "一等座", "¥", "元"]
    hotel_words = ["每晚", "评分", "取消政策", "价格"]
    return any(word in answer for word in weather_words + traffic_words + hotel_words)


def heuristic_judge(question: str, expected_answer: str, model_answer: str) -> dict[str, Any]:
    hard_judgement = deterministic_judge(question, expected_answer, model_answer)
    if hard_judgement:
        return hard_judgement
    length = len(model_answer.strip())
    base = 4 if length >= 120 else 3 if length >= 50 else 2
    bad = base < 3
    result = {
        "accuracy": base,
        "completeness": base,
        "instruction_following": min(base + 1, 5),
        "actionability": base,
        "format_stability": 4 if "\n" in model_answer or "1" in model_answer else 3,
        "user_experience": base,
        "is_badcase": bad,
        "badcase_type": "信息遗漏" if bad else "无",
        "reason": "未配置 API Key，使用规则化启发式评分。",
        "suggestion": "配置 API Key 后使用独立评审模型；低分回答建议补充关键步骤、限制条件和输出结构。",
    }
    return apply_policy_caps(question, expected_answer, model_answer, result)
