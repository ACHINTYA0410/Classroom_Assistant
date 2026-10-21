from types import SimpleNamespace
from unittest.mock import AsyncMock
import asyncio
import httpx
import pytest
from pydantic import ValidationError
from app.core.errors import AppError
from app.core.llm import Gemini, LanguageServiceError
from app.schemas.responses import TeachingAnswer
from app.agents import teaching
from app.orchestrator.state import Runtime
from app.core.security import CurrentUser
from conftest import USER_A, SECTION


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('private-provider-secret')


def provider(settings, responses):
    llm = Gemini(settings)
    generate = AsyncMock(side_effect=responses)
    llm.client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
    return llm, generate


def answer():
    return SimpleNamespace(text='{"answer":"99 + 90 = 189.","sufficient_context":true}')


async def test_overload_fails_over_once(settings):
    llm, generate = provider(settings, [ProviderError(503), answer()])
    result = await llm.structured('Tutor', {'question': '99+90'}, TeachingAnswer)
    assert '189' in result.answer
    assert [c.kwargs['model'] for c in generate.call_args_list] == [
        settings.gemini_chat_model, settings.gemini_fallback_model]
    assert generate.call_args_list[1].kwargs['config'].thinking_config.thinking_level == 'LOW'


@pytest.mark.parametrize('error', [TimeoutError(), httpx.ReadTimeout('private-secret')])
async def test_transient_transport_uses_fallback(settings, error):
    llm, generate = provider(settings, [error, answer()])
    assert (await llm.structured('Tutor', {}, TeachingAnswer)).sufficient_context
    assert generate.await_count == 2


@pytest.mark.parametrize('code', [400, 401, 403, 404, 429])
async def test_auth_and_quota_errors_do_not_fail_over(settings, code):
    llm, generate = provider(settings, [ProviderError(code)])
    with pytest.raises(LanguageServiceError) as caught:
        await llm.structured('Tutor', {}, TeachingAnswer)
    assert caught.value.provider_status == code
    assert 'private' not in str(caught.value)
    assert generate.await_count == 1


@pytest.mark.parametrize('fallback', ['', 'gemini-3.8-flash'])
async def test_disabled_or_identical_fallback_is_not_retried(settings, fallback):
    settings.gemini_fallback_model = fallback
    llm, generate = provider(settings, [ProviderError(503)])
    with pytest.raises(LanguageServiceError):
        await llm.structured('Tutor', {}, TeachingAnswer)
    assert generate.await_count == 1


async def test_both_models_down_stays_bounded(settings):
    llm, generate = provider(settings, [ProviderError(503), ProviderError(503)])
    with pytest.raises(LanguageServiceError):
        await llm.structured('Tutor', {}, TeachingAnswer)
    assert generate.await_count == 2


async def test_cancellation_never_fails_over(settings):
    llm, generate = provider(settings, [asyncio.CancelledError()])
    with pytest.raises(asyncio.CancelledError):
        await llm.structured('Tutor', {}, TeachingAnswer)
    assert generate.await_count == 1


async def test_invalid_json_is_not_presented_as_an_answer(settings):
    llm, generate = provider(settings, [SimpleNamespace(text='not JSON')])
    with pytest.raises(ValidationError):
        await llm.structured('Tutor', {}, TeachingAnswer)
    assert generate.await_count == 1


async def test_truncated_valid_json_is_rejected(settings):
    result = answer()
    result.candidates = [SimpleNamespace(finish_reason='MAX_TOKENS')]
    llm, _ = provider(settings, [result])
    with pytest.raises(AppError, match='complete answer'):
        await llm.structured('Tutor', {}, TeachingAnswer)


@pytest.mark.parametrize('mode,reason,message', [
    ('busy', 'generation_unavailable', teaching.SERVICE_FALLBACK),
    ('missing', 'insufficient_context', teaching.FALLBACK),
    ('declined', 'insufficient_context', teaching.FALLBACK),
    ('retrieval', 'retrieval_unavailable', teaching.SERVICE_FALLBACK),
])
async def test_teaching_distinguishes_provider_failure_from_missing_evidence(settings, monkeypatch, mode, reason, message):
    context = {'section_id':SECTION,'content':'Add ones and tens.','grade':2,'style':'text','weak_topics':[]}
    monkeypatch.setattr(teaching, 'lesson_context', AsyncMock(return_value=context))
    retrieve = AsyncMock(return_value=[] if mode == 'missing' else [{'id':SECTION,'source_text':'Add ones, then tens.'}])
    if mode == 'retrieval':
        retrieve.side_effect = TimeoutError()
    monkeypatch.setattr(teaching, 'retrieve', retrieve)
    llm = SimpleNamespace(structured=AsyncMock(return_value=TeachingAnswer(answer='Outside context',sufficient_context=False)))
    if mode == 'busy':
        llm.structured.side_effect = LanguageServiceError(503,retryable=True)
    runtime = Runtime(settings,CurrentUser(USER_A,'unit-token'),SimpleNamespace(rpc=AsyncMock()),llm,None,AsyncMock())
    result, audit = await teaching.run(runtime, {'section_id':SECTION,'question':'99+90'})
    assert result['fallback_reason'] == reason
    assert result['answer'] == message
    assert audit['output']['fallback_reason'] == reason
