import time
from uuid import UUID

import jwt
import pytest
from app.core.config import Settings

USER_A = str(UUID(int=1))
USER_B = str(UUID(int=2))
ATTEMPT = str(UUID(int=10))
SECTION = str(UUID(int=20))
QUESTION = str(UUID(int=30))
SECRET = 'isolated-unit-test-signing-secret-32-characters'


@pytest.fixture
def settings():
    return Settings(_env_file=None, supabase_url='https://unit-test.supabase.co',
        supabase_anon_key='public-test-key', supabase_service_role_key='private-test-key',
        supabase_jwt_secret=SECRET, gemini_api_key='')


def token(settings, **overrides):
    claims = {'sub': USER_A, 'role': 'authenticated', 'aud': 'authenticated', 'iss': settings.issuer,
              'iat': int(time.time()), 'exp': int(time.time()) + 300, **overrides}
    return jwt.encode(claims, SECRET, algorithm='HS256')
