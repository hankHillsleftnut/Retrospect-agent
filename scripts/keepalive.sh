#!/usr/bin/env bash
#
# keepalive.sh — keep the Render FREE agent warm during active testing windows.
#
# Why: the agent is on Render's Free plan, which spins the instance down after
# ~15 min idle (cold start ~50s) and stops the in-process crons while asleep.
# Pinging /health on an interval keeps the process alive, so goal synthesis is
# fast and the daily/weekly crons actually fire.
#
# Run this ONLY while testing — keeping it warm 24/7 approaches Render's free
# monthly instance-hour cap (~750 hrs). Stop it when you're done for the day.
#
# Usage:
#   bash scripts/keepalive.sh                 # default: ping every 5 min
#   KEEPALIVE_INTERVAL=600 bash scripts/keepalive.sh   # every 10 min
#   AGENT_HEALTH_URL=https://... bash scripts/keepalive.sh
#
set -euo pipefail

URL="${AGENT_HEALTH_URL:-https://retrospect-agent.onrender.com/health}"
INTERVAL="${KEEPALIVE_INTERVAL:-300}"   # 5 min — comfortably under the 15-min idle spin-down

echo "[keepalive] warming $URL every ${INTERVAL}s (Ctrl-C or kill to stop)"
while true; do
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$URL" || echo 000)"
  echo "[keepalive] ${ts} -> HTTP ${code}"
  sleep "${INTERVAL}"
done
