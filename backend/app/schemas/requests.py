from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class TeachingRequest(StrictModel):
    section_id: UUID
    question: str = Field(min_length=1, max_length=1500)
    style: Literal['text', 'visual', 'analogy'] | None = None


class QuizStart(StrictModel):
    quiz_id: UUID


class AttemptRequest(StrictModel):
    attempt_id: UUID


class AnswerRequest(AttemptRequest):
    question_id: UUID
    answer: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    time_taken_seconds: int = Field(ge=0, le=86400)


class PracticeRequest(StrictModel):
    section_id: UUID
    answer: float = Field(allow_inf_nan=False, ge=-1000000, le=1000000)
    attempts: int = Field(ge=1, le=10000)
    time_taken_seconds: int = Field(ge=0, le=86400)


class EmptyRequest(StrictModel):
    pass


class QuestionEvent(StrictModel):
    request_type: Literal['student_question']
    payload: TeachingRequest


class StartEvent(StrictModel):
    request_type: Literal['quiz_started']
    payload: QuizStart


class AnswerEvent(StrictModel):
    request_type: Literal['quiz_answered']
    payload: AnswerRequest


class FinishEvent(StrictModel):
    request_type: Literal['quiz_completed', 'quiz_loaded', 'report_requested']
    payload: AttemptRequest


class ReportsEvent(StrictModel):
    request_type: Literal['reports_requested']
    payload: EmptyRequest = Field(default_factory=EmptyRequest)


class PracticeEvent(StrictModel):
    request_type: Literal['practice_recorded']
    payload: PracticeRequest


class SessionUpdate(StrictModel):
    session_id: UUID
    total_active_seconds: int | None = Field(default=None, ge=0, le=864000)
    complete: bool = False


class BreakRequest(StrictModel):
    progress_id: UUID


class Activity(StrictModel):
    id: Literal['breathing', 'doodle', 'bubbles', 'stretch', 'riddles']
    seconds: int = Field(ge=0, le=600)


class BreakActivities(StrictModel):
    break_id: UUID
    activities: list[Activity] = Field(default_factory=list, max_length=100)


class BreakResume(BreakActivities):
    timeout: bool = False


class SectionRequest(StrictModel):
    section_id: UUID


class AttentionShow(SectionRequest):
    sequence: int = Field(default=0, ge=0, le=3)


class AttentionCheck(SectionRequest):
    visit_id: UUID
    visible_seconds: int = Field(ge=0, le=86400)
    idle_seconds: int = Field(ge=0, le=86400)
    interruptible: bool = True
    enabled: bool = True
    finished: bool = False


class AttentionAnswer(StrictModel):
    event_id: UUID
    response: float | None = Field(default=None, allow_inf_nan=False, ge=-1000, le=1000)
    skip: bool = False


class CalendarComplete(StrictModel):
    session_id: UUID


class SessionEvent(StrictModel):
    request_type: Literal['session_updated', 'calendar_test_completed']
    payload: SessionUpdate


class BreakEvent(StrictModel):
    request_type: Literal['break_requested']
    payload: BreakRequest


class ResumeEvent(StrictModel):
    request_type: Literal['break_resumed']
    payload: BreakResume


class ActivityEvent(StrictModel):
    request_type: Literal['break_activities_saved']
    payload: BreakActivities


class RevealEvent(StrictModel):
    request_type: Literal['practice_revealed']
    payload: SectionRequest


class ShowEvent(StrictModel):
    request_type: Literal['attention_shown']
    payload: AttentionShow


class AttentionEvent(StrictModel):
    request_type: Literal['attention_answered']
    payload: AttentionAnswer


class AttentionCheckEvent(StrictModel):
    request_type: Literal['attention_checked']
    payload: AttentionCheck

OrchestrationRequest = Annotated[QuestionEvent | StartEvent | AnswerEvent | FinishEvent | ReportsEvent | PracticeEvent |
                               SessionEvent | BreakEvent | ResumeEvent | ActivityEvent | RevealEvent | ShowEvent | AttentionEvent | AttentionCheckEvent,
                               Field(discriminator='request_type')]
