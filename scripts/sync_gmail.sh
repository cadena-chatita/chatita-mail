#!/usr/bin/env bash
# Chatita Mail Gmail sync + triage watchdog.
# Pulls the newest 50 inbox messages via the API and classifies up to 50
# pending emails in a separate Python process so triage never blocks the API.
set -euo pipefail

APP=/opt/chatita-mail
API="http://127.0.0.1:8701/api/inbox"
LOG="$APP/scripts/sync_gmail.log"
DATE=$(date -u +%FT%TZ)

# 1) Pull newest 50 inbox emails without inline triage.
if curl -fsS -X POST "${API}/sync/gmail?max_results=50&unread_only=false&triage=false" \
    -H "Content-Type: application/json" -o /dev/null 2>> "$LOG"; then
  echo "[$DATE] sync ok" >> "$LOG"
else
  echo "[$DATE] sync FAILED" >> "$LOG"
  exit 1
fi

# 2) Triage up to 50 pending emails out-of-process.
cd "$APP"
if PYTHONPATH="$APP" "$APP/venv/bin/python" "$APP/scripts/triage_pending.py" --max 50 --batch 50 >> "$LOG" 2>&1; then
  echo "[$DATE] triage ok" >> "$LOG"
else
  echo "[$DATE] triage FAILED" >> "$LOG"
fi
