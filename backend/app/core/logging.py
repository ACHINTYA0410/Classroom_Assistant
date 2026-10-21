import json
import logging

logger = logging.getLogger('classroom')


def event(name: str, **fields):
    """Log only explicitly selected metadata, never exception text, prompts or headers."""
    allowed = {'request_id', 'status', 'error_type', 'agent', 'operation'}
    logger.info(json.dumps({'event': name, **{k: v for k, v in fields.items() if k in allowed}}))


def configure_logging():
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    for name in ('httpx', 'httpcore', 'google_genai', 'google.genai'):
        logging.getLogger(name).setLevel(logging.CRITICAL)
