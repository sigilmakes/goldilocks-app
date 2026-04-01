#!/bin/bash
# Tear down the local kind cluster.
# This deletes all agent pods, PVCs, and the cluster itself.
#
# Usage: bash deploy/teardown-dev.sh

set -euo pipefail

CLUSTER_NAME="goldilocks"

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "Deleting kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "$CLUSTER_NAME"
  echo "✓ Cluster deleted"
else
  echo "No kind cluster '${CLUSTER_NAME}' found — nothing to do"
fi
