from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.errors import AppError
from app.main import create_app


def test_readiness_requires_learning_credentials(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/ready').status_code == 503
        assert client.get('/api/v1/health').status_code == 200


def test_readiness_checks_deployed_columns_relationships_and_vectors(settings):
    settings.gemini_api_key = SecretStr('test-key')
    db = AsyncMock()
    db.select.side_effect = [[], [], [], [], [], [], [], [{'id': 'section'}], [{'id': 'embedding'}]]
    with patch('app.api.health.service_database', return_value=db), TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/ready').json()['status'] == 'ready'
    assert db.select.call_args_list[-1].kwargs['embedding_model'] == 'eq.' + settings.gemini_embedding_model


def test_readiness_rejects_missing_embeddings(settings):
    settings.gemini_api_key = SecretStr('test-key')
    db = AsyncMock()
    db.select.side_effect = [[], [], [], [], [], [], [], [{'id': 'section'}], []]
    with patch('app.api.health.service_database', return_value=db), TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/ready').status_code == 503


def test_readiness_propagates_safe_database_failure(settings):
    settings.gemini_api_key = SecretStr('test-key')
    db = AsyncMock()
    db.select.side_effect = AppError('The learning database is temporarily unavailable.')
    with patch('app.api.health.service_database', return_value=db), TestClient(create_app(settings)) as client:
        response = client.get('/api/v1/ready')
        assert response.status_code == 503
        assert response.json()['detail'] == 'The learning database is temporarily unavailable.'
