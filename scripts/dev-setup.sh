#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="goldilocks"
STATE_ROOT="${GOLDILOCKS_STATE_DIR:-$PWD/.dev}"
KIND_DATA_DIR="${STATE_ROOT}/kind-data"
TEMPLATE="infra/kind/kind-config.template.yaml"
TMP_CONFIG="$(mktemp)"

cleanup() {
    rm -f "$TMP_CONFIG"
}
trap cleanup EXIT

if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    echo "kind cluster '${CLUSTER_NAME}' already exists"
    exit 0
fi

mkdir -p "$KIND_DATA_DIR"
sed "s|__GOLDILOCKS_KIND_DATA_DIR__|${KIND_DATA_DIR}|g" "$TEMPLATE" > "$TMP_CONFIG"

kind create cluster --name "$CLUSTER_NAME" --config "$TMP_CONFIG"
echo "Created kind cluster '${CLUSTER_NAME}' with state at ${KIND_DATA_DIR}"
