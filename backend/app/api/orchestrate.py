import asyncio
import time
from collections import OrderedDict, deque

from fastapi import APIRouter, Depends, Request

from app.core.errors import AppError
from app.core.security import CurrentUser, current_user
from app.core.supabase_client import user_database
from app.orchestrator.state import Runtime
from app.schemas.requests import OrchestrationRequest
from app.schemas.responses import Envelope

router = APIRouter()
LLM_EVENTS = {'student_question', 'quiz_completed', 'report_requested'}


class RateLimiter:
    """Single-worker sliding-window limiter; deploy a shared limiter before multiple workers."""
    def __init__(self):
        self.users = OrderedDict()

    def check(self, user_id, maximum):
        now = time.monotonic()
        entries = self.users.setdefault(user_id, deque())
        self.users.move_to_end(user_id)
        while entries and entries[0] <= now - 60:
            entries.popleft()
        if len(entries) >= maximum:
            raise AppError('Please wait a minute before asking for more AI help.', 429)
        entries.append(now)
        while len(self.users) > 10000:
            self.users.popitem(last=False)


async def execute(request: Request, user: CurrentUser, kind: str, payload: dict):
    state = request.app.state
    if kind in LLM_EVENTS:
        state.limiter.check(user.id, state.settings.llm_requests_per_minute)
    if kind == 'attention_checked' and not payload.get('finished'):
        state.limiter.check('attention:' + user.id, 12)
    # Audit availability is a prerequisite: do not mutate student data if no audit credentials exist.
    if not state.settings.supabase_service_role_key.get_secret_value():
        raise AppError('Backend audit credentials are not configured.')
    runtime = Runtime(state.settings, user, user_database(state.settings, state.http, user.token),
                      state.llm, state.http, state.audit_writer)
    try:
        result = await asyncio.wait_for(state.graph.ainvoke({
            'user_id': user.id, 'request_type': kind, 'payload': payload, 'runtime': runtime,
        }), state.settings.request_timeout_seconds)
    except TimeoutError:
        # Cancellation cannot proceed along normal graph edges; record it explicitly.
        from app.services.audit import decision
        name = 'report_agent' if kind.startswith('report') else 'quiz_agent' if kind.startswith('quiz_') or kind == 'practice_recorded' else 'teaching_agent'
        try:
            await asyncio.wait_for(state.audit_writer(state.settings, state.http, user.id,
                [decision(name, 'request_timeout', {}, {}, 'Request exceeded its configured time budget.')]), 3)
        except Exception:
            pass
        raise AppError('This request took too long. Please try again.', 504) from None
    if result.get('errors'):
        error = result['errors'][0]
        raise AppError(error['message'], error['status'])
    return {'result': result['result'], 'request_id': request.state.request_id}


@router.post('/orchestrate', response_model=Envelope)
async def orchestrate(body: OrchestrationRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, body.request_type, body.payload.model_dump(mode='json'))
