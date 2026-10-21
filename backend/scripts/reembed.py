"""Deliberately re-embed curriculum with recorded model/dimension; preserves unknown legacy rows."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from app.core.config import Settings
from app.core.llm import Gemini
from app.core.supabase_client import service_database


async def main():
    settings = Settings()
    llm = Gemini(settings)
    async with httpx.AsyncClient(timeout=30) as http:
        db = service_database(settings, http)
        offset, count = 0, 0
        try:
            while True:
                sections = await db.select('session_sections', select='id,content,sessions!inner(topic_id,weeks!inner(chapter_id,chapters!inner(grade_level)))',
                                           content='not.is.null', order='id', limit='100', offset=str(offset))
                if not sections:
                    break
                for section in sections:
                    session = section['sessions']
                    if not section['content'].strip() or not session['topic_id']:
                        continue
                    vector = await llm.embed(section['content'], document=True)
                    await db.upsert('curriculum_embeddings', {
                        'session_section_id': section['id'], 'source_text': section['content'],
                        'topic_id': session['topic_id'], 'chapter_id': session['weeks']['chapter_id'],
                        'grade_level': session['weeks']['chapters']['grade_level'], 'embedding': vector,
                        'embedding_model': settings.gemini_embedding_model, 'embedding_dimension': settings.embedding_dimension,
                    }, 'session_section_id,embedding_model')
                    count += 1
                offset += len(sections)
        finally:
            await llm.close()
    print(f'Re-embedded {count} sections with explicit model provenance.')


if __name__ == '__main__':
    asyncio.run(main())
