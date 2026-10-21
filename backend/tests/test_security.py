import json
import time

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives.asymmetric import rsa, ec
from fastapi.testclient import TestClient

from app.core.security import TokenVerifier
from app.main import create_app
from conftest import token, USER_A, SECRET


async def test_valid_legacy(settings):
    async with httpx.AsyncClient() as http:
        user = await TokenVerifier(settings, http).verify(token(settings))
        assert user.id == USER_A


@pytest.mark.parametrize('changes', [{'exp': 1}, {'aud': 'other'}, {'iss': 'https://attacker.invalid'}, {'role': 'service_role'}, {'sub': 'not-a-uuid'}])
async def test_invalid_claims(settings, changes):
    async with httpx.AsyncClient() as http:
        with pytest.raises((ValueError, jwt.PyJWTError)):
            await TokenVerifier(settings, http).verify(token(settings, **changes))


async def test_tampered_signature(settings):
    signed = token(settings)
    claims = jwt.decode(signed, options={'verify_signature': False})
    forged = jwt.encode(claims, 'another-invalid-test-secret-32-characters', algorithm='HS256')
    async with httpx.AsyncClient() as http:
        with pytest.raises(jwt.InvalidSignatureError):
            await TokenVerifier(settings, http).verify(forged)


@respx.mock
async def test_asymmetric_jwks_and_rotation(settings):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid='test-rsa', alg='RS256')
    route = respx.get(settings.issuer + '/.well-known/jwks.json').mock(return_value=httpx.Response(200, json={'keys': [jwk]}))
    claims = jwt.decode(token(settings), options={'verify_signature': False})
    signed = jwt.encode(claims, key, algorithm='RS256', headers={'kid': 'test-rsa'})
    async with httpx.AsyncClient() as http:
        verifier = TokenVerifier(settings, http)
        assert (await verifier.verify(signed)).id == USER_A
        assert (await verifier.verify(signed)).id == USER_A
        assert route.call_count == 1


@respx.mock
async def test_es256_key_rotation(settings):
    claims = jwt.decode(token(settings), options={'verify_signature': False})
    keys = [ec.generate_private_key(ec.SECP256R1()) for _ in range(2)]
    jwks = []
    for i, key in enumerate(keys):
        jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(key.public_key()))
        jwk.update(kid=f'es-{i}', alg='ES256')
        jwks.append(jwk)
    route = respx.get(settings.issuer + '/.well-known/jwks.json').mock(side_effect=[
        httpx.Response(200,json={'keys':[jwks[0]]}),httpx.Response(200,json={'keys':jwks})])
    async with httpx.AsyncClient() as http:
        verifier = TokenVerifier(settings,http)
        for i,key in enumerate(keys):
            signed=jwt.encode(claims,key,algorithm='ES256',headers={'kid':f'es-{i}'})
            assert (await verifier.verify(signed)).id == USER_A
        assert route.call_count == 2


@pytest.mark.parametrize('claim', ['exp','iat','sub','aud','iss'])
async def test_required_claims(settings,claim):
    claims=jwt.decode(token(settings),options={'verify_signature':False})
    del claims[claim]
    async with httpx.AsyncClient() as http:
        with pytest.raises(jwt.MissingRequiredClaimError):
            await TokenVerifier(settings,http).verify(jwt.encode(claims,SECRET,algorithm='HS256'))


@respx.mock
async def test_legacy_remote_auth_verification(settings):
    settings.supabase_jwt_secret = ''
    # assignment intentionally does not validate; supply SecretStr to mirror env parsing
    from pydantic import SecretStr
    settings.supabase_jwt_secret = SecretStr('')
    respx.get(settings.issuer + '/user').mock(return_value=httpx.Response(200, json={'id': USER_A}))
    async with httpx.AsyncClient() as http:
        assert (await TokenVerifier(settings, http).verify(token(settings))).id == USER_A
        with pytest.raises(ValueError):
            await TokenVerifier(settings, http).verify(token(settings, exp=1))


@pytest.mark.parametrize('path,body', [('/teaching/ask', {'section_id': USER_A, 'question': 'Help'}),
    ('/quiz/start', {'quiz_id': USER_A}), ('/quiz/finish', {'attempt_id': USER_A}),
    ('/reports/generate', {'attempt_id': USER_A}), ('/orchestrate', {'request_type':'reports_requested','payload':{}})])
def test_missing_and_invalid_tokens_are_401(settings, path, body):
    with TestClient(create_app(settings)) as client:
        assert client.post('/api/v1'+path, json=body).status_code == 401
        assert client.post('/api/v1'+path, json=body, headers={'Authorization':'Bearer tampered'}).status_code == 401


def test_input_rejects_spoofed_user_id(settings):
    with TestClient(create_app(settings)) as client:
        response = client.post('/api/v1/teaching/ask', headers={'Authorization':'Bearer '+token(settings)},
            json={'section_id':USER_A,'question':'Help','user_id':USER_A})
        assert response.status_code == 422
        assert 'user_id' not in response.text  # safe validation response does not echo payload


def test_health_and_cors(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/health').json()['status'] == 'ok'
        allowed = client.options('/api/v1/teaching/ask', headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'POST'})
        blocked = client.options('/api/v1/teaching/ask', headers={'Origin':'https://untrusted.invalid','Access-Control-Request-Method':'POST'})
        assert allowed.status_code == 200
        assert blocked.status_code == 400
