#!/bin/bash
# Setup script for local k8s development using kind.
#
# Creates a kind cluster, builds the agent image, loads it into kind,
# and applies the base k8s manifests (namespace, RBAC, network policies).
#
# Prerequisites: docker, kind, kubectl
#
# Usage: bash deploy/setup-dev.sh

set -euo pipefail

CLUSTER_NAME="goldilocks"
AGENT_IMAGE="goldilocks-agent:latest"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Check prerequisites ---

for cmd in docker kind kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not installed."
    echo "  docker: https://docs.docker.com/get-docker/"
    echo "  kind:   https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
    echo "  kubectl: https://kubernetes.io/docs/tasks/tools/"
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

# Ensure kubectl context is set
kubectl cluster-info --context "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || {
  echo "ERROR: Failed to connect to kind cluster"
  exit 1
}

# --- Build agent image ---

echo "Building agent image..."
if [ -f "$REPO_ROOT/deploy/docker/Dockerfile.agent" ]; then
  docker build -t "$AGENT_IMAGE" -f "$REPO_ROOT/deploy/docker/Dockerfile.agent" "$REPO_ROOT"
  echo "✓ Agent image built"

  echo "Loading agent image into kind..."
  kind load docker-image "$AGENT_IMAGE" --name "$CLUSTER_NAME"
  echo "✓ Agent image loaded into kind"
else
  echo "⚠ deploy/docker/Dockerfile.agent not found — skipping image build"
  echo "  You'll need to build and load the agent image manually:"
  echo "    docker build -t ${AGENT_IMAGE} -f deploy/docker/Dockerfile.agent ."
  echo "    kind load docker-image ${AGENT_IMAGE} --name ${CLUSTER_NAME}"
fi

# --- Apply k8s manifests ---

K8S_DIR="$REPO_ROOT/k8s"

echo "Applying namespace..."
kubectl apply -f "$K8S_DIR/namespace.yaml"

echo "Applying RBAC..."
kubectl apply -f "$K8S_DIR/rbac.yaml"

echo "Applying network policies..."
kubectl apply -f "$K8S_DIR/network-policies.yaml"

echo "Applying resource quota..."
kubectl apply -f "$K8S_DIR/resource-quota.yaml"

# workspace-pvc-template.yaml is a reference template, not directly applied.
# PVCs are created dynamically by ContainerSessionBackend per user.

echo ""
echo "=== Dev environment ready ==="
echo ""
echo "Next steps:"
echo "  1. Set environment variables (ANTHROPIC_API_KEY, etc.)"
echo "  2. Run:  npm run dev"
echo "     (Express runs locally, creates agent pods in kind)"
echo ""
echo "Useful commands:"
echo "  kubectl get pods -n goldilocks        # List agent pods"
echo "  kubectl logs -n goldilocks <pod>       # View agent logs"
echo "  npm run k8s:build-agent                # Rebuild + reload agent image"
echo "  npm run k8s:teardown                   # Delete the kind cluster"
