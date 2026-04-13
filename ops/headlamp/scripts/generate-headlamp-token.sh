#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="goldilocks"
SERVICE_ACCOUNT="headlamp-admin"
STATE_ROOT="${GOLDILOCKS_STATE_DIR:-$PWD/.dev}"
OUT_FILE="${STATE_ROOT}/headlamp/headlamp-token.txt"
TMP_FILE="${OUT_FILE}.tmp"

mkdir -p "$(dirname "$OUT_FILE")"
umask 077

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

kubectl create token "$SERVICE_ACCOUNT" -n "$NAMESPACE" > "$TMP_FILE"
mv "$TMP_FILE" "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "Wrote Headlamp token to $OUT_FILE"
