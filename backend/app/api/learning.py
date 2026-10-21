from uuid import UUID
from fastapi import APIRouter, Depends, Request
from app.api.orchestrate import execute
from app.core.security import current_user
from app.core.supabase_client import user_database
from app.schemas.requests import (SessionUpdate, BreakRequest, BreakResume, BreakActivities,
    SectionRequest, AttentionShow, AttentionAnswer, AttentionCheck, CalendarComplete)

router = APIRouter()


@router.get('/breaks/status')
async def break_status(request: Request, user=Depends(current_user)):
    result = await user_database(request.app.state.settings, request.app.state.http, user.token).rpc('learning_break_status')
    return {'result': result, 'request_id': request.state.request_id}


@router.get('/test-tools')
async def test_tools(request: Request, user=Depends(current_user)):
    return {'result': {'enabled': request.app.state.settings.enable_test_tools}, 'request_id': request.state.request_id}


@router.get('/practice/state/{section_id}')
async def practice_state(section_id: UUID, request: Request, user=Depends(current_user)):
    result = await user_database(request.app.state.settings, request.app.state.http, user.token).rpc('practice_state', p_section_id=str(section_id))
    return {'result': result, 'request_id': request.state.request_id}


def action(path, kind, model):
    async def handler(body, request: Request, user=Depends(current_user)):
        return await execute(request, user, kind, body.model_dump(mode='json'))
    handler.__annotations__['body'] = model
    router.add_api_route(path, handler, methods=['POST'], name=kind)


for path, kind, model in [
    ('/learning/session','session_updated',SessionUpdate),
    ('/breaks/request','break_requested',BreakRequest),
    ('/breaks/resume','break_resumed',BreakResume),
    ('/breaks/activities','break_activities_saved',BreakActivities),
    ('/practice/reveal','practice_revealed',SectionRequest),
    ('/attention/show','attention_shown',AttentionShow),
    ('/attention/check','attention_checked',AttentionCheck),
    ('/attention/answer','attention_answered',AttentionAnswer),
    ('/test-tools/complete','calendar_test_completed',CalendarComplete),
]:
    action(path, kind, model)
