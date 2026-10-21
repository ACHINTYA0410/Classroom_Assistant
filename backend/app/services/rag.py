from app.core.errors import AppError


async def lesson_context(db, user_id, section_id):
    profiles = await db.select('profiles', select='grade_level,preferred_explanation_style', id=f'eq.{user_id}')
    sections = await db.select('session_sections', select='id,content,sessions!inner(topic_id,weeks!inner(chapter_id,chapters!inner(grade_level)))', id=f'eq.{section_id}')
    if not profiles or not sections:
        raise AppError('This lesson is unavailable.', 404)
    profile, section = profiles[0], sections[0]
    session = section['sessions']
    grade = session['weeks']['chapters']['grade_level']
    if grade != profile['grade_level']:
        raise AppError('Choose a lesson for your current grade.', 403)
    weak = await db.select('student_progress', select='topic_id,topic_name,primary_misconception_tag',
                           student_id=f'eq.{user_id}', mastery_status='eq.weak', limit='20')
    return {'section_id': section_id, 'content': section['content'] or '',
            'topic_id': session['topic_id'], 'chapter_id': session['weeks']['chapter_id'],
            'grade': grade, 'style': profile.get('preferred_explanation_style') or 'text', 'weak_topics': weak}


async def retrieve(db, llm, settings, context, query):
    vector = await llm.embed(query)
    return await db.rpc('match_curriculum', query_embedding=vector, p_topic_id=context['topic_id'],
                        p_chapter_id=context['chapter_id'], p_grade=context['grade'],
                        p_model=settings.gemini_embedding_model, p_dimension=settings.embedding_dimension,
                        match_threshold=0.2, match_count=4)
