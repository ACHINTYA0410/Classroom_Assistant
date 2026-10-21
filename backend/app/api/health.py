from fastapi import APIRouter, Request

from app.core.errors import AppError
from app.core.supabase_client import service_database

router = APIRouter()


@router.get('/health')
async def health():
    return {'status': 'ok', 'service': 'classroom-assistant-api'}


@router.get('/ready')
async def ready(request: Request):
    """Read-only deployment check; health alone does not prove database readiness."""
    state = request.app.state
    settings = state.settings
    if not settings.supabase_anon_key.get_secret_value() or not settings.gemini_api_key.get_secret_value():
        raise AppError('Backend learning credentials are not configured.')
    db = service_database(settings, state.http)
    await db.select('quiz_attempts', select='id,adaptive_plan', limit='0')
    await db.select('agent_decisions', select='id,student_id', limit='0')
    await db.select('session_progress', select='id,completed_via,active_updated_at', limit='0')
    await db.select('break_records', select='id,allowed_seconds,ended_reason,activities,agent_decision_id', limit='0')
    await db.select('session_responses', select='id,wrong_attempts,answer_revealed,attempts_before_reveal,revealed_at', limit='0')
    await db.select('attention_events', select='id,outcome,question_payload,signals_snapshot', limit='0')
    await db.select('attention_section_visits', select='id,visible_seconds,finished,continuous_seconds', limit='0')
    # Also exercise the actual PostgREST relationships used by lesson retrieval.
    sections = await db.select('session_sections',
        select='id,sessions!inner(topic_id,weeks!inner(chapter_id,chapters!inner(grade_level)))', limit='1')
    vectors = await db.select('curriculum_embeddings', select='id',
        embedding_model=f'eq.{settings.gemini_embedding_model}',
        embedding_dimension=f'eq.{settings.embedding_dimension}', limit='1')
    if not sections or not vectors:
        raise AppError('Curriculum or versioned embeddings are not ready.')
    return {'status': 'ready', 'service': 'classroom-assistant-api'}
