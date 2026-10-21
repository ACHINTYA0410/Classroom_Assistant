"""Real PostgreSQL/RLS behind a TEST-ONLY HTTP adapter; no hosted student data."""
import json
from functools import partial
from pathlib import Path
import subprocess
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.main import create_app
from app.schemas.responses import ReportNarrative, TeachingAnswer
from conftest import SECRET, token

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def isolated_database():
    process = subprocess.Popen(['node', 'scripts/database-test-server.mjs'], cwd=ROOT,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('Isolated PostgreSQL test adapter failed to start.')
        yield json.loads(line)
    finally:
        process.terminate()
        process.communicate(timeout=10)


def run_agent_scenario(database, *, live=False):
    """Same production API scenario with either mocked Gemini or opt-in real Gemini."""
    source = Settings() if live else Settings(_env_file=None, gemini_api_key='')
    settings = source.model_copy(update={'supabase_url': database['url']})
    # These are synthetic credentials accepted only by the disposable test adapter.
    from pydantic import SecretStr
    settings.supabase_anon_key = SecretStr('isolated-anon-key')
    settings.supabase_service_role_key = SecretStr('isolated-service-key')
    settings.supabase_jwt_secret = SecretStr(SECRET)
    f = database['fixture']
    auth = {'Authorization': 'Bearer '+token(settings, sub=f['a'])}
    other = {'Authorization': 'Bearer '+token(settings, sub=f['b'])}
    admin = {'Authorization': 'Bearer isolated-service-key'}
    app = create_app(settings)
    with TestClient(app) as client:
        if not live:
            app.state.llm.embed = AsyncMock(return_value=[1.0]+[0.0]*767)
            app.state.llm.structured = AsyncMock(return_value=TeachingAnswer(answer='Add the ones first, then the tens.', sufficient_context=True))
        # Embed curriculum using exactly the configured model and dimension.
        vector = client.portal.call(partial(app.state.llm.embed, 'Add the ones first, regroup ten ones as a ten, then add the tens.', document=True))
        httpx.post(database['url']+'/__test__/embedding', headers=admin,
                   json={'vector':vector,'model':settings.gemini_embedding_model}).raise_for_status()
        assert client.get('/api/v1/reports').status_code == 401
        assert client.post('/api/v1/quiz/start',headers=auth,json={'quiz_id':f['quiz']}).status_code == 409
        teaching = client.post('/api/v1/teaching/ask',headers=auth,json={'section_id':f['section'],'question':'How do I add the ones and tens?'})
        assert teaching.status_code == 200, teaching.text
        assert teaching.json()['result']['context_ids']
        assert not teaching.json()['result']['fallback'], teaching.text
        httpx.post(database['url']+'/__test__/complete-lesson',headers=admin).raise_for_status()
        started = client.post('/api/v1/quiz/start',headers=auth,json={'quiz_id':f['quiz']})
        assert started.status_code == 200, started.text
        plan = started.json()['result']
        assert len(plan['questions']) == 7
        assert client.get('/api/v1/quiz/'+plan['attempt_id'],headers=other).status_code == 403
        assert client.post('/api/v1/quiz/finish',headers=other,json={'attempt_id':plan['attempt_id']}).status_code == 403
        for question in plan['questions']:
            response = client.post('/api/v1/quiz/answer',headers=auth,json={
                'attempt_id':plan['attempt_id'],'question_id':question['id'],
                'answer':question['a']+question['b'],'time_taken_seconds':1})
            assert response.status_code == 200, response.text
            assert response.json()['result']['isCorrect']
        if not live:
            app.state.llm.structured.return_value = ReportNarrative(narrative='Your score is 100%.', suggestions=['Practice regrouping with a lesson example.'])
        finished = client.post('/api/v1/quiz/finish',headers=auth,json={'attempt_id':plan['attempt_id']})
        assert finished.status_code == 200, finished.text
        result = finished.json()['result']
        assert result['scorePercentage'] == 100
        assert result['report']['stats_snapshot']['current_score'] == 100
        # LLM can be rejected by numeric grounding; recording that is a valid fallback.
        assert result['report']['narrative']
        reports = client.get('/api/v1/reports',headers=auth).json()['result']
        assert len(reports) == 1
        assert client.get('/api/v1/reports',headers=other).json()['result'] == []
        audit = httpx.get(database['url']+'/rest/v1/agent_decisions',headers=admin).json()
        assert {'teaching_agent','quiz_agent','report_agent'} <= {r['agent_name'] for r in audit}
        assert httpx.get(database['url']+'/rest/v1/agent_decisions',headers=auth).status_code == 403
        return {'teaching':'passed','quiz':'passed','report':'passed','audit_rows':len(audit),
                'report_narrative_fallback':result['report']['stats_snapshot']['narrative_fallback']}


@pytest.mark.integration
def test_api_graph_sql_rls_and_audit(isolated_database):
    run_agent_scenario(isolated_database)

@pytest.mark.integration
def test_learning_api_sql_locks_reveal_and_audit(isolated_database):
    from pydantic import SecretStr
    f = isolated_database['fixture']
    settings = Settings(_env_file=None, supabase_url=isolated_database['url'],
        supabase_anon_key='isolated-anon-key', supabase_service_role_key='isolated-service-key',
        supabase_jwt_secret=SECRET, gemini_api_key='', enable_test_tools=True)
    auth = {'Authorization': 'Bearer ' + token(settings, sub=f['b'])}
    other = {'Authorization': 'Bearer ' + token(settings, sub=f['a'])}
    app = create_app(settings)
    with TestClient(app) as client:
        progress = client.post('/api/v1/learning/session', headers=auth, json={'session_id': f['session']})
        assert progress.status_code == 200, progress.text
        pid = progress.json()['result']['id']
        started = client.post('/api/v1/breaks/request', headers=auth, json={'progress_id': pid})
        assert started.status_code == 200, started.text
        state = started.json()['result']
        assert 300 <= state['break']['allowed_seconds'] <= 600
        assert state['break']['agent_decision_id']
        assert client.get('/api/v1/breaks/status', headers=auth).json()['result']['break']['id'] == state['break']['id']
        for path, body in [
            ('/learning/session', {'session_id': f['session'], 'total_active_seconds': 100, 'complete': True}),
            ('/practice/answer', {'section_id': f['section'], 'answer': 25, 'attempts': 1, 'time_taken_seconds': 1}),
            ('/quiz/start', {'quiz_id': f['quiz']}),
            ('/test-tools/complete', {'session_id': f['session']}),
        ]:
            assert client.post('/api/v1' + path, headers=auth, json=body).status_code == 409
        assert client.post('/api/v1/breaks/resume', headers=other, json={'break_id': state['break']['id'], 'activities': []}).status_code == 403
        assert client.post('/api/v1/breaks/resume', headers=auth, json={'break_id': state['break']['id'], 'activities': []}).json()['result']['break'] is None
        body = {'section_id': f['section'], 'answer': 24, 'attempts': 999, 'time_taken_seconds': 1}
        first = client.post('/api/v1/practice/answer', headers=auth, json=body).json()['result']
        assert first['attempts'] == 1 and not first['canReveal']
        assert client.post('/api/v1/practice/reveal', headers=auth, json={'section_id': f['section']}).status_code == 409
        second = client.post('/api/v1/practice/answer', headers=auth, json=body).json()['result']
        assert second['attempts'] == 2 and second['canReveal']
        revealed = client.post('/api/v1/practice/reveal', headers=auth, json={'section_id': f['section']})
        assert revealed.status_code == 200, revealed.text
        assert revealed.json()['result']['answer'] == 25
        assert revealed.json()['result']['answerRevealed'] and not revealed.json()['result']['isCorrect']
        shortcut = client.post('/api/v1/test-tools/complete', headers=auth, json={'session_id': f['session']})
        assert shortcut.json()['result']['completed_via'] == 'calendar_test_shortcut'
