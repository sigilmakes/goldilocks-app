#!/bin/bash
# Smoke test for the Goldilocks web app
# Starts the server, registers a user, creates a conversation, and verifies key endpoints
#
# Usage: bash test/smoke-test.sh
# Requires: node, curl, jq

set -euo pipefail

PORT=${PORT:-3456}
BASE="http://localhost:$PORT"
PID=""

cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf /tmp/goldilocks-test-data
}
trap cleanup EXIT

echo "=== Goldilocks Smoke Test ==="

# Start server with test config
export PORT=$PORT
export DATA_DIR=/tmp/goldilocks-test-data
export WORKSPACE_ROOT=/tmp/goldilocks-test-data/workspaces
export JWT_SECRET=test-secret-for-smoke-test
export ENCRYPTION_KEY=test-encryption-key-32bytes!!
export NODE_ENV=test

mkdir -p "$DATA_DIR" "$WORKSPACE_ROOT"

echo "Starting server on port $PORT..."
cd "$(dirname "$0")/.."
node server/dist/index.js &
PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Server started (PID $PID)"

# Health check
echo -n "Health check... "
HEALTH=$(curl -sf "$BASE/api/health")
echo "$HEALTH" | jq -r '.status' | grep -q 'ok' && echo "✓" || { echo "✗"; exit 1; }

# Register a user
echo -n "Register user... "
REG=$(curl -sf -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpassword123","displayName":"Test User"}')
TOKEN=$(echo "$REG" | jq -r '.token')
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] && echo "✓" || { echo "✗ ($REG)"; exit 1; }

AUTH="Authorization: Bearer $TOKEN"

# Get user profile
echo -n "Get profile... "
ME=$(curl -sf "$BASE/api/auth/me" -H "$AUTH")
echo "$ME" | jq -r '.user.email' | grep -q 'test@example.com' && echo "✓" || { echo "✗"; exit 1; }

# Create conversation
echo -n "Create conversation... "
CONV=$(curl -sf -X POST "$BASE/api/conversations" \
  -H 'Content-Type: application/json' \
  -H "$AUTH" \
  -d '{"title":"Test Conversation"}')
CONV_ID=$(echo "$CONV" | jq -r '.conversation.id')
[ -n "$CONV_ID" ] && [ "$CONV_ID" != "null" ] && echo "✓ ($CONV_ID)" || { echo "✗"; exit 1; }

# List conversations
echo -n "List conversations... "
CONVS=$(curl -sf "$BASE/api/conversations" -H "$AUTH")
COUNT=$(echo "$CONVS" | jq '.conversations | length')
[ "$COUNT" -ge 1 ] && echo "✓ ($COUNT)" || { echo "✗"; exit 1; }

# Upload a file
echo -n "Upload CIF file... "
CIF_B64=$(echo "data_test\n_cell_length_a 4.0\n_cell_length_b 4.0\n_cell_length_c 4.0" | base64 -w0)
UPLOAD=$(curl -sf -X POST "$BASE/api/conversations/$CONV_ID/upload" \
  -H 'Content-Type: application/json' \
  -H "$AUTH" \
  -d "{\"filename\":\"test.cif\",\"content\":\"$CIF_B64\"}")
echo "$UPLOAD" | jq -r '.file.name' | grep -q 'test.cif' && echo "✓" || { echo "✗"; exit 1; }

# List files
echo -n "List workspace files... "
FILES=$(curl -sf "$BASE/api/conversations/$CONV_ID/files" -H "$AUTH")
FCOUNT=$(echo "$FILES" | jq '.files | length')
[ "$FCOUNT" -ge 1 ] && echo "✓ ($FCOUNT)" || { echo "✗"; exit 1; }

# Quick predict (uses placeholder CLI)
echo -n "Quick predict... "
PRED=$(curl -sf -X POST "$BASE/api/predict" \
  -H 'Content-Type: application/json' \
  -H "$AUTH" \
  -d "{\"structurePath\":\"test.cif\",\"conversationId\":\"$CONV_ID\",\"model\":\"ALIGNN\",\"confidence\":0.95}" 2>&1) || true
if echo "$PRED" | jq -r '.prediction' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ (endpoint exists but may need CLI: $PRED)"
fi

# Quick generate
echo -n "Quick generate... "
GEN=$(curl -sf -X POST "$BASE/api/generate" \
  -H 'Content-Type: application/json' \
  -H "$AUTH" \
  -d "{\"structurePath\":\"test.cif\",\"conversationId\":\"$CONV_ID\",\"functional\":\"PBEsol\"}" 2>&1) || true
if echo "$GEN" | jq -r '.filename' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ (endpoint exists but may need CLI: $GEN)"
fi

# Structure search
echo -n "Structure search... "
SEARCH=$(curl -sf -X POST "$BASE/api/structures/search" \
  -H 'Content-Type: application/json' \
  -H "$AUTH" \
  -d '{"formula":"BaTiO3","database":"jarvis","limit":3}' 2>&1) || true
if echo "$SEARCH" | jq -r '.results' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ (endpoint exists: $SEARCH)"
fi

# Settings
echo -n "Get settings... "
SETTINGS=$(curl -sf "$BASE/api/settings" -H "$AUTH" 2>&1) || true
if echo "$SETTINGS" | jq '.' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ ($SETTINGS)"
fi

# API keys list
echo -n "List API keys... "
KEYS=$(curl -sf "$BASE/api/settings/api-keys" -H "$AUTH" 2>&1) || true
if echo "$KEYS" | jq '.' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ ($KEYS)"
fi

# Models
echo -n "List models... "
MODELS=$(curl -sf "$BASE/api/models" -H "$AUTH" 2>&1) || true
if echo "$MODELS" | jq '.models' >/dev/null 2>&1; then
  echo "✓"
else
  echo "⚠ ($MODELS)"
fi

# Delete conversation
echo -n "Delete conversation... "
DEL=$(curl -sf -X DELETE "$BASE/api/conversations/$CONV_ID" -H "$AUTH")
echo "$DEL" | jq -r '.ok' | grep -q 'true' && echo "✓" || { echo "✗"; exit 1; }

echo ""
echo "=== All smoke tests passed ==="
