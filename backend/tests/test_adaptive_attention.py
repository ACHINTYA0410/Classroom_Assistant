from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.services.attention import evaluate, activity, public_event, check
from conftest import SECTION, USER_A, token


def context(**overrides):
    return {'section': {'id': SECTION, 'content': 'Add the ones first.', 'topic_name': 'Addition with regrouping'},
            'visible_seconds': 120, 'baseline_seconds': [60, 70, 65], 'recent_wrong_attempts': 0,
            'continuous_seconds': 120, 'session_prompt_count': 0, 'daily_prompt_count': 0,
            'seconds_since_prompt': None, 'last_outcome': None, **overrides}


def snapshot(**overrides):
    return {'section_id': SECTION, 'visit_id': SECTION, 'visible_seconds': 120,
            'idle_seconds': 50, 'enabled': True, 'interruptible': True, 'finished': False, **overrides}


def test_personal_baseline_changes_timing_not_time_alone():
    assert evaluate(context(), snapshot())['action'] == 'check_in'
    assert evaluate(context(baseline_seconds=[130, 140, 150]), snapshot())['action'] == 'continue'
    assert evaluate(context(visible_seconds=500), snapshot(idle_seconds=5))['action'] == 'continue'
    assert evaluate(context(visible_seconds=30), snapshot())['action'] == 'continue'


@pytest.mark.parametrize('override', [{'enabled': False}, {'interruptible': False}, {'finished': True}])
def test_client_safety_states_defer(override):
    assert evaluate(context(), snapshot(**override))['action'] == 'continue'


@pytest.mark.parametrize('override', [
    {'blocked': 'Break active'}, {'session_prompt_count': 3}, {'daily_prompt_count': 8},
    {'seconds_since_prompt': 119}, {'last_outcome': 'skipped', 'seconds_since_prompt': 200},
])
def test_server_guards_and_skip_backoff(override):
    assert evaluate(context(**override), snapshot())['action'] == 'continue'


def test_selects_support_not_a_diagnosis():
    assert evaluate(context(recent_wrong_attempts=2), snapshot())['action'] == 'hint'
    assert evaluate(context(continuous_seconds=650), snapshot())['action'] == 'break_offer'
    assert evaluate(context(pending_event={'id': SECTION}), snapshot())['action'] == 'restore'


@pytest.mark.parametrize('topic,expected', [
    ('Addition with regrouping', 'build_ten'), ('Place value', 'place_value'),
    ('Subtraction', 'subtraction'), ('Adding small numbers', 'addition'),
])
def test_curriculum_templates_have_correct_answers(topic, expected):
    kind, payload = activity(context(section={'id': SECTION, 'topic_name': topic, 'content': ''}), 'check_in')
    assert kind == expected and payload['lesson_label'] == topic and payload['ungraded']
    if kind == 'addition': assert payload['answer'] == sum(payload['tiles'])
    if kind == 'subtraction': assert payload['answer'] == payload['tiles'][0] - payload['tiles'][1]
    if kind == 'build_ten': assert payload['objects'] == 10 and payload['answer'] == 1


def test_sanitization_does_not_mutate_persisted_key():
    event = {'id': SECTION, 'question_payload': {'answer': 1, 'prompt': 'Build a ten'}, 'response': 1}
    saved = deepcopy(event)
    assert 'answer' not in public_event(event)['question_payload']
    assert event == saved


@pytest.mark.asyncio
async def test_race_returns_continue_and_never_uses_llm():
    db = SimpleNamespace(rpc=AsyncMock(side_effect=[context(), None]))
    runtime = SimpleNamespace(user=SimpleNamespace(id=USER_A), llm=AsyncMock())
    result = await check(runtime, snapshot(), db)
    assert result['action'] == 'continue' and result['event'] is None
    runtime.llm.structured.assert_not_awaited()
    runtime.llm.embed.assert_not_awaited()


def test_api_routes_via_teaching_agent_audits_and_uses_verified_student(settings, monkeypatch):
    db = SimpleNamespace(rpc=AsyncMock(side_effect=[context(), {'id': SECTION, 'question_payload': {'prompt': 'Build a ten', 'tiles': [10], 'answer': 1}}]))
    monkeypatch.setattr('app.services.learning.service_database', lambda *_: db)
    with TestClient(create_app(settings)) as client:
        client.app.state.audit_writer = AsyncMock()
        client.app.state.llm = AsyncMock()
        response = client.post('/api/v1/attention/check', headers={'Authorization': 'Bearer '+token(settings)}, json=snapshot())
        assert response.status_code == 200
        result = response.json()['result']
        assert result['action'] == 'check_in' and 'answer' not in result['event']['question_payload']
        assert db.rpc.call_args_list[0].kwargs['p_student'] == USER_A
        record = client.app.state.audit_writer.call_args.args[3][0]
        assert record['agent_name'] == 'teaching_agent' and record['decision_type'] == 'attention_checked'
        client.app.state.llm.structured.assert_not_awaited()
        client.app.state.llm.embed.assert_not_awaited()


def test_attention_snapshot_rejects_spoofed_student_and_invalid_values(settings):
    with TestClient(create_app(settings)) as client:
        headers={'Authorization': 'Bearer '+token(settings)}
        for bad in [{'student_id': USER_A}, {'idle_seconds': -1}, {'visible_seconds': 999999}, {'visit_id': 'not-a-uuid'}]:
            assert client.post('/api/v1/attention/check', headers=headers, json={**snapshot(), **bad}).status_code == 422
        assert client.post('/api/v1/attention/check', json=snapshot()).status_code in (401,403)
