#!/bin/bash
# Smoke test for the Goldilocks web app.
#
# Starts a built server with isolated config, then exercises the API.
# Requires: node, bash, curl, jq
#
# Usage:
#   bash apps/gateway/test/smoke-test.sh             # run all tests
#   bash apps/gateway/test/smoke-test.sh --fail-fast  # stop on first failure

# set -e is intentionally NOT used here. Every curl call may hit a non-2xx
# response; we handle errors explicitly with if/else and the pass/fail counters.
# Using set -e + curl -f would abort the script before our error logic runs.
set -uo pipefail

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

# Build the gateway if dist doesn't exist
if [[ ! -d apps/gateway/dist ]]; then
  note "Building gateway (apps/gateway/dist not found)..."
  npm run build --silent 2>/dev/null || npm run build
fi

note "Starting gateway on port $PORT (DATA_DIR=$DATA_DIR)..."
cd "$(dirname "$0")/../../.."
node apps/gateway/dist/index.js &
PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

BASE="http://localhost:$PORT"

# ── Helpers ─────────────────────────────────────────────────────────────────
# curl -s (no -f) so HTTP errors don't abort the script. We check status
# codes and response bodies explicitly in each test section.

req() {
  local method="${1:-GET}"
  local path="$2"
  shift 2
  curl -s -X "$method" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    "$@" \
    "$BASE$path" \
    2>/dev/null
}

req_no_auth() {
  local method="${1:-GET}"
  local path="$2"
  shift 2
  curl -s -X "$method" \
    -H 'Content-Type: application/json' \
    "$@" \
    "$BASE$path" \
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
HEALTH=$(curl -s "$BASE/api/health" 2>/dev/null) || true
if echo "$HEALTH" | jq -r '.status' 2>/dev/null | grep -q 'ok'; then
  pass "server started and healthy"
else
  fail "could not reach /api/health or wrong response: ${HEALTH:-<no response>}"
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
  ME=$(curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN" 2>/dev/null) || true
  if echo "$ME" | jq -r '.user.email' 2>/dev/null | grep -q "$EMAIL"; then
    pass "GET /api/auth/me → correct user"
  else
    fail "GET /api/auth/me → wrong response: $ME"
  fi

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
  CONV=$(curl -s -X POST "$BASE/api/conversations" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"Smoke Test Conv"}' 2>/dev/null) || true
  CONV_ID=$(echo "$CONV" | jq -r '.conversation.id // empty' 2>/dev/null) || true

  if [[ -n "$CONV_ID" && "$CONV_ID" != "empty" ]]; then
    pass "create conversation → $CONV_ID"

    CONVS=$(curl -s "$BASE/api/conversations" -H "Authorization: Bearer $TOKEN" 2>/dev/null) || true
    COUNT=$(echo "$CONVS" | jq '.conversations | length' 2>/dev/null) || COUNT=0
    if [[ "$COUNT" -ge 1 ]]; then
      pass "list conversations → $COUNT found"
    else
      fail "list conversations returned $COUNT"
    fi

    RENAMED=$(curl -s -X PATCH "$BASE/api/conversations/$CONV_ID" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"title":"Renamed by Smoke Test"}' 2>/dev/null) || true
    if echo "$RENAMED" | jq -r '.conversation.title' 2>/dev/null | grep -q "Renamed by Smoke Test"; then
      pass "rename conversation"
    else
      fail "rename failed: $RENAMED"
    fi

    DELETED=$(curl -s -X DELETE "$BASE/api/conversations/$CONV_ID" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null) || true
    if echo "$DELETED" | jq -r '.ok' 2>/dev/null | grep -q 'true'; then
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
skip "files endpoint needs a real pod-backed workspace; covered by gateway integration tests with a stubbed pod manager"

# ── Settings ────────────────────────────────────────────────────────────────

note ""
note "Settings"

if [[ -z "$TOKEN" ]]; then
  skip "auth failed, skipping settings"
else
  GET=$(curl -s "$BASE/api/settings" -H "Authorization: Bearer $TOKEN" 2>/dev/null) || true
  if echo "$GET" | jq -r '.settings' >/dev/null 2>&1; then
    pass "GET /api/settings → { settings: {...} }"
  else
    fail "GET settings failed: $GET"
  fi

  PATCH=$(curl -s -X PATCH "$BASE/api/settings" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"defaultModel":"claude-sonnet-4-20250514"}' 2>/dev/null) || true
  if echo "$PATCH" | jq -r '.settings.defaultModel' 2>/dev/null | grep -q 'claude-sonnet'; then
    pass "PATCH /api/settings → merge works"
  else
    fail "PATCH settings failed: $PATCH"
  fi

  KEYS=$(curl -s "$BASE/api/settings/api-keys" -H "Authorization: Bearer $TOKEN" 2>/dev/null) || true
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
note "QuickGen"
skip "quickgen needs a prepared workspace structure file; covered separately from this smoke path"

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