from dataclasses import dataclass
from typing import Any, TypedDict


@dataclass
class Runtime:
    settings: Any
    user: Any
    db: Any
    llm: Any
    http: Any
    audit_writer: Any


class GraphState(TypedDict, total=False):
    user_id: str
    request_type: str
    payload: dict
    runtime: Runtime
    retrieved_context: list
    quiz_plan: dict
    computed_stats: dict
    result: Any
    errors: list[dict]
    decision_log: list[dict]
