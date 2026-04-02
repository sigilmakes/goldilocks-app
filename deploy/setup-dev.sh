#!/bin/bash
# Create the kind cluster for local development.
# After this, run `tilt up` — it handles everything else
# (namespace, secrets, builds, deploys).
#
# Usage: bash deploy/setup-dev.sh

set -euo pipefail

CLUSTER_NAME="goldilocks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Check prerequisites ---

for cmd in docker kind kubectl tilt; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: $cmd is required but not installed."
        echo "  docker:  https://docs.docker.com/get-docker/"
        echo "  kind:    https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
        echo "  kubectl: https://kubernetes.io/docs/tasks/tools/"
        echo "  tilt:    curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash"
        exit 1
    fi
done

# --- Create kind cluster if it doesn't exist ---

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "✓ kind cluster '${CLUSTER_NAME}' already exists"
else
    echo "Creating kind cluster '${CLUSTER_NAME}'..."
    kind create cluster --name "$CLUSTER_NAME" --config "$SCRIPT_DIR/kind-config.yaml"
    echo "✓ kind cluster created"
fi

# Verify connectivity
kubectl cluster-info --context "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || {
    echo "ERROR: Failed to connect to kind cluster"
    exit 1
}

echo ""
echo "=== Ready ==="
echo "Run: tilt up"
echo ""
echo "To pass API keys to the agent:"
echo "  ANTHROPIC_API_KEY=sk-ant-... tilt up"
