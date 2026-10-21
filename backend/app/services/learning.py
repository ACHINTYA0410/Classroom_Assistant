"""Learning support orchestration. Deterministic rules reside in owned SQL RPCs."""
from app.core.errors import AppError
from app.core.supabase_client import service_database
from app.services.audit import decision


def attention_question(seed: int):
    """Five bounded Class 2 templates, no provider call."""
    a, b = seed % 8 + 2, (seed // 8) % 7 + 1
    kind = seed % 5
    if kind == 0:
        return 'count', {'prompt': 'How many calm circles can you count?', 'objects': a, 'tiles': [a], 'answer': a}
    if kind == 1:
        return 'pattern', {'prompt': 'What number comes next?', 'tiles': [b, b+2, b+4], 'answer': b+6}
    if kind == 2:
        return 'bigger', {'prompt': 'Which number is bigger?', 'tiles': [a, a+b], 'answer': a+b}
    if kind == 3:
        return 'addition', {'prompt': 'Add these two numbers.', 'tiles': [a,b], 'answer': a+b}
    return 'missing', {'prompt': f'{a} + ? = {a+b}. What is missing?', 'tiles': [a,a+b], 'answer': b}


async def run(runtime, kind, payload):
    db = runtime.db
    if kind == 'break_requested':
        result = await service_database(runtime.settings, runtime.http).rpc('begin_learning_break',
            p_student=runtime.user.id, p_progress_id=payload['progress_id'])
        reason = result['reasoning_summary']
    elif kind == 'break_resumed':
        result = await db.rpc('end_learning_break', p_break_id=payload['break_id'],
            p_activities=payload.get('activities', []), p_timeout=payload.get('timeout', False))
        reason = 'Closed the owned break using the server deadline and resumed learning.'
    elif kind == 'break_activities_saved':
        await db.rpc('save_break_activities', p_break_id=payload['break_id'], p_activities=payload['activities'])
        result, reason = {'saved': True}, 'Saved bounded local activity durations.'
    elif kind == 'session_updated':
        result = await db.rpc('learning_progress', p_session_id=payload['session_id'],
            p_total_seconds=payload.get('total_active_seconds'), p_complete=payload.get('complete', False))
        reason = 'Saved owned learning progress; SQL excludes open-break time and caps elapsed active time.'
    elif kind == 'practice_revealed':
        result = await db.rpc('reveal_practice_answer', p_section_id=payload['section_id'])
        reason = 'SQL verified two wrong attempts and returned a deterministic worked explanation.'
    elif kind == 'attention_shown':
        raise AppError('Use the live attention check endpoint.', 409)
    elif kind == 'attention_checked':
        from app.services.attention import check
        result = await check(runtime, payload, service_database(runtime.settings, runtime.http))
        reason = result['reason']
    elif kind == 'attention_answered':
        result = await db.rpc('answer_attention', p_event_id=payload['event_id'],
            p_response=payload.get('response'), p_skip=payload.get('skip', False))
        reason = 'Recorded the owned answer or skip and checked the stored deterministic answer.'
        from app.services.attention import public_event
        result = public_event(result)
    elif kind == 'calendar_test_completed':
        if not runtime.settings.enable_test_tools:
            raise AppError('Test tools are disabled on this server.', 403)
        result = await service_database(runtime.settings, runtime.http).rpc('calendar_test_complete',
            p_student=runtime.user.id, p_session_id=payload['session_id'])
        reason = 'Marked a test-only completion without manufacturing engagement or practice data.'
    else:
        raise AppError('Unknown learning action.', 422)
    return result, decision('teaching_agent', kind, payload, result, reason,
        linked_id=payload.get('progress_id') or payload.get('break_id') or payload.get('section_id') or payload.get('session_id'))
