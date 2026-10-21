from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / '.env', extra='ignore'
    )
    supabase_url: str = 'http://127.0.0.1:54321'
    supabase_anon_key: SecretStr = SecretStr('')
    supabase_service_role_key: SecretStr = SecretStr('')
    supabase_jwt_secret: SecretStr = SecretStr('')
    jwt_audience: str = 'authenticated'
    gemini_api_key: SecretStr = SecretStr('')
    gemini_chat_model: str = 'gemini-3.8-flash'
    gemini_fallback_model: str = 'gemini-3.5-flash-lite'
    gemini_embedding_model: str = 'gemini-embedding-001'
    embedding_dimension: int = 768
    allowed_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']
    request_timeout_seconds: float = Field(45, ge=1, le=120)
    llm_timeout_seconds: float = Field(12, ge=0.1, le=45)
    llm_requests_per_minute: int = Field(20, ge=1, le=1000)
    enable_test_tools: bool = False

    @field_validator('allowed_origins')
    @classmethod
    def explicit_origins(cls, origins):
        if not origins or any('*' in o or not o.startswith(('http://', 'https://')) for o in origins):
            raise ValueError('ALLOWED_ORIGINS must contain explicit HTTP origins')
        return [o.rstrip('/') for o in origins]

    @field_validator('embedding_dimension')
    @classmethod
    def supported_dimension(cls, value):
        if value != 768:
            raise ValueError('The deployed curriculum schema requires 768 dimensions')
        return value

    @property
    def issuer(self):
        return self.supabase_url.rstrip('/') + '/auth/v1'


@lru_cache
def get_settings():
    return Settings()
