"""Print counts only; never print matched secrets or source contents."""
import json
from pathlib import Path
import re
import subprocess
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
secrets = []
for location in [ROOT/'.env', ROOT/'backend/.env']:
    for name, value in dotenv_values(location).items():
        if value and len(value) >= 16 and not value.lower().startswith(('your-', 'your_', 'replace-')) and any(x in name for x in ('GEMINI','SERVICE_ROLE','JWT_SECRET','ELEVENLABS')):
            secrets.append(value.encode())
tracked = subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
files = [ROOT/p for p in tracked if p and (ROOT/p).is_file()]
files += [p for directory in ('src','dist','.dist') for p in (ROOT/directory).rglob('*') if p.is_file()]
leaks=[]
for path in set(files):
    data=path.read_bytes()
    if any(secret in data for secret in secrets) or re.search(rb'AIza[0-9A-Za-z_-]{35}',data):
        leaks.append(str(path.relative_to(ROOT)))
history=subprocess.check_output(['git','log','-p','f3330c8^..HEAD'],cwd=ROOT)
history_clean=not any(secret in history for secret in secrets) and not re.search(rb'AIza[0-9A-Za-z_-]{35}',history)
frontend_env=dotenv_values(ROOT/'.env')
env_clean=not any(any(word in name for word in ('GEMINI','SERVICE_ROLE','JWT_SECRET','ELEVENLABS')) for name in frontend_env)
ignored=subprocess.run(['git','check-ignore','.env','backend/.env'],cwd=ROOT,capture_output=True,text=True)
result={'files_scanned':len(set(files)),'secret_matches':len(leaks),'created_history_clean':bool(history_clean),
        'frontend_env_clean':env_clean,'both_env_files_ignored':len(ignored.stdout.splitlines())==2}
print(json.dumps(result))
if leaks or not history_clean or not env_clean or len(ignored.stdout.splitlines())!=2:
    raise SystemExit(1)
