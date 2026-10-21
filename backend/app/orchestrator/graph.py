from langgraph.graph import StateGraph, START, END

from app.agents import teaching, quiz, report
from app.core.errors import AppError
from app.core.logging import event
from app.orchestrator.state import GraphState
from app.services.audit import decision
from app.services.progress import refresh_progress


def route(state):
    kind = state['request_type']
    return 'report' if kind in ('report_requested', 'reports_requested') else 'quiz' if kind.startswith('quiz_') or kind == 'practice_recorded' else 'teaching'


def build_graph():
    async def agent(state, name):
        try:
            runtime, payload, kind = state['runtime'], state['payload'], state['request_type']
            if name == 'teaching':
                result, record = await teaching.run(runtime, payload, kind)
            elif name == 'quiz':
                result, record = await quiz.run(runtime, kind, payload)
            else:
                result, record = await report.run(runtime, kind, payload)
            output = {'result': result, 'decision_log': [*state.get('decision_log', []), record]}
            if name == 'report' and kind == 'quiz_completed':
                output['result'] = {**state['result'], 'report': result}
            if name == 'teaching':
                output['retrieved_context'] = result.get('context_ids', [])
            if name == 'quiz' and kind in ('quiz_started', 'quiz_loaded'):
                output['quiz_plan'] = result
            if name == 'report' and isinstance(result, dict):
                output['computed_stats'] = result.get('stats_snapshot', {})
            return output
        except Exception as error:
            event('agent_error', agent=name, error_type=type(error).__name__)
            safe = error if isinstance(error, AppError) else AppError()
            record = decision(name + '_agent', state['request_type'] + '_failed', state['payload'],
                              {'status': safe.status}, 'Operation failed; returned a safe error.')
            if name == 'report' and state['request_type'] == 'quiz_completed':
                return {'result': {**state['result'], 'report_pending': True},
                        'decision_log': [*state.get('decision_log', []), record]}
            return {'errors': [{'status': safe.status, 'message': safe.message}],
                    'decision_log': [*state.get('decision_log', []), record]}

    async def teaching_node(state):
        return await agent(state, 'teaching')

    async def quiz_node(state):
        return await agent(state, 'quiz')

    async def report_node(state):
        return await agent(state, 'report')

    async def progress_node(state):
        try:
            result = await refresh_progress(state['runtime'].db)
            record = decision('quiz_agent', 'mastery_refreshed', {}, {'progress': result},
                              'Refreshed mastery from persisted completed assessments and practice responses.')
            return {'decision_log': [*state['decision_log'], record]}
        except Exception as error:
            event('progress_error', error_type=type(error).__name__)
            record = decision('quiz_agent', 'mastery_refresh_pending', {}, {}, 'Score is saved; mastery refresh will be retried before generating its report.')
            return {'result': {**state['result'], 'report_pending': True}, 'decision_log': [*state['decision_log'], record]}

    def error_node(state):
        return {'errors': state.get('errors', [])}

    async def audit_node(state):
        runtime = state['runtime']
        try:
            await runtime.audit_writer(runtime.settings, runtime.http, state['user_id'], state['decision_log'])
            return {}
        except Exception as error:
            event('audit_failure', error_type=type(error).__name__)
            return {'errors': [*state.get('errors', []),
                {'status': 503, 'message': 'The operation could not be audited. Please retry.'}]}

    graph = StateGraph(GraphState)
    graph.add_node('router', lambda state: {'errors': [], 'decision_log': []})
    for name, node in [('teaching', teaching_node), ('quiz', quiz_node), ('progress', progress_node),
                       ('report', report_node), ('error_handler', error_node), ('audit', audit_node)]:
        graph.add_node(name, node)
    graph.add_edge(START, 'router')
    graph.add_conditional_edges('router', route, {'teaching': 'teaching', 'quiz': 'quiz', 'report': 'report'})
    graph.add_edge('teaching', 'error_handler')
    graph.add_conditional_edges('quiz', lambda s: 'progress' if not s.get('errors') and s['request_type'] == 'quiz_completed' else 'error_handler',
                                {'progress': 'progress', 'error_handler': 'error_handler'})
    graph.add_conditional_edges('progress', lambda s: 'error_handler' if s.get('errors') or s.get('result', {}).get('report_pending') else 'report',
                                {'report': 'report', 'error_handler': 'error_handler'})
    graph.add_edge('report', 'error_handler')
    graph.add_edge('error_handler', 'audit')
    graph.add_edge('audit', END)
    return graph.compile()  # Per-request stateless graph; durable state lives in PostgreSQL.
