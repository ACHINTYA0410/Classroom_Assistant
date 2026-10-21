import asyncio
import json
import math
import httpx

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.errors import AppError
from app.core.logging import event


class LanguageServiceError(AppError):
    """Safe provider metadata; never preserve credentials or raw provider text."""
    def __init__(self, provider_status=None, *, retryable=False):
        super().__init__('The language service is temporarily unavailable.')
        self.provider_status = provider_status
        self.retryable = retryable


class Gemini:
    def __init__(self, settings):
        self.settings = settings
        key = settings.gemini_api_key.get_secret_value()
        self.client = genai.Client(api_key=key, http_options=types.HttpOptions(
            timeout=int(settings.llm_timeout_seconds * 1000),
            retry_options=types.HttpRetryOptions(attempts=1))) if key else None

    async def close(self):
        if self.client:
            await self.client.aio.aclose()

    async def _call(self, operation, *, attempts=2):
        if not self.client:
            raise AppError('The language service is not configured.')
        for attempt in range(attempts):
            try:
                return await asyncio.wait_for(operation(), self.settings.llm_timeout_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                code = getattr(error, 'code', None)
                retryable = code in (500, 502, 503, 504) or isinstance(error, (TimeoutError, ConnectionError, httpx.TransportError))
                if attempt + 1 >= attempts or (code is not None and code not in (429, 500, 502, 503, 504)):
                    raise LanguageServiceError(code, retryable=retryable) from None
                await asyncio.sleep(1)

    async def structured(self, system: str, data: dict, schema: type[BaseModel]):
        async def generate(model):
            # One bounded attempt per model; no hidden SDK retries or quota bypass.
            thinking = types.ThinkingConfig(thinking_level='low') if model.startswith('gemini-3') else None
            return await self._call(lambda: self.client.aio.models.generate_content(
                model=model, contents=json.dumps(data),
                config=types.GenerateContentConfig(system_instruction=system,
                    response_mime_type='application/json', response_schema=schema,
                    thinking_config=thinking, max_output_tokens=2400)), attempts=1)

        try:
            result = await generate(self.settings.gemini_chat_model)
        except LanguageServiceError as error:
            fallback = self.settings.gemini_fallback_model
            if not error.retryable or not fallback or fallback == self.settings.gemini_chat_model:
                raise
            event('generation_failover', status=error.provider_status, operation='structured')
            result = await generate(fallback)
        # Never accept truncated, blocked or malformed model output as a real answer.
        for candidate in getattr(result, 'candidates', None) or []:
            if candidate.finish_reason and str(candidate.finish_reason) not in ('STOP', 'FinishReason.STOP'):
                raise AppError('The language service did not return a complete answer.')
        return schema.model_validate_json(result.text or '{}')

    async def embed(self, text: str, *, document=False):
        result = await self._call(lambda: self.client.aio.models.embed_content(
            model=self.settings.gemini_embedding_model, contents=text,
            config=types.EmbedContentConfig(output_dimensionality=self.settings.embedding_dimension,
                task_type='RETRIEVAL_DOCUMENT' if document else 'RETRIEVAL_QUERY')))
        vector = result.embeddings[0].values
        if len(vector) != self.settings.embedding_dimension or not all(math.isfinite(x) for x in vector):
            raise AppError('Embedding dimensions do not match the curriculum.')
        norm = math.sqrt(sum(x*x for x in vector))
        if not norm:
            raise AppError('Invalid embedding.')
        return [x / norm for x in vector]
