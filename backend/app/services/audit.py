from app.core.supabase_client import service_database


def decision(agent, kind, inputs, output, reason, context_ids=None, linked_id=None):
    return {'agent_name': agent, 'decision_type': kind, 'input_snapshot': inputs,
            'output': output, 'reasoning_summary': reason,
            'retrieved_context_ids': context_ids or [], 'linked_entity_id': linked_id}


async def write_decisions(settings, http, user_id, records):
    db = service_database(settings, http)
    await db.insert('agent_decisions', [{**r, 'student_id': user_id} for r in records])
