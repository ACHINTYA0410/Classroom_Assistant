# Start and stop Classroom Assistant

<!-- Animation sources: src/components/BreakScreen.tsx, AttentionPopup.tsx and QuizCelebration.tsx; original local shapes, CC0 1.0. See src/components/ANIMATION_LICENSE.txt. No external animation assets. -->

Use Windows PowerShell. Dependencies and the frontend/backend environment files must already be configured in this checkout.

Port 8000 is the fixed local backend port. If another process is using it and you want to reclaim the port, run this before starting the backend:

```powershell
$listener = netstat -ano | Select-String '127\.0\.0\.1:8000.*LISTENING|0\.0\.0\.0:8000.*LISTENING' | Select-Object -First 1
if ($listener) {
    $ownerPid = [int](($listener.ToString() -split '\s+')[-1])
    Stop-Process -Id $ownerPid -Force
    Write-Host "Stopped process $ownerPid on port 8000."
} else {
    Write-Host 'Port 8000 is already free.'
}
```

## 1. Start the backend — Terminal 1

Open a PowerShell terminal and run these commands in order:

```powershell
Set-Location 'D:\Project\ClassroomAssistant\backend'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

Wait for `Application startup complete.` Leave this terminal running.

## 2. Start the frontend — Terminal 2

Open a second PowerShell terminal and run:

```powershell
Set-Location 'D:\Project\ClassroomAssistant'
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Leave this terminal running. Open http://127.0.0.1:5173 and sign in.

## 3. Check startup — Terminal 3

Open another PowerShell terminal and run:

```powershell
(Invoke-WebRequest 'http://127.0.0.1:5173' -Method Head).StatusCode
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/health'
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/ready'
```

Expect HTTP `200`, health status `ok`, and readiness status `ready`. If port 8000 is occupied, run the force-stop command above before starting Uvicorn. Do not switch ports without updating the matching frontend/backend configuration.

## 4. Stop the frontend and backend

1. In Terminal 2 (frontend), press **Ctrl+C**.
2. In Terminal 1 (backend), press **Ctrl+C**.
3. Wait for both PowerShell prompts to return.
4. Verify that both listening ports are free:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5173,8000 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

No output means neither port has a listener. Closing the browser does not stop the servers. Hosted Supabase does not need to be stopped.
