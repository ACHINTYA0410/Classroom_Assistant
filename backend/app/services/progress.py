from collections import Counter
from app.core.errors import AppError


def direction(delta):
    return 'improving' if delta > 0 else 'declining' if delta < 0 else 'stable'


def compute_statistics(data: dict, attempt_id: str):
    history = data['history']
    position = next((i for i, a in enumerate(history) if a['id'] == attempt_id), None)
    if position is None:
        raise AppError('Complete this assessment before requesting a report.', 409)
    history = history[:position + 1]
    current = float(history[-1]['score'])
    previous = float(history[-2]['score']) if len(history) > 1 else None
    recent_delta = current - previous if previous is not None else 0
    overall_delta = current - float(history[0]['score'])
    progress = data.get('progress', [])
    practice = data.get('practice', [])
    breaks = data.get('breaks', [])
    attention = data.get('attention', [])
    answered = [e for e in attention if e.get('outcome') == 'answered']
    closed_breaks = [b for b in breaks if b.get('duration_seconds') is not None]
    break_total = sum(b.get('duration_seconds') or 0 for b in closed_breaks)
    support = {
        'break_count': len(breaks), 'break_total_seconds': break_total,
        'break_average_seconds': break_total / len(closed_breaks) if closed_breaks else 0,
        'break_open_count': len(breaks) - len(closed_breaks),
        'break_end_reasons': dict(Counter(b.get('ended_reason') or ('open' if b.get('duration_seconds') is None else 'unknown') for b in breaks)),
        'activities': dict(Counter({name: sum(a.get('seconds', 0) for b in breaks for a in b.get('activities', []) if a.get('id') == name)
                                  for name in ('breathing', 'doodle', 'bubbles', 'stretch', 'riddles')})),
        'popup_shown': len(attention), 'popup_answered': len(answered),
        'popup_skipped': sum(e.get('outcome') == 'skipped' for e in attention),
        'popup_response_rate': 100 * len(answered) / len(attention) if attention else 0,
        'popup_accuracy': 100 * sum(e.get('is_correct') is True for e in answered) / len(answered) if answered else 0,
        'questions_revealed': sum(bool(p.get('answer_revealed')) for p in practice),
        'wrong_practice_attempts': sum(p.get('wrong_attempts', 0) for p in practice),
        'break_decisions': data.get('break_decisions', []),
    }
    accuracies = [float(h['accuracy']) for h in history]
    topic_summary = lambda p: {k: p.get(k) for k in ('topic_id', 'topic_name', 'primary_misconception_tag')}
    misconceptions = Counter(p['primary_misconception_tag'] for p in progress if p.get('primary_misconception_tag'))
    return {
        'current_score': current, 'previous_score': previous, 'score_delta': recent_delta,
        'trend': direction(overall_delta), 'overall_delta': overall_delta,
        'recent_trend': direction(recent_delta), 'attempt_count': len(history),
        'score_history': [float(h['score']) for h in history],
        'accuracy_history': accuracies,
        'accuracy_trend': direction(accuracies[-1] - accuracies[0]),
        'recent_accuracy_trend': direction(accuracies[-1] - accuracies[-2]) if len(accuracies) > 1 else 'stable',
        'dominant_misconceptions': [{'tag': tag, 'topic_count': count} for tag, count in misconceptions.most_common()],
        'weak_topics': [topic_summary(p) for p in progress if p['mastery_status'] == 'weak'],
        'strong_topics': [topic_summary(p) for p in progress if p['mastery_status'] == 'mastered'],
        'practice': {'responses': len(practice), 'correct': sum(bool(p['is_correct']) and not p.get('answer_revealed', False) for p in practice),
                     'attempts': sum(p.get('attempts', 1) for p in practice)},
        'engagement_and_support': support,
        'break_patterns': {'count': len(breaks),
                           'total_seconds': sum(b.get('duration_seconds') or 0 for b in breaks)},
    }


async def refresh_progress(db):
    return await db.rpc('refresh_student_progress')
