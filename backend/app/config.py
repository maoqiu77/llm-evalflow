from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = BACKEND_DIR / ".env"
RUNTIME_CONFIG_PATH = BACKEND_DIR / "eval_runtime_config.json"
RESULTS_DIR = PROJECT_ROOT / "评测结果"


class Settings(BaseSettings):
    app_name: str = "LLM EvalFlow API"
    database_url: str = "sqlite:///./llm_evalflow.db"
    liaobots_api_key: str = ""
    liaobots_base_url: str = "https://ai.liaobots.work/v1"
    llm_timeout_seconds: int = 60
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


DEFAULT_MODELS = [
    "deepseek-v4-pro",
    "glm-5.1",
    "gemini-3.5-flash",
    "kimi-k2.6",
    "minimax-m2.7",
    "gpt-5.4",
    "qwen3.7-max",
    "claude-sonnet-4-5-20250929-t",
]

DEFAULT_JUDGE_MODEL = "gpt-5.4"
DEFAULT_SUMMARY_MODEL = "gemini-3.5-flash"


def default_runtime_config() -> dict[str, Any]:
    default_answer_models = [model for model in [DEFAULT_JUDGE_MODEL, DEFAULT_SUMMARY_MODEL] if model in DEFAULT_MODELS]
    return {
        "models": DEFAULT_MODELS,
        "default_answer_models": default_answer_models or DEFAULT_MODELS[:2],
        "default_judge_model": DEFAULT_JUDGE_MODEL,
        "summary_model": DEFAULT_SUMMARY_MODEL,
        "max_workers": 4,
    }


def read_env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        return values
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env_values(updates: dict[str, str]) -> None:
    existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    seen: set[str] = set()
    lines: list[str] = []
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            lines.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def get_llm_base_url() -> str:
    return read_env_values().get("LIAOBOTS_BASE_URL") or settings.liaobots_base_url


def get_llm_api_key() -> str:
    values = read_env_values()
    if "LIAOBOTS_API_KEY" in values:
        return values["LIAOBOTS_API_KEY"]
    return settings.liaobots_api_key


def sanitize_models(models: list[str]) -> list[str]:
    result = []
    seen = set()
    for raw in models:
        model = raw.strip()
        if not model or model in seen:
            continue
        result.append(model)
        seen.add(model)
    return result


def normalize_runtime_config(data: dict[str, Any] | None = None) -> dict[str, Any]:
    defaults = default_runtime_config()
    raw = {**defaults, **(data or {})}
    models = sanitize_models([str(model) for model in raw.get("models", [])])
    if not models:
        models = DEFAULT_MODELS.copy()
    model_set = set(models)

    default_answer_models = sanitize_models([str(model) for model in raw.get("default_answer_models", [])])
    default_answer_models = [model for model in default_answer_models if model in model_set]
    if not default_answer_models:
        default_answer_models = models[: min(2, len(models))]

    default_judge_model = str(raw.get("default_judge_model") or "").strip()
    if default_judge_model not in model_set:
        default_judge_model = DEFAULT_JUDGE_MODEL if DEFAULT_JUDGE_MODEL in model_set else models[0]

    summary_model = str(raw.get("summary_model") or "").strip()
    if summary_model not in model_set:
        summary_model = DEFAULT_SUMMARY_MODEL if DEFAULT_SUMMARY_MODEL in model_set else default_judge_model

    try:
        max_workers = int(raw.get("max_workers", defaults["max_workers"]))
    except (TypeError, ValueError):
        max_workers = defaults["max_workers"]

    return {
        "models": models,
        "default_answer_models": default_answer_models,
        "default_judge_model": default_judge_model,
        "summary_model": summary_model,
        "max_workers": max(1, min(max_workers, 8)),
    }


def load_runtime_config() -> dict[str, Any]:
    if not RUNTIME_CONFIG_PATH.exists():
        return normalize_runtime_config()
    try:
        data = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return normalize_runtime_config()
    return normalize_runtime_config(data if isinstance(data, dict) else None)


def save_runtime_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_runtime_config(config)
    RUNTIME_CONFIG_PATH.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized


def get_available_models() -> list[str]:
    return load_runtime_config()["models"]


def get_default_judge_model() -> str:
    return load_runtime_config()["default_judge_model"]


def get_summary_model() -> str:
    return load_runtime_config()["summary_model"]


def mask_secret(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 8:
        return f"{secret[:2]}***{secret[-2:]}"
    return f"{secret[:4]}...{secret[-4:]}"


def public_config() -> dict[str, Any]:
    runtime = load_runtime_config()
    api_key = get_llm_api_key()
    return {
        "base_url": get_llm_base_url(),
        "has_api_key": bool(api_key),
        "api_key_mask": mask_secret(api_key),
        **runtime,
        "config_path": str(RUNTIME_CONFIG_PATH),
        "env_path": str(ENV_PATH),
    }


AVAILABLE_MODELS = DEFAULT_MODELS
