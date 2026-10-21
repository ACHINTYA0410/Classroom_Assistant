from fastapi import APIRouter, Depends, Request
from app.api.orchestrate import execute
from app.core.security import current_user
from app.schemas.requests import AttemptRequest
from app.schemas.responses import Envelope, LearningReport

router = APIRouter()


@router.get('/reports', response_model=Envelope[list[LearningReport]])
async def reports(request: Request, user=Depends(current_user)):
    return await execute(request, user, 'reports_requested', {})


@router.post('/reports/generate', response_model=Envelope[LearningReport])
async def generate(body: AttemptRequest, request: Request, user=Depends(current_user)):
    return await execute(request, user, 'report_requested', body.model_dump(mode='json'))
