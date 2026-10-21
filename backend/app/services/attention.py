"""Teaching Agent's deterministic support policy; never infers a diagnosis or calls an LLM."""
from statistics import median

MAXIMUM_PER_SESSION = 3
COOLDOWN_SECONDS = 120


def evaluate(context, snapshot):
    samples = [float(value) for value in context.get('baseline_seconds', []) if 15 <= float(value) <= 1800]
    # Comparable completed sections only. Cold-start allowance estimates reading effort.
    words = len(context.get('section', {}).get('content', '').split())
    baseline = median(samples) if len(samples) >= 3 else max(60, min(150, words / 2 + 45))
    baseline = max(30, min(600, baseline))
    signals = {
        'baseline_seconds': round(baseline), 'baseline_samples': len(samples),
        'section_seconds': context.get('visible_seconds', 0),
        'idle_seconds': min(snapshot['idle_seconds'], context.get('visible_seconds', 0)),
        'recent_wrong_attempts': context.get('recent_wrong_attempts', 0),
        'continuous_seconds': context.get('continuous_seconds', 0),
        'previous_outcome': context.get('last_outcome'),
    }
    result = {'action': 'continue', 'reason': 'Learning can continue without interruption.', 'signals': signals}
    if context.get('blocked') or not snapshot['enabled'] or snapshot['finished']:
        return {**result, 'reason': context.get('blocked') or 'Attention support is disabled or this section is finished.'}
    if not snapshot['interruptible']:
        return {**result, 'reason': 'The student is busy; defer the check-in.'}
    if context.get('pending_event'):
        return {**result, 'action': 'restore', 'reason': 'Restore the existing check-in instead of creating another.'}
    cooldown = 240 if context.get('last_outcome') == 'skipped' else COOLDOWN_SECONDS
    if context.get('session_prompt_count', 0) >= MAXIMUM_PER_SESSION or context.get('daily_prompt_count', 0) >= 8:
        return {**result, 'reason': 'The support prompt limit has been reached.'}
    if context.get('seconds_since_prompt') is not None and context['seconds_since_prompt'] < cooldown:
        return {**result, 'reason': 'Respect the cooldown after the previous check-in.'}
    dwell, idle = signals['section_seconds'], signals['idle_seconds']
    if dwell < 45 or idle < 25:
        return result
    if signals['continuous_seconds'] >= 600:
        return {**result, 'action': 'break_offer', 'reason': 'Extended active learning and inactivity suggest offering an optional reset.'}
    if signals['recent_wrong_attempts'] >= 2:
        return {**result, 'action': 'hint', 'reason': 'Recent difficulty and inactivity suggest a supportive visual hint.'}
    # Two signals are required; time alone never triggers an intervention.
    if dwell >= baseline * 1.5 and idle >= max(25, min(60, baseline * .35)):
        return {**result, 'action': 'check_in', 'reason': 'Section time exceeds the personal baseline and meaningful interaction has paused.'}
    return result


def activity(context, action):
    section = context['section']
    topic = section.get('topic_name') or section.get('title') or 'this math lesson'
    text = (topic + ' ' + section.get('content', '')).lower()
    seed = int(section['id'].replace('-', '')[-8:], 16) + context.get('session_prompt_count', 0)
    a, b = 2 + seed % 6, 1 + seed % 4
    common = {'title': 'Quick number adventure', 'lesson_label': topic,
              'support_kind': action, 'ungraded': True}
    if action == 'break_offer':
        return 'reset', {**common, 'prompt': 'You have been learning for a while. Would you like a little reset?', 'tiles': [], 'answer': 0}
    if any(word in text for word in ('regroup', 'carry', 'carrying')):
        return 'build_ten', {**common, 'prompt': 'Tap ten ones to build a ten. How many tens did you make?',
                             'objects': 10, 'tiles': [10], 'answer': 1, 'hint': 'Ten ones make one ten.'}
    if 'place value' in text or 'tens' in text:
        return 'place_value', {**common, 'prompt': f'Let’s find the tens! How many tens are in {a * 10 + b}?',
                               'tiles': [a * 10 + b], 'answer': a, 'hint': 'The left digit counts the tens.'}
    if 'subtract' in text:
        return 'subtraction', {**common, 'prompt': 'A tiny challenge from our subtraction lesson.',
                              'tiles': [a + b, b], 'answer': a, 'operator': '−'}
    return 'addition', {**common, 'prompt': 'Let’s try one small addition together.',
                        'tiles': [a, b], 'answer': a + b, 'operator': '+', 'hint': 'Count on from the first number.'}


def public_event(event):
    if not event:
        return None
    # Never send the persisted answer key in check-in/answer responses.
    return {**event, 'question_payload': {key: value for key, value in event.get('question_payload', {}).items() if key != 'answer'}, 'response': None}


async def check(runtime, snapshot, db):
    context = await db.rpc('attention_context', p_student=runtime.user.id,
                           p_section_id=snapshot['section_id'], p_visit_id=snapshot['visit_id'],
                           p_visible_seconds=snapshot['visible_seconds'], p_finished=snapshot['finished'])
    chosen = evaluate(context, snapshot)
    event = None
    if chosen['action'] == 'restore':
        event = context['pending_event']
    elif chosen['action'] != 'continue':
        kind, payload = activity(context, chosen['action'])
        event = await db.rpc('offer_attention', p_student=runtime.user.id,
                             p_section_id=snapshot['section_id'], p_visit_id=snapshot['visit_id'],
                             p_reason=chosen['reason'], p_question_type=kind, p_payload=payload, p_signals=chosen['signals'])
        if not event:
            chosen = {**chosen, 'action': 'continue', 'reason': 'Another request or lifecycle change deferred this check-in.'}
    return {**chosen, 'event': public_event(event), 'policy_version': 'adaptive-v1', 'next_check_seconds': 15}
