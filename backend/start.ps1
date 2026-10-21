param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$hostAddress = '127.0.0.1'
$healthUrl = "http://${hostAddress}:$Port/api/v1/health"

# Avoid launching a second Uvicorn instance when the API is already running.
$probe = [System.Net.Sockets.TcpClient]::new()
try {
    try {
        $probe.Connect($hostAddress, $Port)
    } catch {
        # A refused connection means the port is available.
    }
    if ($probe.Connected) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3
            if ($health.status -eq 'ok' -and $health.service -eq 'classroom-assistant-api') {
                Write-Host "Classroom Assistant API is already running at http://${hostAddress}:$Port."
                exit 0
            }
        } catch {
            throw "Port $Port is already in use by another service. Stop that service or choose a different port."
        }
    }
} finally {
    $probe.Dispose()
}

$pythonExe = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Backend virtual environment is missing: $pythonExe"
}
$pythonCheck = $null
$pythonExit = 0
try {
    $pythonCheck = & $pythonExe --version 2>&1
    $pythonExit = $LASTEXITCODE
} catch {
    $pythonCheck = $_.Exception.Message
    $pythonExit = 1
}
if ($pythonExit -ne 0) {
    throw "Backend virtual environment is not runnable. Recreate backend\.venv, then install backend\requirements.txt. Details: $pythonCheck"
}

Push-Location $PSScriptRoot
try {
    & $pythonExe -m uvicorn app.main:app --host $hostAddress --port $Port --workers 1 --no-access-log
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
