"""Start the real Uvicorn entry point and check health + unauthenticated rejection."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import httpx

with socket.socket() as sock:
    sock.bind(('127.0.0.1',0))
    port=sock.getsockname()[1]
process=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port',str(port),'--no-access-log'],
    cwd=Path(__file__).resolve().parents[1],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    base=f'http://127.0.0.1:{port}/api/v1'
    with httpx.Client(timeout=2) as client:
        for _ in range(60):
            try:
                response=client.get(base+'/health')
                break
            except (httpx.ConnectError, httpx.ConnectTimeout):
                time.sleep(0.1)
        else:
            raise RuntimeError('Uvicorn did not start')
        assert response.status_code==200
        assert client.get(base+'/reports').status_code==401
        assert client.get(base+'/reports',headers={'Authorization':'Bearer invalid'}).status_code==401
        print(json.dumps({'uvicorn_health':200,'missing_token':401,'invalid_token':401}))
finally:
    process.terminate()
    process.wait(timeout=10)
