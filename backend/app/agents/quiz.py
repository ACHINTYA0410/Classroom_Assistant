from app.schemas.responses import QuizPlan, QuizResult, AnswerResult
from app.services.audit import decision


def explain_plan(plan):
    """Describe the SQL decision; never recompute the timer in Python."""
    p = plan['adaptive']
    return (f"{p['question_count']} questions with {p['seconds_per_question']} seconds each "
            f"({plan['time_limit_seconds']} seconds total). " + p['reason'])


async def run(runtime, kind, payload):
    if kind == 'quiz_started':
        attempt = await runtime.db.rpc('start_quiz_attempt', p_quiz_id=payload['quiz_id'])
        result = await runtime.db.rpc('get_quiz_plan', p_attempt_id=attempt)
        result['explanation'] = explain_plan(result)
        result = QuizPlan.model_validate(result).model_dump()
    elif kind == 'quiz_loaded':
        result = await runtime.db.rpc('get_quiz_plan', p_attempt_id=payload['attempt_id'])
        result['explanation'] = explain_plan(result)
        result = QuizPlan.model_validate(result).model_dump()
    elif kind == 'quiz_answered':
        result = await runtime.db.rpc('submit_quiz_answer', p_attempt_id=payload['attempt_id'],
            p_question_id=payload['question_id'], p_answer=payload['answer'],
            p_seconds=payload['time_taken_seconds'])
        result = AnswerResult.model_validate(result).model_dump()
    elif kind == 'practice_recorded':
        result = await runtime.db.rpc('record_practice_answer', p_section_id=payload['section_id'],
            p_answer=payload['answer'], p_attempts=payload['attempts'], p_seconds=payload['time_taken_seconds'])
    else:
        result = await runtime.db.rpc('finish_quiz_attempt', p_attempt_id=payload['attempt_id'])
        result = QuizResult.model_validate(result).model_dump()
    record = decision('quiz_agent', kind, payload, result,
        result.get('explanation', 'Authenticated database RPC enforced ownership and deterministic assessment rules.'),
        linked_id=result.get('attempt_id') or payload.get('attempt_id'))
    return result, record
