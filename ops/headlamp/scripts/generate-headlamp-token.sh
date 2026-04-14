#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="goldilocks"
SERVICE_ACCOUNT="headlamp-admin"
STATE_ROOT="${GOLDILOCKS_STATE_DIR:-$PWD/.dev}"
OUT_FILE="${STATE_ROOT}/headlamp/headlamp-token.txt"
TMP_FILE="${OUT_FILE}.tmp"

mkdir -p "$(dirname "$OUT_FILE")"
umask 077

# Wait for the service account to exist.
for _ in $(seq 1 60); do
    if kubectl get serviceaccount "$SERVICE_ACCOUNT" -n "$NAMESPACE" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

if ! kubectl get serviceaccount "$SERVICE_ACCOUNT" -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "Headlamp service account not found in namespace $NAMESPACE" >&2
    exit 1
fi

# Generate a token and verify it actually works against the API server.
# On a fresh cluster, the SA's credentials can take a moment to propagate
# to the token reviewer, so a freshly minted token may briefly fail auth.
for attempt in $(seq 1 10); do
    kubectl create token "$SERVICE_ACCOUNT" -n "$NAMESPACE" > "$TMP_FILE"

    if kubectl --token="$(cat "$TMP_FILE")" auth can-i list pods -n "$NAMESPACE" >/dev/null 2>&1; then
        mv "$TMP_FILE" "$OUT_FILE"
        chmod 600 "$OUT_FILE"
        echo "Wrote Headlamp token to $OUT_FILE"
        exit 0
    fi

    sleep 2
done

# If verification never passes, write the token anyway — it may become
# valid shortly as the cluster settles.
mv "$TMP_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "Warning: token verification failed, wrote token to $OUT_FILE anyway" >&2