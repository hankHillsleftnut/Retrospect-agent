#!/bin/bash
# Trigger the standalone Cook 0 endpoint — synthesizes the user's existing
# identity inferences into a User Understanding Document. Does NOT re-ingest
# raw_content, so no duplicate inferences.
#
# Usage:
#   export INTERNAL_API_SECRET="paste-from-render-env-vars"
#   ./scripts/test-cook0.sh

set -euo pipefail

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  echo "ERROR: INTERNAL_API_SECRET is not set."
  echo "Run: export INTERNAL_API_SECRET=\"<paste from Render env vars>\""
  exit 1
fi

USER_ID="7e0acfa3-fda9-4a0b-a4ec-3fca7a323266"
URL="https://retrospect-agent.onrender.com/cook0/run"

BODY="{\"userId\":\"$USER_ID\",\"notes\":\"manual test from local terminal\"}"

echo "POST $URL"
echo "Body: $BODY"
echo ""
echo "Calling Cook 0... (~30 seconds)"
echo ""

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  -d "$BODY" \
  --max-time 120 \
  | tee /tmp/cook0-result.json

echo ""
echo ""
echo "Done. Open https://retrospect-agent.onrender.com/runs/latest"
