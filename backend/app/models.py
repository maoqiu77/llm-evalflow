from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class EvalCaseBase(SQLModel):
    question: str
    scenario: str
    expected_answer: str
    difficulty: str = "中"
    eval_dimensions: str = "准确性,完整性,指令遵循,可执行性,格式稳定性,用户体验"
    source: str = "manual"
    notes: str = ""


class EvalCase(EvalCaseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EvalCaseCreate(EvalCaseBase):
    pass


class ModelAnswerBase(SQLModel):
    case_id: int = Field(index=True)
    model_name: str = Field(index=True)
    prompt_version: str = "v1.0"
    answer: str
    response_time_ms: Optional[int] = None


class ModelAnswer(ModelAnswerBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ModelAnswerCreate(ModelAnswerBase):
    pass


class ScoreBase(SQLModel):
    answer_id: int = Field(index=True)
    accuracy: int
    completeness: int
    instruction_following: int
    actionability: int
    format_stability: int
    user_experience: int
    reason: str = ""
    suggestion: str = ""


class Score(ScoreBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    total_score: float = 0
    is_badcase: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ScoreCreate(ScoreBase):
    pass


class BadcaseBase(SQLModel):
    case_id: int = Field(index=True)
    answer_id: int = Field(index=True)
    score_id: int = Field(index=True)
    badcase_type: str
    severity: str = "中"
    root_cause: str = ""
    optimization: str = ""
    enter_regression: bool = True


class Badcase(BadcaseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BadcaseCreate(BadcaseBase):
    pass


class PromptVersionBase(SQLModel):
    version: str = Field(index=True)
    content: str
    change_reason: str = ""
    related_badcase: str = ""
    before_score: Optional[float] = None
    after_score: Optional[float] = None
    conclusion: str = ""


class PromptVersion(PromptVersionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PromptVersionCreate(PromptVersionBase):
    pass
