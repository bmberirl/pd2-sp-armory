@echo off
REM ── PD2 Save File Sync Script ──────────────────────────────────────────────
REM Copies .d2s save files from your PD2 save directory to the Linux server.
REM
REM CONFIGURATION: Edit the variables below to match your setup.
REM
REM Usage:
REM   1. Run manually: double-click this file or run from command prompt.
REM   2. Scheduled task: Use Windows Task Scheduler to run every 30-60 seconds.
REM      - Open Task Scheduler -> Create Basic Task
REM      - Trigger: On a schedule, repeat every 1 minute
REM      - Action: Start a program -> this .bat file
REM ────────────────────────────────────────────────────────────────────────────

REM ── Configuration ──────────────────────────────────────────────────────────
REM Path to your PD2 save files (adjust if your install location differs)
set SAVE_DIR=C:\Program Files (x86)\Diablo II\Save

REM Linux server address and destination path
set SERVER=YOUR_SERVER_IP
set SERVER_PATH=/opt/pd2-armory/saves/

REM SSH user on the Linux server
set SSH_USER=root

REM ── Sync ───────────────────────────────────────────────────────────────────
echo [%date% %time%] Syncing PD2 saves to %SERVER%...

REM Method 1: Using scp (available with Windows 10+ built-in OpenSSH)
scp "%SAVE_DIR%\*.d2s" %SSH_USER%@%SERVER%:%SERVER_PATH%

if %errorlevel% equ 0 (
    echo [%date% %time%] Sync complete.
) else (
    echo [%date% %time%] Sync failed. Ensure SSH is configured.
    echo   - Run: ssh-keygen  (if you haven't already)
    echo   - Run: ssh-copy-id %SSH_USER%@%SERVER%  (to set up passwordless login)
    echo   - Or use: ssh %SSH_USER%@%SERVER%  to test connectivity first.
)
