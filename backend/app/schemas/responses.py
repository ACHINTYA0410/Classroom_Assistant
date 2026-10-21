from typing import Any, Generic, TypeVar
from pydantic import BaseModel, Field


class TeachingAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=4000)
    sufficient_context: bool


class TeachingResult(TeachingAnswer):
    fallback: bool = False
    fallback_reason: str | None = None
    answer_source: str = 'curriculum_generation'
    context_ids: list[str] = []


class ReportNarrative(BaseModel):
    narrative: str = Field(min_length=1, max_length=4000)
    suggestions: list[str] = Field(min_length=1, max_length=3)


class Question(BaseModel):
    id: str
    template: str
    a: float
    b: float
    options: list[float]


class QuizPlan(BaseModel):
    attempt_id: str
    started_at: str
    time_limit_seconds: int
    remaining_seconds: int
    status: str
    questions: list[Question]
    answered_question_ids: list[str]
    adaptive: dict[str, Any]
    explanation: str = ''


class AnswerResult(BaseModel):
    isCorrect: bool
    misconceptionTag: str | None = None
    explanation: str


class QuizResult(BaseModel):
    fullMarks: bool = False
    report_pending: bool = False
    correctCount: int
    totalQuestions: int
    scorePercentage: float
    accuracyPercentage: float
    missedQuestions: list[dict[str, Any]]
    report: dict[str, Any] | None = None


class PracticeResult(AnswerResult):
    attempts: int
    wrongAttempts: int
    canReveal: bool
    answerRevealed: bool


class LearningReport(BaseModel):
    id: str
    student_id: str
    quiz_attempt_id: str
    generated_at: str
    stats_snapshot: dict[str, Any]
    narrative: str


Result = TypeVar('Result', default=dict[str, Any] | list[dict[str, Any]])


class Envelope(BaseModel, Generic[Result]):
    result: Result
    request_id: str
