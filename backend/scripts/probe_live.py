"""Small live provider checks using synthetic curriculum; never accesses student rows."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from app.core.config import Settings
from app.core.llm import Gemini
from app.schemas.responses import TeachingAnswer, ReportNarrative
from app.agents.report import grounded


async def main():
    settings=Settings()
    outcomes={}
    async with httpx.AsyncClient(timeout=15) as http:
        try:
            response=await http.get(settings.issuer+'/.well-known/jwks.json')
            response.raise_for_status()
            outcomes['jwt_signing_algorithms']=[k.get('alg',k.get('kty')) for k in response.json().get('keys',[])]
        except Exception as error: outcomes['jwks']={'status':'unverified','error_type':type(error).__name__}
    llm=Gemini(settings)
    try:
        if not settings.gemini_api_key.get_secret_value():
            outcomes['gemini']='not configured'
        else:
            for name,call in [
                ('embedding', lambda: llm.embed('Add the ones and then the tens.',document=True)),
                ('teaching_generation', lambda: llm.structured('Explain only the supplied addition fact to a Class 2 student. Return JSON.',
                    {'lesson':'12 + 13 = 25. Add 2 ones and 3 ones to get 5 ones, then 1 ten and 1 ten to get 2 tens.', 'question':'How do I add 12 and 13?'},TeachingAnswer)),
                ('report_generation', lambda: llm.structured('Write an encouraging report using only these stats; give suggestions with no new numbers. Return JSON.',
                    {'current_score':68,'previous_score':71,'overall_delta':13},ReportNarrative))]:
                try:
                    result=await call()
                    outcomes[name]={'status':'passed','dimension':len(result)} if isinstance(result,list) else {'status':'passed'}
                except Exception as error:
                    outcomes[name]={'status':'failed','error_type':type(error).__name__}
    finally: await llm.close()
    print(json.dumps(outcomes))
    target=Path(__file__).resolve().parents[2]/'test-results'
    target.mkdir(exist_ok=True)
    (target/'live-provider.json').write_text(json.dumps(outcomes,indent=2))


asyncio.run(main())
