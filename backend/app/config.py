from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "LLM EvalFlow API"
    database_url: str = "sqlite:///./llm_evalflow.db"
    liaobots_api_key: str = ""
    liaobots_base_url: str = "https://ai.liaobots.work/v1"
    llm_timeout_seconds: int = 60
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


AVAILABLE_MODELS = [
    "deepseek-v4-pro",
    "glm-5.1",
    "gemini-3.5-flash",
    "kimi-k2.6",
    "minimax-m2.7",
    "gpt-5.4",
    "qwen3.7-max",
    "claude-sonnet-4-5-20250929-t",
]
