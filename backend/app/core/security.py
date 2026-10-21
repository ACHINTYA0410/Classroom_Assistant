import time
from dataclasses import dataclass
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    token: str


class TokenVerifier:
    def __init__(self, settings: Settings, http: httpx.AsyncClient):
        self.settings, self.http = settings, http
        self.keys, self.cached_until = [], 0.0

    async def verify(self, token: str) -> CurrentUser:
        if len(token) > 16384:
            raise ValueError('Token too large')
        header = jwt.get_unverified_header(token)
        algorithm = header.get('alg')
        options = {'require': ['exp', 'iat', 'sub', 'aud', 'iss']}
        kwargs = dict(audience=self.settings.jwt_audience, issuer=self.settings.issuer, options=options)
        if algorithm in ('RS256', 'ES256'):
            if time.monotonic() >= self.cached_until or not any(k.get('kid') == header.get('kid') for k in self.keys):
                response = await self.http.get(self.settings.issuer + '/.well-known/jwks.json')
                response.raise_for_status()
                self.keys = response.json().get('keys', [])
                self.cached_until = time.monotonic() + 300
            key = next((k for k in self.keys if k.get('kid') == header.get('kid') and k.get('alg', algorithm) == algorithm), None)
            if key is None:
                raise ValueError('Unknown signing key')
            claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=[algorithm], **kwargs)
        elif algorithm == 'HS256':
            secret = self.settings.supabase_jwt_secret.get_secret_value()
            if secret:
                claims = jwt.decode(token, secret, algorithms=['HS256'], **kwargs)
            else:
                # Supabase Auth verifies legacy signatures when the shared secret is unavailable.
                response = await self.http.get(self.settings.issuer + '/user', headers={
                    'apikey': self.settings.supabase_anon_key.get_secret_value(),
                    'Authorization': 'Bearer ' + token,
                })
                response.raise_for_status()
                claims = jwt.decode(token, options={'verify_signature': False})
                now = time.time()
                if (not all(k in claims for k in ('exp', 'iat', 'sub', 'aud', 'iss'))
                    or claims['exp'] <= now or claims['iat'] > now + 30
                    or claims.get('nbf', 0) > now or claims['iss'] != self.settings.issuer
                    or self.settings.jwt_audience not in ([claims['aud']] if isinstance(claims['aud'], str) else claims['aud'])
                    or response.json().get('id') != claims['sub']):
                    raise ValueError('Invalid claims')
        else:
            raise ValueError('Unsupported signing algorithm')
        if claims.get('role') != 'authenticated':
            raise ValueError('Not a student token')
        return CurrentUser(str(UUID(claims['sub'])), token)


async def current_user(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, 'Please sign in to continue.', headers={'WWW-Authenticate': 'Bearer'})
    try:
        return await request.app.state.verifier.verify(credentials.credentials)
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, httpx.HTTPError):
        raise HTTPException(401, 'Your session is invalid or expired. Please sign in again.',
                            headers={'WWW-Authenticate': 'Bearer'}) from None
