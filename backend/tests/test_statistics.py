import pytest
from app.agents.report import fallback_narrative, grounded
from app.agents.quiz import explain_plan
from app.services.progress import compute_statistics


def history(scores):
    return {'history': [{'id':str(i), 'score':s, 'accuracy':s} for i,s in enumerate(scores)],
            'progress': [], 'practice': [], 'breaks': []}


def test_overall_improvement_with_recent_decline():
    stats = compute_statistics(history([55,63,71,68]), '3')
    assert stats['trend'] == 'improving'
    assert stats['recent_trend'] == 'declining'
    assert stats['score_delta'] == -3
    assert stats['overall_delta'] == 13


@pytest.mark.parametrize('scores,trend,recent', [([50],'stable','stable'),([50,50],'stable','stable'),([80,70,60],'declining','declining'),([50,60,70],'improving','improving')])
def test_trends(scores, trend, recent):
    stats = compute_statistics(history(scores),str(len(scores)-1))
    assert (stats['trend'],stats['recent_trend']) == (trend,recent)
    assert grounded(fallback_narrative(stats),stats)


def test_report_counts_and_numeric_grounding():
    data = history([55,63])
    data.update(practice=[{'is_correct':True,'attempts':2},{'is_correct':False,'attempts':1}],breaks=[{'duration_seconds':20}])
    stats = compute_statistics(data,'1')
    assert stats['practice'] == {'responses':2,'correct':1,'attempts':3}
    assert stats['break_patterns'] == {'count':1,'total_seconds':20}
    assert grounded('Your score is 63%, up by 8.',stats)
    assert not grounded('Your score is 99%.',stats)
    assert not grounded('Practice for 999 minutes.',stats)


@pytest.mark.parametrize('accuracy,seconds,reason', [(55,135,'Added time because recent accuracy is below 60%.'),
    (90,72,'Used a shorter pace because recent accuracy exceeds 85%.'), (70,90,'Kept the standard pace.')])
def test_quiz_explains_database_decision_without_recalculating(accuracy,seconds,reason):
    plan={'time_limit_seconds':seconds*7,'adaptive':{'question_count':7,'seconds_per_question':seconds,'rolling_accuracy':accuracy,'reason':reason}}
    explanation=explain_plan(plan)
    assert f'{seconds*7} seconds total' in explanation
    assert reason in explanation
