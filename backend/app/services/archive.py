from __future__ import annotations

from datetime import datetime
from pathlib import Path
import hashlib
import json
from typing import Any, Optional


ARCHIVE_PATH = Path(__file__).resolve().parents[2] / "model_answer_archive.json"


def archive_key(model_name: str, question: str, prompt_version: str = "v1.0", system_prompt: str = "") -> str:
    raw = json.dumps(
        {
            "model_name": model_name,
            "question": question,
            "prompt_version": prompt_version,
            "system_prompt": system_prompt,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_archive() -> dict[str, Any]:
    if not ARCHIVE_PATH.exists():
        return {"version": 1, "answers": {}}
    try:
        data = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": 1, "answers": {}}
    if not isinstance(data, dict):
        return {"version": 1, "answers": {}}
    answers = data.get("answers")
    if not isinstance(answers, dict):
        data["answers"] = {}
    data.setdefault("version", 1)
    return data


def write_archive(data: dict[str, Any]) -> None:
    ARCHIVE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_archived_answer(
    model_name: str,
    question: str,
    prompt_version: str = "v1.0",
    system_prompt: str = "",
) -> Optional[dict[str, Any]]:
    data = load_archive()
    return data["answers"].get(archive_key(model_name, question, prompt_version, system_prompt))


def save_archived_answer(
    *,
    model_name: str,
    question: str,
    answer: str,
    prompt_version: str = "v1.0",
    system_prompt: str = "",
    response_time_ms: Optional[int] = None,
    source: str = "api",
) -> dict[str, Any]:
    data = load_archive()
    key = archive_key(model_name, question, prompt_version, system_prompt)
    item = {
        "model_name": model_name,
        "question": question,
        "prompt_version": prompt_version,
        "system_prompt": system_prompt,
        "answer": answer,
        "response_time_ms": response_time_ms,
        "source": source,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    data["answers"][key] = item
    write_archive(data)
    return item


def archive_size() -> int:
    return len(load_archive()["answers"])
