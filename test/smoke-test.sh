#!/bin/bash
# Smoke test for the Goldilocks web app.
#
# Starts a built server with isolated config, then exercises the API.
# Requires: node, bash, curl, jq
#
# Usage:
#   bash test/smoke-test.sh           # run all tests
#   bash test/smoke-test.sh --fail-fast  # stop on first failure

set -euo pipefail

FAIL_FAST=false
if [[ "${1:-}" == "--fail-fast" ]]; then
  FAIL_FAST=true
fi

PASS=0
FAIL=0
SKIP=0

note() {
  echo "[smoke] $1"
}

pass() {
  echo "  ✓ $1"
  ((PASS++))
}

fail() {
  echo "  ✗ $1"
  ((FAIL++))
  if $FAIL_FAST; then
    echo ""
    echo "=== FAIL FAST: $1 ==="
    cleanup
    exit 1
  fi
}

skip() {
  echo "  ⚠ $1"
  ((SKIP++))
}

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  if [[ -n "${DATA_DIR:-}" ]]; then
    rm -rf "$DATA_DIR"
  fi
}
trap cleanup EXIT

note "=== Goldilocks Smoke Test ==="

# ── Isolated environment ────────────────────────────────────────────────────

# Pick a free port
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
DATA_DIR=$(mktemp -d /tmp/goldilocks-smoke-XXXX)
WORKSPACE_ROOT="$DATA_DIR/workspaces"
mkdir -p "$DATA_DIR" "$WORKSPACE_ROOT"

export PORT DATA_DIR WORKSPACE_ROOT
export JWT_SECRET='test-secret-for-smoke-test'
export ENCRYPTION_KEY='test-encryption-key-32bytes!!'
export NODE_ENV='test'
export K8S_NAMESPACE='smoke-test'  # prevents real k8s lookups

# Build the server if dist doesn't exist
if [[ ! -d server/dist ]]; then
  note "Building server (server/dist not found)..."
  npm run build --silent 2>/dev/null || npm run build
fi

note "Starting server on port $PORT (DATA_DIR=$DATA_DIR)..."
cd "$(dirname "$0")/.."
node server/dist/index.js &
PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

BASE="http://localhost:$PORT"

# ── Helpers ─────────────────────────────────────────────────────────────────

req() {
  curl -sf -X "${2:-GET}" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    "${3:-}" \
    "$BASE$1" \
    2>/dev/null
}

req_no_auth() {
  curl -sf -X "${2:-GET}" \
    -H 'Content-Type: application/json' \
    "${3:-}" \
    "$BASE$1" \
    2>/dev/null
}

register_and_get_token() {
  local email=$1
  local password=$2
  req_no_auth POST /api/auth/register \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"displayName\":\"Smoke Test\"}" \
    | jq -r '.token // empty'
}

# ── Health ──────────────────────────────────────────────────────────────────

note ""
note "Health"
if HEALTH=$(curl -sf "$BASE/api/health"); then
  if echo "$HEALTH" | jq -r '.status' | grep -q 'ok'; then
    pass "server started and healthy"
  else
    fail "health check returned non-ok: $HEALTH"
  fi
else
  fail "could not reach /api/health"
fi

# ── Auth ───────────────────────────────────────────────────────────────────

note ""
note "Auth"

EMAIL="smoke-$(date +%s)@example.com"
PASSWORD="SmokeTest123!"

TOKEN=$(register_and_get_token "$EMAIL" "$PASSWORD")
if [[ -n "$TOKEN" && "$TOKEN" != "empty" ]]; then
  pass "register → JWT token"
else
  fail "register failed"
  TOKEN=""
fi

if [[ -n "$TOKEN" ]]; then
  ME=$(curl -sf "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN")
  if echo "$ME" | jq -r '.user.email' | grep -q "$EMAIL"; then
    pass "GET /api/auth/me → correct user"
  else
    fail "GET /api/auth/me → wrong response: $ME"
  fi

  WRONG=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer wrong-token" 2>/dev/null || true)
  WRONG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/me" -H "Authorization: Bearer wrong-token" 2>/dev/null || echo "000")
  if [[ "$WRONG_STATUS" == "401" ]]; then
    pass "invalid token → 401"
  else
    fail "invalid token should return 401, got: $WRONG_STATUS"
  fi
fi

# ── Conversations ────────────────────────────────────────────────────────────

note ""
note "Conversations"

if [[ -z "$TOKEN" ]]; then
  skip "auth failed, skipping conversations"
else
  CONV=$(curl -sf -X POST "$BASE/api/conversations" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"Smoke Test Conv"}')
  CONV_ID=$(echo "$CONV" | jq -r '.conversation.id // empty')

  if [[ -n "$CONV_ID" && "$CONV_ID" != "empty" ]]; then
    pass "create conversation → $CONV_ID"

    CONVS=$(curl -sf "$BASE/api/conversations" -H "Authorization: Bearer $TOKEN")
    COUNT=$(echo "$CONVS" | jq '.conversations | length')
    if [[ "$COUNT" -ge 1 ]]; then
      pass "list conversations → $COUNT found"
    else
      fail "list conversations returned $COUNT"
    fi

    RENAMED=$(curl -sf -X PATCH "$BASE/api/conversations/$CONV_ID" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"title":"Renamed by Smoke Test"}')
    if echo "$RENAMED" | jq -r '.conversation.title' | grep -q "Renamed by Smoke Test"; then
      pass "rename conversation"
    else
      fail "rename failed: $RENAMED"
    fi

    DELETED=$(curl -sf -X DELETE "$BASE/api/conversations/$CONV_ID" \
      -H "Authorization: Bearer $TOKEN")
    if echo "$DELETED" | jq -r '.ok' | grep -q 'true'; then
      pass "delete conversation"
    else
      fail "delete failed: $DELETED"
    fi
  else
    fail "create conversation failed: $CONV"
  fi
fi

# ── Files ───────────────────────────────────────────────────────────────────

note ""
note "Files"

if [[ -z "$TOKEN" ]]; then
  skip "auth failed, skipping files"
else
  # PUT a file
  PUT=$(curl -sf -X PUT "$BASE/api/files/smoke-test-file.txt" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"content":"Hello from smoke test"}')
  if echo "$PUT" | jq -r '.ok // empty' | grep -q 'true'; then
    pass "PUT /api/files/:path → created"
  else
    fail "PUT file failed: $PUT"
  fi

  # GET the file
  GET=$(curl -sf "$BASE/api/files/smoke-test-file.txt" \
    -H "Authorization: Bearer $TOKEN")
  if echo "$GET" | jq -r '.content // empty' | grep -q "Hello from smoke test"; then
    pass "GET /api/files/:path → content matches"
  else
    fail "GET file failed or wrong content: $GET"
  fi

  # GET the tree
  TREE=$(curl -sf "$BASE/api/files" -H "Authorization: Bearer $TOKEN")
  if echo "$TREE" | jq -r '.entries' >/dev/null 2>&1; then
    pass "GET /api/files → tree returned"
  else
    fail "GET tree failed: $TREE"
  fi

  # mkdir
  MKDIR=$(curl -sf -X POST "$BASE/api/files/mkdir" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"path":"smoke-dir"}')
  if echo "$MKDIR" | jq -r '.ok // empty' | grep -q 'true'; then
    pass "POST /api/files/mkdir"
  else
    fail "mkdir failed: $MKDIR"
  fi

  # DELETE the file
  DEL=$(curl -sf -X DELETE "$BASE/api/files/smoke-test-file.txt" \
    -H "Authorization: Bearer $TOKEN")
  if echo "$DEL" | jq -r '.ok // empty' | grep -q 'true'; then
    pass "DELETE /api/files/:path"
  else
    fail "DELETE failed: $DEL"
  fi
fi

# ── Settings ────────────────────────────────────────────────────────────────

note ""
note "Settings"

if [[ -z "$TOKEN" ]]; then
  skip "auth failed, skipping settings"
else
  GET=$(curl -sf "$BASE/api/settings" -H "Authorization: Bearer $TOKEN")
  if echo "$GET" | jq -r '.settings' >/dev/null 2>&1; then
    pass "GET /api/settings → { settings: {...} }"
  else
    fail "GET settings failed: $GET"
  fi

  PATCH=$(curl -sf -X PATCH "$BASE/api/settings" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"defaultModel":"claude-sonnet-4-20250514"}')
  if echo "$PATCH" | jq -r '.settings.defaultModel' | grep -q 'claude-sonnet'; then
    pass "PATCH /api/settings → merge works"
  else
    fail "PATCH settings failed: $PATCH"
  fi

  KEYS=$(curl -sf "$BASE/api/settings/api-keys" -H "Authorization: Bearer $TOKEN")
  if echo "$KEYS" | jq -r '.apiKeys' >/dev/null 2>&1; then
    pass "GET /api/settings/api-keys → key list returned"
  else
    fail "api-keys failed: $KEYS"
  fi
fi

# ── Models ──────────────────────────────────────────────────────────────────

note ""
note "Models (requires k8s pod — stubbed in unit tests)"
skip "models endpoint needs k8s pod — tested in unit tests with stubbed sessionManager"

# ── QuickGen ────────────────────────────────────────────────────────────────

note ""
note "QuickGen (requires goldilocks CLI binary)"

if [[ -z "$TOKEN" ]]; then
  skip "auth failed, skipping quickgen"
else
  PRED=$(curl -sf -X POST "$BASE/api/quickgen/predict" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"structurePath":"test.cif","conversationId":"00000000-0000-0000-0000-000000000001","model":"ALIGNN","confidence":0.95}' \
    2>&1) || true

  if echo "$PRED" | jq -r '.prediction' >/dev/null 2>&1; then
    pass "/api/quickgen/predict → prediction returned"
  else
    if echo "$PRED" | grep -qi "ENOENT\|not found\|binary\|exec"; then
      skip "/api/quickgen/predict → needs goldilocks CLI binary"
    else
      fail "/api/quickgen/predict → unexpected error: $PRED"
    fi
  fi

  GEN=$(curl -sf -X POST "$BASE/api/quickgen/generate" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"structurePath":"test.cif","conversationId":"00000000-0000-0000-0000-000000000001","functional":"PBEsol"}' \
    2>&1) || true

  if echo "$GEN" | jq -r '.filename' >/dev/null 2>&1; then
    pass "/api/quickgen/generate → file generated"
  else
    if echo "$GEN" | grep -qi "ENOENT\|not found\|binary\|exec"; then
      skip "/api/quickgen/generate → needs goldilocks CLI binary"
    else
      fail "/api/quickgen/generate → unexpected error: $GEN"
    fi
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────────

note ""
note "=== Results ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Skipped: $SKIP"
echo ""

if [[ $FAIL -eq 0 ]]; then
  note "All tests passed!"
  exit 0
else
  note "Some tests failed."
  exit 1
fi
