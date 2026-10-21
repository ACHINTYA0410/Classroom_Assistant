from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.services.learning import attention_question
from app.services.progress import compute_statistics
from app.core.errors import AppError
from conftest import USER_A, SECTION, token


def test_test_tools_default_off_and_no_write(settings, monkeypatch):
    service = SimpleNamespace(rpc=AsyncMock())
    monkeypatch.setattr('app.services.learning.service_database', lambda *_: service)
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.audit_writer = AsyncMock()
        headers = {'Authorization': 'Bearer ' + token(settings)}
        assert client.get('/api/v1/test-tools', headers=headers).json()['result'] == {'enabled': False}
        response = client.post('/api/v1/test-tools/complete', headers=headers, json={'session_id': SECTION})
        assert response.status_code == 403
        service.rpc.assert_not_awaited()
        assert app.state.audit_writer.call_args.args[3][0]['decision_type'] == 'calendar_test_completed_failed'


def test_test_tools_enabled_uses_authenticated_identity_and_audits(settings, monkeypatch):
    settings.enable_test_tools = True
    service = SimpleNamespace(rpc=AsyncMock(return_value={'completed_via': 'calendar_test_shortcut'}))
    monkeypatch.setattr('app.services.learning.service_database', lambda *_: service)
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.audit_writer = AsyncMock()
        response = client.post('/api/v1/test-tools/complete', headers={'Authorization': 'Bearer ' + token(settings)}, json={'session_id': SECTION})
        assert response.status_code == 200
        service.rpc.assert_awaited_once_with('calendar_test_complete', p_student=USER_A, p_session_id=SECTION)
        assert app.state.audit_writer.call_args.args[3][0]['agent_name'] == 'teaching_agent'


@pytest.mark.parametrize('path,body', [
    ('/breaks/request', {'progress_id': SECTION}),
    ('/breaks/resume', {'break_id': SECTION, 'activities': []}),
    ('/attention/show', {'section_id': SECTION}),
    ('/attention/answer', {'event_id': SECTION, 'response': 5}),
    ('/practice/reveal', {'section_id': SECTION}),
    ('/learning/session', {'session_id': SECTION, 'total_active_seconds': 10, 'complete': True}),
])
def test_learning_routes_require_authentication(settings, path, body):
    with TestClient(create_app(settings)) as client:
        assert client.post('/api/v1' + path, json=body).status_code == 401


def test_break_decision_through_teaching_graph_no_llm(settings, monkeypatch):
    service = SimpleNamespace(rpc=AsyncMock(return_value={
        'server_now': '2026-01-01T00:00:00Z', 'break': {'allowed_seconds': 300},
        'reasoning_summary': 'A calm pause.'}))
    monkeypatch.setattr('app.services.learning.service_database', lambda *_: service)
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.audit_writer = AsyncMock()
        app.state.llm.structured = AsyncMock()
        response = client.post('/api/v1/breaks/request', headers={'Authorization': 'Bearer ' + token(settings)}, json={'progress_id': SECTION})
        assert response.json()['result']['break']['allowed_seconds'] == 300
        app.state.llm.structured.assert_not_awaited()
        record = app.state.audit_writer.call_args.args[3][0]
        assert record['agent_name'] == 'teaching_agent' and record['decision_type'] == 'break_requested'


@pytest.mark.parametrize('seed', range(20))
def test_attention_templates_deterministic_and_class_two(seed):
    kind, question = attention_question(seed)
    assert (kind, question) == attention_question(seed)
    assert kind in {'count', 'pattern', 'bigger', 'addition', 'missing'}
    assert 1 <= question['answer'] <= 20


def test_support_statistics_reveals_not_independent_and_real_inputs_only():
    stats = compute_statistics({
        'history': [{'id': SECTION, 'score': 100, 'accuracy': 100}], 'progress': [],
        'practice': [{'is_correct': True, 'answer_revealed': True, 'attempts': 3, 'wrong_attempts': 2}],
        'breaks': [{'duration_seconds': 300, 'ended_reason': 'timeout', 'activities': [{'id': 'doodle', 'seconds': 100}]}],
        'attention': [{'outcome': 'answered', 'is_correct': True}, {'outcome': 'skipped', 'is_correct': None}],
    }, SECTION)
    assert stats['practice']['correct'] == 0
    support = stats['engagement_and_support']
    assert support['questions_revealed'] == 1 and support['wrong_practice_attempts'] == 2
    assert support['break_average_seconds'] == 300 and support['break_end_reasons'] == {'timeout': 1}
    assert support['popup_response_rate'] == 50 and support['popup_accuracy'] == 100
    assert support['activities']['doodle'] == 100
