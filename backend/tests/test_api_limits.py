import asyncio
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from app.api.orchestrate import RateLimiter
from app.core.errors import AppError
from app.main import create_app
from conftest import token, USER_A, USER_B


def test_rate_limit_is_user_scoped():
    limiter=RateLimiter()
    limiter.check(USER_A,1)
    with pytest.raises(AppError) as error:
        limiter.check(USER_A,1)
    assert error.value.status==429
    limiter.check(USER_B,1)


def test_request_timeout_is_safe_and_audited(settings):
    settings.request_timeout_seconds=0.01
    app=create_app(settings)
    async def slow(*args,**kwargs):
        await asyncio.sleep(1)
    with TestClient(app) as client:
        app.state.graph.ainvoke=slow
        app.state.audit_writer=AsyncMock()
        response=client.post('/api/v1/teaching/ask',headers={'Authorization':'Bearer '+token(settings)},
                             json={'section_id':USER_A,'question':'Help'})
        assert response.status_code==504
        assert 'took too long' in response.text
        app.state.audit_writer.assert_awaited_once()


def test_missing_audit_configuration_prevents_mutation(settings):
    from pydantic import SecretStr
    settings.supabase_service_role_key=SecretStr('')
    app=create_app(settings)
    with TestClient(app) as client:
        app.state.graph.ainvoke=AsyncMock()
        response=client.post('/api/v1/quiz/start',headers={'Authorization':'Bearer '+token(settings)},json={'quiz_id':USER_A})
        assert response.status_code==503
        app.state.graph.ainvoke.assert_not_awaited()
