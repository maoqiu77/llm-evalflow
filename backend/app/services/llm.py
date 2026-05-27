import json
import time
from typing import Any, Optional

from openai import OpenAI

from ..config import AVAILABLE_MODELS, settings


def get_client() -> Optional[OpenAI]:
    if not settings.liaobots_api_key:
        return None
    return OpenAI(
        api_key=settings.liaobots_api_key,
        base_url=settings.liaobots_base_url,
        timeout=settings.llm_timeout_seconds,
    )


def generate_answer(model: str, question: str, system_prompt: str = "") -> dict[str, Any]:
    if model not in AVAILABLE_MODELS:
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


def judge_answer(question: str, expected_answer: str, model_answer: str, model: str = "gpt-5.4") -> dict[str, Any]:
    client = get_client()
    if client is None:
        return heuristic_judge(model_answer)

    prompt = f"""你是大模型问答评测员。请根据用户问题、期望答案和模型回答，从准确性、完整性、指令遵循、可执行性、格式稳定性、用户体验六个维度分别打 1-5 分，并给出简短理由。
最后判断是否为 Badcase，并归因到一个主要类型：事实错误、答非所问、信息遗漏、指令不遵循、格式不稳定、场景理解错误、安全边界过度、安全边界不足。

用户问题：{question}
期望答案：{expected_answer}
模型回答：{model_answer}

只输出 JSON，字段包括 accuracy, completeness, instruction_following, actionability, format_stability, user_experience, is_badcase, badcase_type, reason, suggestion。"""
    resp = client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}])
    text = resp.choices[0].message.content or "{}"
    try:
        return json.loads(text.strip().strip("```json").strip("```"))
    except json.JSONDecodeError:
        judged = heuristic_judge(model_answer)
        judged["reason"] = f"自动评审 JSON 解析失败，已使用启发式评分。原始返回：{text[:200]}"
        return judged


def heuristic_judge(model_answer: str) -> dict[str, Any]:
    length = len(model_answer.strip())
    base = 4 if length >= 120 else 3 if length >= 50 else 2
    bad = base < 3
    return {
        "accuracy": base,
        "completeness": base,
        "instruction_following": min(base + 1, 5),
        "actionability": base,
        "format_stability": 4 if "\n" in model_answer or "1" in model_answer else 3,
        "user_experience": base,
        "is_badcase": bad,
        "badcase_type": "信息遗漏" if bad else "无",
        "reason": "未配置 API Key，使用回答长度和结构进行启发式评分。",
        "suggestion": "配置 API Key 后使用大模型自动评审；低分回答建议补充关键步骤、限制条件和输出结构。",
    }
