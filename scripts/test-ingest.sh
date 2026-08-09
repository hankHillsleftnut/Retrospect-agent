#!/bin/bash
# Smoke-test the production ingest endpoint with a small subset of
# raw_content to stay under OpenAI's TPM budget.
#
# Usage:
#   export INTERNAL_API_SECRET="paste-from-render-env-vars"
#   ./scripts/test-ingest.sh

set -euo pipefail

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  echo "ERROR: INTERNAL_API_SECRET is not set."
  echo "Run: export INTERNAL_API_SECRET=\"<paste from Render env vars>\""
  exit 1
fi

USER_ID="7e0acfa3-fda9-4a0b-a4ec-3fca7a323266"
URL="https://retrospect-agent.onrender.com/ingest/run"

# Five recent text_entry IDs (~5K tokens total — well under 30K TPM).
# Skip onboarding profiles (too big in duplicate) and healthkit (handled
# separately as deviations only).
read -r -d '' BODY <<EOF || true
{
  "userId": "$USER_ID",
  "rawContentIds": [
    "6c5e8ce1-f935-4ac0-83ce-75906697cb36",
    "33d70093-9eb8-4e49-af81-c4921e5038c0",
    "8db2bf3f-4288-4cb6-a27c-f49325347fc7",
    "c46bf198-f874-48d6-848a-aadc78ea21d8",
    "0b9c10b4-5c8c-47b3-8df7-2f277f192045"
  ]
}
EOF

echo "POST $URL"
echo "Body: $BODY"
echo ""
echo "Calling... (30-90 seconds)"
echo ""

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  -d "$BODY" \
  --max-time 240 \
  | tee /tmp/ingest-result.json

echo ""
echo ""
echo "Done. Open https://retrospect-agent.onrender.com/runs/latest"
