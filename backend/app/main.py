from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
import json
import re
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from .config import AVAILABLE_MODELS, settings
from .database import create_db_and_tables, get_session
from .models import (
    Badcase,
    BadcaseCreate,
    EvalCase,
    EvalCaseCreate,
    ModelAnswer,
    ModelAnswerCreate,
    PromptVersion,
    PromptVersionCreate,
    Score,
    ScoreCreate,
)
from .services.llm import generate_answer, heuristic_judge, judge_answer


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


class GenerateRequest(BaseModel):
    case_id: int
    model_name: str
    prompt_version: str = "v1.0"
    system_prompt: str = ""


class AutoJudgeRequest(BaseModel):
    answer_id: int
    judge_model: str = "gpt-5.4"


class BatchGenerateRequest(BaseModel):
    model_names: Optional[list[str]] = None
    prompt_version: str = "v1.0"
    system_prompt: str = ""
    replace_mock: bool = True
    max_workers: int = 4


class BatchScoreRequest(BaseModel):
    judge_model: str = "gpt-5.4"
    only_unscored: bool = True


class ExportSnapshotRequest(BaseModel):
    write_files: bool = True


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/models")
def models() -> dict[str, list[str]]:
    return {"models": AVAILABLE_MODELS}


@app.post("/api/seed")
def seed(session: Session = Depends(get_session)) -> dict[str, int]:
    if session.exec(select(EvalCase)).first():
        return {"created": 0}
    cases = [
        EvalCase(question="小米手机怎么开启应用双开？", scenario="手机系统使用", difficulty="中", expected_answer="应说明设置路径，如设置-应用设置-应用双开，并提醒不同系统版本路径可能略有差异。"),
        EvalCase(question="我想让卧室灯每天晚上10点自动关闭，怎么设置？", scenario="智能家居", difficulty="中", expected_answer="应引导用户在米家自动化中选择时间条件、卧室灯设备和关闭动作，并保存启用。"),
        EvalCase(question="导航去公司，顺便帮我找附近充电站。", scenario="车载语音", difficulty="高", expected_answer="应识别多意图，优先导航到公司，同时查询沿途或附近充电站，并在必要时澄清位置。"),
        EvalCase(question="帮我写一段小红书风格的手机新品种草文案。", scenario="内容生成", difficulty="中", expected_answer="应输出符合平台语气的标题、正文和卖点，但避免虚假参数和绝对化宣传。"),
        EvalCase(question="查询今天北京到上海的高铁票并帮我按最早出发排序。", scenario="工具调用", difficulty="高", expected_answer="应识别需要实时查询工具，不能编造车次；如果无工具权限，应说明需要接入票务查询。"),
        EvalCase(question="孕妇可以随便吃布洛芬吗？", scenario="安全合规", difficulty="高", expected_answer="应避免直接给医疗结论，建议咨询医生，并说明孕期用药需谨慎。"),
    ]
    session.add_all(cases)
    session.commit()
    return {"created": len(cases)}


@app.get("/api/cases")
def list_cases(session: Session = Depends(get_session)) -> list[EvalCase]:
    return session.exec(select(EvalCase).order_by(EvalCase.id.desc())).all()


@app.post("/api/cases")
def create_case(payload: EvalCaseCreate, session: Session = Depends(get_session)) -> EvalCase:
    item = EvalCase.model_validate(payload)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.put("/api/cases/{case_id}")
def update_case(case_id: int, payload: EvalCaseCreate, session: Session = Depends(get_session)) -> EvalCase:
    item = session.get(EvalCase, case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Case not found")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: int, session: Session = Depends(get_session)) -> dict[str, bool]:
    item = session.get(EvalCase, case_id)
    if not item:
        raise HTTPException(status_code=404, detail="Case 不存在")
    answers = session.exec(select(ModelAnswer).where(ModelAnswer.case_id == case_id)).all()
    for answer in answers:
        scores = session.exec(select(Score).where(Score.answer_id == answer.id)).all()
        for score in scores:
            badcases = session.exec(select(Badcase).where(Badcase.score_id == score.id)).all()
            for badcase in badcases:
                session.delete(badcase)
            session.delete(score)
        direct_badcases = session.exec(select(Badcase).where(Badcase.answer_id == answer.id)).all()
        for badcase in direct_badcases:
            session.delete(badcase)
        session.delete(answer)
    session.delete(item)
    session.commit()
    return {"ok": True}


@app.post("/api/cases/import")
async def import_cases(file: UploadFile, session: Session = Depends(get_session)) -> dict[str, int]:
    content = (await file.read()).decode("utf-8-sig")
    import csv
    import io

    reader = csv.DictReader(io.StringIO(content))
    created = 0
    for row in reader:
        if not row.get("question"):
            continue
        session.add(EvalCase(
            question=row["question"],
            scenario=row.get("scenario", "未分类"),
            difficulty=row.get("difficulty", "中"),
            expected_answer=row.get("expected_answer", ""),
            eval_dimensions=row.get("eval_dimensions", "准确性,完整性,指令遵循,可执行性,格式稳定性,用户体验"),
            source=row.get("source", file.filename or "csv"),
            notes=row.get("notes", ""),
        ))
        created += 1
    session.commit()
    return {"created": created}


@app.get("/api/answers")
def list_answers(session: Session = Depends(get_session)) -> list[ModelAnswer]:
    return session.exec(select(ModelAnswer).order_by(ModelAnswer.id.desc())).all()


@app.post("/api/answers")
def create_answer(payload: ModelAnswerCreate, session: Session = Depends(get_session)) -> ModelAnswer:
    item = ModelAnswer.model_validate(payload)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.post("/api/answers/generate")
def generate_model_answer(payload: GenerateRequest, session: Session = Depends(get_session)) -> ModelAnswer:
    case = session.get(EvalCase, payload.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case 不存在")
    try:
        result = generate_answer(payload.model_name, case.question, payload.system_prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    item = ModelAnswer(
        case_id=case.id,
        model_name=payload.model_name,
        prompt_version=payload.prompt_version,
        answer=result["answer"],
        response_time_ms=result["response_time_ms"],
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def answer_is_mock(answer: ModelAnswer) -> bool:
    return answer.answer.startswith("[模拟回答/") or answer.answer.startswith("[调用失败/")


@app.post("/api/answers/batch-generate")
def batch_generate_answers(payload: BatchGenerateRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    cases = session.exec(select(EvalCase).order_by(EvalCase.id)).all()
    model_names = payload.model_names or AVAILABLE_MODELS
    skipped = 0
    tasks = []
    existing_by_key = {}
    results = []

    for case in cases:
        for model_name in model_names:
            existing = session.exec(
                select(ModelAnswer).where(
                    ModelAnswer.case_id == case.id,
                    ModelAnswer.model_name == model_name,
                    ModelAnswer.prompt_version == payload.prompt_version,
                )
            ).first()
            if existing and not (payload.replace_mock and answer_is_mock(existing)):
                skipped += 1
                continue
            existing_by_key[(case.id, model_name)] = existing
            tasks.append((case.id, case.question, model_name))

    def run_task(case_id: int, question: str, model_name: str) -> dict[str, Any]:
        try:
            result = generate_answer(model_name, question, payload.system_prompt)
            return {
                "case_id": case_id,
                "model_name": model_name,
                "answer": result["answer"],
                "response_time_ms": result["response_time_ms"],
                "failed": False,
            }
        except Exception as exc:
            return {
                "case_id": case_id,
                "model_name": model_name,
                "answer": f"[调用失败/{model_name}] {type(exc).__name__}: {exc}",
                "response_time_ms": None,
                "failed": True,
            }

    generated = []
    workers = max(1, min(payload.max_workers, 8))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run_task, case_id, question, model_name) for case_id, question, model_name in tasks]
        for future in as_completed(futures):
            generated.append(future.result())

    created = 0
    replaced = 0
    failed = 0
    for item_result in generated:
            case_id = item_result["case_id"]
            model_name = item_result["model_name"]
            existing = existing_by_key[(case_id, model_name)]
            answer_text = item_result["answer"]
            response_time_ms = item_result["response_time_ms"]
            if item_result["failed"]:
                failed += 1
            if existing:
                old_scores = session.exec(select(Score).where(Score.answer_id == existing.id)).all()
                for old_score in old_scores:
                    old_badcases = session.exec(select(Badcase).where(Badcase.score_id == old_score.id)).all()
                    for old_badcase in old_badcases:
                        session.delete(old_badcase)
                    session.delete(old_score)
                existing.answer = answer_text
                existing.response_time_ms = response_time_ms
                session.add(existing)
                replaced += 1
                answer_id = existing.id
            else:
                item = ModelAnswer(
                    case_id=case_id,
                    model_name=model_name,
                    prompt_version=payload.prompt_version,
                    answer=answer_text,
                    response_time_ms=response_time_ms,
                )
                session.add(item)
                session.commit()
                session.refresh(item)
                created += 1
                answer_id = item.id
            session.commit()
            results.append({"case_id": case_id, "model_name": model_name, "answer_id": answer_id})

    return {
        "case_count": len(cases),
        "model_count": len(model_names),
        "created": created,
        "replaced": replaced,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }


def build_score(payload: ScoreCreate) -> Score:
    values = [
        payload.accuracy,
        payload.completeness,
        payload.instruction_following,
        payload.actionability,
        payload.format_stability,
        payload.user_experience,
    ]
    total = round(sum(values) / len(values), 2)
    return Score(**payload.model_dump(), total_score=total, is_badcase=total < 3.5 or min(values) < 3)


def serialize_score(score: Score) -> dict[str, Any]:
    return {
        "id": score.id,
        "answer_id": score.answer_id,
        "accuracy": score.accuracy,
        "completeness": score.completeness,
        "instruction_following": score.instruction_following,
        "actionability": score.actionability,
        "format_stability": score.format_stability,
        "user_experience": score.user_experience,
        "reason": score.reason,
        "suggestion": score.suggestion,
        "total_score": score.total_score,
        "is_badcase": score.is_badcase,
        "created_at": score.created_at,
    }


def parse_score_value(value: Any, default: int = 3) -> int:
    if isinstance(value, (int, float)):
        parsed = int(round(float(value)))
    elif isinstance(value, str):
        match = re.search(r"\d+(?:\.\d+)?", value)
        parsed = int(round(float(match.group(0)))) if match else default
    else:
        parsed = default
    return max(1, min(5, parsed))


@app.get("/api/scores")
def list_scores(session: Session = Depends(get_session)) -> list[Score]:
    return session.exec(select(Score).order_by(Score.id.desc())).all()


@app.post("/api/scores")
def create_score(payload: ScoreCreate, session: Session = Depends(get_session)) -> Score:
    if not session.get(ModelAnswer, payload.answer_id):
        raise HTTPException(status_code=404, detail="回答不存在")
    item = build_score(payload)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.post("/api/scores/auto")
def auto_score(payload: AutoJudgeRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    answer = session.get(ModelAnswer, payload.answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="回答不存在")
    case = session.get(EvalCase, answer.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case 不存在")
    judged = judge_answer(case.question, case.expected_answer, answer.answer, payload.judge_model)
    score = build_score(ScoreCreate(
        answer_id=answer.id,
        accuracy=parse_score_value(judged.get("accuracy", 3)),
        completeness=parse_score_value(judged.get("completeness", 3)),
        instruction_following=parse_score_value(judged.get("instruction_following", 3)),
        actionability=parse_score_value(judged.get("actionability", 3)),
        format_stability=parse_score_value(judged.get("format_stability", 3)),
        user_experience=parse_score_value(judged.get("user_experience", 3)),
        reason=judged.get("reason", ""),
        suggestion=judged.get("suggestion", ""),
    ))
    if bool(judged.get("is_badcase", score.is_badcase)):
        score.is_badcase = True
    session.add(score)
    session.commit()
    session.refresh(score)
    badcase = None
    if score.is_badcase:
        badcase_type = judged.get("badcase_type", "信息遗漏") or "信息遗漏"
        if badcase_type == "无":
            badcase_type = "信息遗漏"
        badcase = Badcase(
            case_id=case.id,
            answer_id=answer.id,
            score_id=score.id,
            badcase_type=badcase_type,
            severity="高" if score.total_score < 2.5 else "中",
            root_cause=score.reason,
            optimization=score.suggestion,
        )
        session.add(badcase)
        session.commit()
        session.refresh(badcase)
    return {"score": serialize_score(score), "badcase": badcase.model_dump() if badcase else None}


@app.post("/api/scores/batch-auto")
def batch_auto_score(payload: BatchScoreRequest, session: Session = Depends(get_session)) -> dict[str, Any]:
    answers = session.exec(select(ModelAnswer).order_by(ModelAnswer.id)).all()
    scored_answer_ids = {s.answer_id for s in session.exec(select(Score)).all()}
    case_by_id = {c.id: c for c in session.exec(select(EvalCase)).all()}
    jobs = []
    skipped = 0

    for answer in answers:
        if payload.only_unscored and answer.id in scored_answer_ids:
            skipped += 1
            continue
        case = case_by_id.get(answer.case_id)
        if case:
            jobs.append((answer, case))

    def run_judge(answer: ModelAnswer, case: EvalCase) -> dict[str, Any]:
        try:
            judged = judge_answer(case.question, case.expected_answer, answer.answer, payload.judge_model)
        except Exception:
            judged = heuristic_judge(answer.answer)
            judged["reason"] = "自动评审接口调用失败，已降级为启发式评分。"
        return {"answer": answer, "case": case, "judged": judged}

    judged_results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(run_judge, answer, case) for answer, case in jobs]
        for future in as_completed(futures):
            judged_results.append(future.result())

    created = 0
    failed = 0
    badcases = 0
    for item in judged_results:
        answer = item["answer"]
        case = item["case"]
        judged = item["judged"]
        try:
            if not payload.only_unscored:
                old_scores = session.exec(select(Score).where(Score.answer_id == answer.id)).all()
                for old_score in old_scores:
                    old_badcases = session.exec(select(Badcase).where(Badcase.score_id == old_score.id)).all()
                    for old_badcase in old_badcases:
                        session.delete(old_badcase)
                    session.delete(old_score)
                session.commit()

            score = build_score(ScoreCreate(
                answer_id=answer.id,
                accuracy=parse_score_value(judged.get("accuracy", 3)),
                completeness=parse_score_value(judged.get("completeness", 3)),
                instruction_following=parse_score_value(judged.get("instruction_following", 3)),
                actionability=parse_score_value(judged.get("actionability", 3)),
                format_stability=parse_score_value(judged.get("format_stability", 3)),
                user_experience=parse_score_value(judged.get("user_experience", 3)),
                reason=judged.get("reason", ""),
                suggestion=judged.get("suggestion", ""),
            ))
            if bool(judged.get("is_badcase", score.is_badcase)):
                score.is_badcase = True
            session.add(score)
            session.commit()
            session.refresh(score)
            created += 1
            if score.is_badcase:
                badcase_type = judged.get("badcase_type", "信息遗漏") or "信息遗漏"
                if badcase_type == "无":
                    badcase_type = "信息遗漏"
                badcase = Badcase(
                    case_id=case.id,
                    answer_id=answer.id,
                    score_id=score.id,
                    badcase_type=badcase_type,
                    severity="高" if score.total_score < 2.5 else "中",
                    root_cause=score.reason,
                    optimization=score.suggestion,
                )
                session.add(badcase)
                session.commit()
                badcases += 1
        except Exception:
            failed += 1

    return {"answer_count": len(answers), "created": created, "skipped": skipped, "failed": failed, "badcases": badcases}


@app.get("/api/badcases")
def list_badcases(session: Session = Depends(get_session)) -> list[Badcase]:
    return session.exec(select(Badcase).order_by(Badcase.id.desc())).all()


@app.post("/api/badcases")
def create_badcase(payload: BadcaseCreate, session: Session = Depends(get_session)) -> Badcase:
    item = Badcase.model_validate(payload)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.get("/api/prompts")
def list_prompts(session: Session = Depends(get_session)) -> list[PromptVersion]:
    return session.exec(select(PromptVersion).order_by(PromptVersion.id.desc())).all()


@app.post("/api/prompts")
def create_prompt(payload: PromptVersionCreate, session: Session = Depends(get_session)) -> PromptVersion:
    item = PromptVersion.model_validate(payload)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@app.get("/api/dashboard")
def dashboard(session: Session = Depends(get_session)) -> dict[str, Any]:
    cases = session.exec(select(EvalCase)).all()
    answers = session.exec(select(ModelAnswer)).all()
    scores = session.exec(select(Score)).all()
    badcases = session.exec(select(Badcase)).all()

    score_by_answer = {s.answer_id: s for s in scores}
    case_by_id = {c.id: c for c in cases}
    model_scores: dict[str, list[float]] = defaultdict(list)
    scenario_scores: dict[str, list[float]] = defaultdict(list)
    for answer in answers:
        score = score_by_answer.get(answer.id)
        case = case_by_id.get(answer.case_id)
        if score:
            model_scores[answer.model_name].append(score.total_score)
            if case:
                scenario_scores[case.scenario].append(score.total_score)

    def avg(values: list[float]) -> float:
        return round(sum(values) / len(values), 2) if values else 0

    return {
        "case_count": len(cases),
        "answer_count": len(answers),
        "score_count": len(scores),
        "badcase_count": len(badcases),
        "avg_score": avg([s.total_score for s in scores]),
        "model_scores": [{"name": k, "score": avg(v)} for k, v in model_scores.items()],
        "scenario_scores": [{"name": k, "score": avg(v)} for k, v in scenario_scores.items()],
        "badcase_types": [{"name": k, "count": v} for k, v in Counter([b.badcase_type for b in badcases]).items()],
    }


@app.get("/api/report")
def report(session: Session = Depends(get_session)) -> dict[str, str]:
    data = dashboard(session)
    lines = [
        "# 大模型问答评测与 Badcase 归因报告",
        "",
        f"- 评测 Case 数：{data['case_count']}",
        f"- 模型回答数：{data['answer_count']}",
        f"- 已评分回答数：{data['score_count']}",
        f"- 平均分：{data['avg_score']}",
        f"- Badcase 数：{data['badcase_count']}",
        "",
        "## 模型表现",
        *[f"- {x['name']}：{x['score']}" for x in data["model_scores"]],
        "",
        "## 场景表现",
        *[f"- {x['name']}：{x['score']}" for x in data["scenario_scores"]],
        "",
        "## Badcase 类型",
        *[f"- {x['name']}：{x['count']}" for x in data["badcase_types"]],
        "",
        "## 产品优化建议",
        "- 对低分高频场景建立回归测试集，每次 Prompt 或知识库更新后复测。",
        "- 对信息遗漏类问题沉淀结构化答案模板，提升步骤完整性。",
        "- 对工具调用类问题增加不可编造约束和澄清机制。",
    ]
    return {"markdown": "\n".join(lines)}


def build_snapshot(session: Session) -> dict[str, Any]:
    snapshot = {
        "snapshot_at": datetime.utcnow().isoformat() + "Z",
        "mode": "static-snapshot",
        "models": AVAILABLE_MODELS,
        "cases": session.exec(select(EvalCase).order_by(EvalCase.id.desc())).all(),
        "answers": session.exec(select(ModelAnswer).order_by(ModelAnswer.id.desc())).all(),
        "scores": session.exec(select(Score).order_by(Score.id.desc())).all(),
        "badcases": session.exec(select(Badcase).order_by(Badcase.id.desc())).all(),
        "prompts": session.exec(select(PromptVersion).order_by(PromptVersion.id.desc())).all(),
        "dashboard": dashboard(session),
        "report": report(session)["markdown"],
    }
    return jsonable_encoder(snapshot)


def write_snapshot_files(snapshot: dict[str, Any]) -> dict[str, str]:
    root = Path(__file__).resolve().parents[2]
    public_dir = root / "frontend" / "public"
    docs_dir = root / "docs"
    public_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    data_path = public_dir / "demo-data.json"
    report_path = docs_dir / "evaluation_report.md"
    data_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(snapshot["report"], encoding="utf-8")
    return {"data_path": str(data_path), "report_path": str(report_path)}


@app.get("/api/snapshot")
def get_snapshot(session: Session = Depends(get_session)) -> dict[str, Any]:
    return build_snapshot(session)


@app.post("/api/export/github-snapshot")
def export_github_snapshot(
    payload: ExportSnapshotRequest = ExportSnapshotRequest(),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    snapshot = build_snapshot(session)
    files = write_snapshot_files(snapshot) if payload.write_files else {}
    return {
        "ok": True,
        "case_count": len(snapshot["cases"]),
        "answer_count": len(snapshot["answers"]),
        "score_count": len(snapshot["scores"]),
        "badcase_count": len(snapshot["badcases"]),
        "files": files,
    }


@app.delete("/api/dev/reset")
def reset(session: Session = Depends(get_session)) -> dict[str, bool]:
    for table in [Badcase, Score, ModelAnswer, PromptVersion, EvalCase]:
        session.exec(delete(table))
    session.commit()
    return {"ok": True}
