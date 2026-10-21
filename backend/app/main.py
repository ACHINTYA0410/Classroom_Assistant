from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, orchestrate, teaching, quiz, report, learning
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.llm import Gemini
from app.core.logging import configure_logging, event
from app.core.security import TokenVerifier
from app.orchestrator.graph import build_graph
from app.services.audit import write_decisions


def create_app(settings=None):
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app):
        configure_logging()
        async with httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=50)) as http:
            app.state.http = http
            app.state.verifier = TokenVerifier(settings, http)
            app.state.llm = Gemini(settings)
            app.state.audit_writer = write_decisions
            app.state.graph = build_graph()
            app.state.limiter = orchestrate.RateLimiter()
            yield
            await app.state.llm.close()

    app = FastAPI(title='Classroom Assistant API', version='1.0.0', lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                       allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type'])

    @app.middleware('http')
    async def request_id(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers['X-Request-ID'] = request.state.request_id
        event('request', request_id=request.state.request_id, status=response.status_code)
        return response

    @app.exception_handler(AppError)
    async def app_error(request, error):
        return JSONResponse({'detail': error.message, 'request_id': request.state.request_id},
                            status_code=error.status,
                            headers={'Retry-After': '60'} if error.status == 429 else None)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Do not echo rejected free-text, bearer tokens or request bodies.
        return JSONResponse({'detail': 'Invalid request. Check the required fields and values.'}, status_code=422)

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        event('unexpected_error', error_type=type(error).__name__, request_id=request.state.request_id)
        return JSONResponse({'detail': 'The service is temporarily unavailable.'}, status_code=503)

    for module in (health, orchestrate, teaching, quiz, report, learning):
        app.include_router(module.router, prefix='/api/v1')
    return app


app = create_app()
