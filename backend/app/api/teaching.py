from fastapi import APIRouter, Depends, Request
from app.api.orchestrate import execute
from app.core.security import current_user
from app.schemas.requests import TeachingRequest
from app.schemas.responses import Envelope, TeachingResult

router = APIRouter()


@router.post('/teaching/ask', response_model=Envelope[TeachingResult])
async def ask(body: TeachingRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'student_question', body.model_dump(mode='json'))
