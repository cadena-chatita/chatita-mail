#!/usr/bin/env bash
# Regenera el brief LLM de TODOS los casos (vista "Casos" de Chatita Mail).
# Pensado para cron nocturno en M5:
#   30 3 * * * /opt/chatita-mail/scripts/case_briefs_nightly.sh >> /var/log/case_briefs.log 2>&1
# Local: MAIL_API=http://127.0.0.1:8000 ./scripts/case_briefs_nightly.sh
set -euo pipefail
MAIL_API="${MAIL_API:-http://127.0.0.1:8701}"
echo "[$(date -u +%FT%TZ)] case_briefs_nightly -> ${MAIL_API}/api/agent/briefs/nightly"
curl -fsS -X POST "${MAIL_API}/api/agent/briefs/nightly" -H 'Content-Type: application/json' --max-time 900
echo
