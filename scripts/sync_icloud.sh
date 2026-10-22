#!/usr/bin/env bash
# iCloud IMAP sync out-of-process (flock prevents overlap). Triage runs in sync_gmail.sh.
cd /opt/chatita-mail
exec 9>/tmp/sync_icloud.lock; flock -n 9 || exit 0
echo "[$(date -u +%FT%TZ)] icloud $(PYTHONPATH=/opt/chatita-mail venv/bin/python -m scripts.sync_icloud --max 300 2>&1 | tail -1)" >> scripts/sync_icloud.log
