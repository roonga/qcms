# agent-loop.ps1 — supervisor for autonomous task execution that survives
# Claude usage-limit windows. Runs /next-task in a FRESH headless session each
# iteration (safe: the repo is the memory — ledger claims, task branches, and
# HANDOFFs let a new session recover anything a killed one left behind).
#
# Usage:  pwsh scripts/agent-loop.ps1 [-Parallel 3] [-RetryMinutes 30] [-MaxIterations 100]
# Stop:   Ctrl+C anytime — worst case is one interrupted task, which the next
#         run's stale-claim recovery picks up.

param(
    [int]$Parallel = 1,         # executors per batch (pairwise-independent tasks only)
    [int]$RetryMinutes = 30,    # wait between retries when usage-limited / crashed
    [int]$MaxIterations = 100,  # hard stop so a logic bug can't loop forever
    [string]$StopAfterTask = "" # e.g. "010" — stop once this task lands (stage-boundary runs)
)

Set-Location (Join-Path $PSScriptRoot "..")
$log = Join-Path (Get-Location) "agent-loop.log"
function Log($msg) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"; Write-Host $line; Add-Content $log $line }

$prompt = if ($Parallel -gt 1) { "/next-task $Parallel" } else { "/next-task" }
Log "supervisor start: '$prompt', retry ${RetryMinutes}m, max $MaxIterations iterations"

for ($i = 1; $i -le $MaxIterations; $i++) {
    Log "iteration ${i}: launching fresh session"
    $out = claude -p $prompt --permission-mode bypassPermissions --output-format text 2>&1 | Out-String
    Add-Content $log $out
    $sentinel = ($out -split "`n" | Where-Object { $_ -match '^NEXT-TASK:' } | Select-Object -Last 1)

    if     ($sentinel -match 'NEXT-TASK: (LANDED|RESUMED)') {
        Log $sentinel
        if ($StopAfterTask -and $sentinel -match "(LANDED|RESUMED)\s+0*$([int]$StopAfterTask)\b") {
            Log "task $StopAfterTask landed — stop-after target reached, stopping."
            break
        }
        continue
    }
    elseif ($sentinel -match 'NEXT-TASK: NOTHING')          { Log "$sentinel — ledger exhausted, stopping."; break }
    elseif ($sentinel -match 'NEXT-TASK: AWAITING-HUMAN')   { Log "$sentinel — human gate reached, stopping. See ledger for what's needed."; break }
    elseif ($sentinel -match 'NEXT-TASK: BLOCKED')          { Log "$sentinel — needs a decision, stopping."; break }
    else {
        # No sentinel — session died mid-flight: usage limit, network, crash.
        # State is safe on disk; wait out the window and let recovery handle it.
        # If the error names the reset time, sleep until then (+3 min buffer)
        # instead of the blind retry interval.
        $sleepSec = $RetryMinutes * 60
        if ($out -match 'reset(?:s)?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)' ) {
            try {
                $t = [datetime]::Parse($Matches[1])
                if ($t -lt (Get-Date)) { $t = $t.AddDays(1) }   # reset time already passed today → it's tomorrow
                $until = ($t - (Get-Date)).TotalSeconds + 180
                if ($until -gt 60 -and $until -lt 21600) { $sleepSec = [int]$until; Log "limit reset detected at $($t.ToString('HH:mm')) — sleeping until then" }
            } catch { }
        }
        if ($sleepSec -eq $RetryMinutes * 60) { Log "no sentinel (usage limit or crash assumed) — retrying in $RetryMinutes minutes" }
        Start-Sleep -Seconds $sleepSec
    }
}
Log "supervisor exit"
