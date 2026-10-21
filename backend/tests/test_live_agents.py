"""Opt-in paid provider calls, with all database writes confined to ephemeral PGlite."""
import json
import os
import pytest
from test_database_integration import isolated_database, run_agent_scenario, ROOT


@pytest.mark.live
@pytest.mark.skipif(os.getenv('RUN_LIVE_GEMINI') != '1', reason='Set RUN_LIVE_GEMINI=1 to call the real provider.')
def test_live_agents_on_synthetic_database(isolated_database):
    evidence = run_agent_scenario(isolated_database, live=True)
    path = ROOT / 'test-results' / 'live-agents.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
