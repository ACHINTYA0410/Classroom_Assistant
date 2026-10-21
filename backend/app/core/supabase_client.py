import httpx

from app.core.config import Settings
from app.core.errors import AppError


class Database:
    """Async PostgREST client. An instance is always bound to exactly one principal."""
    def __init__(self, settings: Settings, http: httpx.AsyncClient, token: str, *, service=False):
        self.http = http
        self.base = settings.supabase_url.rstrip('/') + '/rest/v1/'
        key = settings.supabase_service_role_key if service else settings.supabase_anon_key
        if not key.get_secret_value():
            raise AppError('Backend database credentials are not configured.')
        self.headers = {'apikey': key.get_secret_value(), 'Authorization': f'Bearer {token}'}

    async def request(self, method, path, *, params=None, body=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers['Prefer'] = prefer
        response = await self.http.request(method, self.base + path, params=params, json=body, headers=headers)
        if response.is_error:
            status = response.status_code
            code = ''
            try:
                code = response.json().get('code', '')
            except ValueError:
                pass
            if status == 401:
                raise AppError('Please sign in again.', 401)
            if code == '42501' or status == 403:
                raise AppError('This action is not permitted for your account.', 403)
            if code == 'P0001':
                # RPC business failures, never relay arbitrary SQL/server details.
                raise AppError('The assessment is unavailable, expired, or its required lessons are incomplete.', 409)
            raise AppError('The learning database is temporarily unavailable.')
        return response.json() if response.content else None

    async def select(self, table, **params):
        return await self.request('GET', table, params=params)

    async def rpc(self, name, **params):
        return await self.request('POST', 'rpc/' + name, body=params)

    async def insert(self, table, rows):
        return await self.request('POST', table, body=rows, prefer='return=representation')

    async def upsert(self, table, row, conflict):
        return await self.request('POST', table, body=row, params={'on_conflict': conflict},
                                  prefer='resolution=merge-duplicates,return=representation')


def user_database(settings, http, token):
    return Database(settings, http, token)


def service_database(settings, http):
    return Database(settings, http, settings.supabase_service_role_key.get_secret_value(), service=True)
