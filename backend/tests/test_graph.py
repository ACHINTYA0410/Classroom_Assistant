from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.core.errors import AppError
from app.core.security import CurrentUser
from app.orchestrator.graph import build_graph
from app.orchestrator.state import Runtime
from app.schemas.responses import TeachingAnswer, ReportNarrative
from conftest import USER_A, ATTEMPT, SECTION


class MemoryDatabase:
    """Test double only; production agents always use the HTTP database client."""
    def __init__(self):
        self.calls=[]
    async def rpc(self,name,**args):
        self.calls.append(name)
        if name=='finish_quiz_attempt': return {'correctCount':1,'totalQuestions':7,'scorePercentage':100/7,'accuracyPercentage':100,'missedQuestions':[]}
        if name=='refresh_student_progress': return []
        if name=='check_learning_available': return True
        if name=='student_report_input': return {'history':[{'id':ATTEMPT,'score':100/7,'accuracy':100}], 'progress':[]}
        if name=='match_curriculum': return [{'id':SECTION,'source_text':'Add the ones and then the tens.'}]
        raise AssertionError(name)
    async def select(self,table,**args):
        self.calls.append(table)
        if table=='profiles': return [{'grade_level':2,'preferred_explanation_style':'text'}]
        if table=='session_sections': return [{'content':'Add the ones then the tens.','sessions':{'topic_id':'addition','weeks':{'chapter_id':SECTION,'chapters':{'grade_level':2}}}}]
        if table=='student_progress': return [{'topic_id':'addition','topic_name':'Addition','primary_misconception_tag':'carry'}]
        if table=='reports': return []
        raise AssertionError(table)
    async def upsert(self,table,row,conflict):
        self.calls.append(table)
        return [{'id':SECTION,**row}]


@pytest.fixture
def runtime(settings, monkeypatch):
    database = MemoryDatabase()
    monkeypatch.setattr('app.agents.report.service_database', lambda *_: database)
    return Runtime(settings,CurrentUser(USER_A,'user-token'),database,
        SimpleNamespace(embed=AsyncMock(return_value=[0.1]*768),structured=AsyncMock()),None,AsyncMock())


async def test_real_graph_cross_agent_completion(runtime):
    runtime.llm.structured.return_value=ReportNarrative(narrative='Keep practicing the lesson.',suggestions=['Work through an example slowly.'])
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'quiz_completed','payload':{'attempt_id':ATTEMPT},'runtime':runtime})
    assert not result['errors']
    assert runtime.db.calls.index('finish_quiz_attempt')<runtime.db.calls.index('refresh_student_progress')<runtime.db.calls.index('student_report_input')
    assert result['result']['report']['narrative']
    records=runtime.audit_writer.call_args.args[3]
    assert [r['agent_name'] for r in records]==['quiz_agent','quiz_agent','report_agent']


async def test_teaching_consults_progress_before_generation(runtime):
    runtime.llm.structured.return_value=TeachingAnswer(answer='Add the ones first.',sufficient_context=True)
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'student_question',
        'payload':{'section_id':SECTION,'question':'How do I add?'},'runtime':runtime})
    assert result['result']['context_ids']==[SECTION]
    assert 'student_progress' in runtime.db.calls
    assert runtime.llm.structured.call_args.args[1]['weak_topics']
    assert runtime.audit_writer.call_args.args[3][0]['agent_name']=='teaching_agent'


async def test_teaching_failure_returns_friendly_fallback_and_audit(runtime):
    runtime.llm.embed.side_effect=TimeoutError()
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'student_question',
        'payload':{'section_id':SECTION,'question':'Help'},'runtime':runtime})
    assert not result['errors']
    assert result['result']['fallback']
    assert not result['result']['sufficient_context']
    runtime.audit_writer.assert_awaited_once()


async def test_error_path_reaches_audit(runtime):
    runtime.db.rpc=AsyncMock(side_effect=AppError('Not permitted.',403))
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'quiz_started','payload':{'quiz_id':SECTION},'runtime':runtime})
    assert result['errors'][0]['status']==403
    runtime.audit_writer.assert_awaited_once()
    assert result['decision_log'][0]['decision_type']=='quiz_started_failed'


async def test_audit_failure_never_claims_success(runtime):
    runtime.audit_writer.side_effect=RuntimeError('private-secret-do-not-echo')
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'reports_requested','payload':{},'runtime':runtime})
    assert result['errors'][0]['status']==503
    assert 'private-secret' not in str(result['errors'])


@pytest.mark.parametrize('failure',[False,True])
async def test_report_fallback_for_ungrounded_or_failed_generation(runtime,failure):
    if failure: runtime.llm.structured.side_effect=RuntimeError('invalid key')
    else: runtime.llm.structured.return_value=ReportNarrative(narrative='You scored 999%.',suggestions=['Try 999 questions.'])
    result=await build_graph().ainvoke({'user_id':USER_A,'request_type':'report_requested','payload':{'attempt_id':ATTEMPT},'runtime':runtime})
    assert result['result']['stats_snapshot']['narrative_fallback']
    assert '999' not in result['result']['narrative']
