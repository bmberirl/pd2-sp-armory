# ── PD2 Save File Sync Script (PowerShell) ───────────────────────────────────
# Syncs .d2s files to the Linux server. Optionally runs in a loop.
#
# Usage:
#   .\sync-saves.ps1              # Sync once
#   .\sync-saves.ps1 -Watch       # Sync every 30 seconds continuously
#   .\sync-saves.ps1 -Interval 60 # Sync every 60 seconds
# ─────────────────────────────────────────────────────────────────────────────

param(
    [switch]$Watch,
    [int]$Interval = 30
)

# ── Configuration ────────────────────────────────────────────────────────────
$SaveDir   = "C:\Program Files (x86)\Diablo II\Save"  # Adjust to your PD2 save directory
$Server    = "YOUR_SERVER_IP"
$ServerPath = "/opt/pd2-armory/saves/"
$SshUser   = "root"

function Sync-Saves {
    $files = Get-ChildItem -Path $SaveDir -Filter "*.d2s" -ErrorAction SilentlyContinue
    if (-not $files) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] No .d2s files found in $SaveDir"
        return
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Syncing $($files.Count) save file(s)..."

    foreach ($file in $files) {
        $dest = "${SshUser}@${Server}:${ServerPath}"
        scp $file.FullName $dest 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK: $($file.Name)"
        } else {
            Write-Host "  FAIL: $($file.Name)" -ForegroundColor Red
        }
    }
}

# Run once or in a loop
if ($Watch) {
    Write-Host "Watching for changes every ${Interval}s. Press Ctrl+C to stop."
    while ($true) {
        Sync-Saves
        Start-Sleep -Seconds $Interval
    }
} else {
    Sync-Saves
}
