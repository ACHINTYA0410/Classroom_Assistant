from uuid import UUID
from fastapi import APIRouter, Depends, Request
from app.api.orchestrate import execute
from app.core.security import current_user
from app.schemas.requests import QuizStart, AnswerRequest, AttemptRequest, PracticeRequest
from app.schemas.responses import Envelope, QuizPlan, QuizResult, AnswerResult, PracticeResult

router = APIRouter()


@router.post('/quiz/start', response_model=Envelope[QuizPlan])
async def start(body: QuizStart, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'quiz_started', body.model_dump(mode='json'))


@router.get('/quiz/{attempt_id}', response_model=Envelope[QuizPlan])
async def load(attempt_id: UUID, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'quiz_loaded', {'attempt_id': str(attempt_id)})


@router.post('/quiz/answer', response_model=Envelope[AnswerResult])
async def answer(body: AnswerRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'quiz_answered', body.model_dump(mode='json'))


@router.post('/quiz/finish', response_model=Envelope[QuizResult])
async def finish(body: AttemptRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'quiz_completed', body.model_dump(mode='json'))


@router.post('/practice/answer', response_model=Envelope[PracticeResult])
async def practice(body: PracticeRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'practice_recorded', body.model_dump(mode='json'))
