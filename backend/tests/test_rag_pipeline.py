"""Every doubt, including arithmetic, must use retrieval and grounded generation."""
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
import pytest
from app.main import create_app
from app.core.llm import LanguageServiceError
from app.schemas.responses import TeachingAnswer
from conftest import SECTION, token

@pytest.mark.parametrize('question', ['Can you do 99+90','58+36','How does carrying work?'])
@pytest.mark.parametrize('mode', ['grounded','no_evidence','provider_down'])
def test_http_doubt_never_bypasses_rag(settings, monkeypatch, question, mode):
    calls=[]
    class Db:
        async def rpc(self,name,**args):
            calls.append((name,args))
            if name=='check_learning_available': return True
            if name=='match_curriculum':
                return [] if mode=='no_evidence' else [{'id':SECTION,'source_text':'Add the ones, then tens; regroup ten tens into a hundred.'}]
            raise AssertionError(name)
        async def select(self,table,**args):
            if table=='profiles': return [{'grade_level':2,'preferred_explanation_style':'text'}]
            if table=='session_sections':
                return [{'content':'Add ones and tens.','sessions':{'topic_id':'addition_2_digit_regrouping','weeks':{'chapter_id':SECTION,'chapters':{'grade_level':2}}}}]
            if table=='student_progress': return []
            raise AssertionError(table)
    monkeypatch.setattr('app.api.orchestrate.user_database',lambda *_: Db())
    app=create_app(settings)
    with TestClient(app) as client:
        app.state.audit_writer=AsyncMock()
        app.state.llm.embed=AsyncMock(return_value=[0.1]*768)
        app.state.llm.structured=AsyncMock(return_value=TeachingAnswer(answer='Grounded tutor answer.',sufficient_context=True))
        if mode=='provider_down':
            app.state.llm.structured.side_effect=LanguageServiceError(503,retryable=True)
        response=client.post('/api/v1/teaching/ask',headers={'Authorization':'Bearer '+token(settings)},json={'section_id':SECTION,'question':question})
        assert response.status_code==200
        result=response.json()['result']
        app.state.llm.embed.assert_awaited_once_with(question)
        match=next(args for name,args in calls if name=='match_curriculum')
        assert match['p_topic_id']=='addition_2_digit_regrouping'
        assert match['p_grade']==2 and match['p_chapter_id']==SECTION
        assert match['p_model']==settings.gemini_embedding_model and match['p_dimension']==768
        assert result['answer_source']=='curriculum_generation'
        if mode=='grounded':
            assert not result['fallback'] and result['context_ids']==[SECTION]
            assert result['answer']=='Grounded tutor answer.'
            data=app.state.llm.structured.call_args.args[1]
            assert data['student_question']==question
            assert data['curriculum'][0]['id']==SECTION and data['current_lesson']
        elif mode=='no_evidence':
            app.state.llm.structured.assert_not_awaited()
            assert result['fallback_reason']=='insufficient_context' and result['context_ids']==[]
        else:
            assert result['fallback_reason']=='generation_unavailable'
            assert result['fallback'] and not result['sufficient_context']
            assert '189' not in result['answer']
        app.state.audit_writer.assert_awaited_once()
