#!/bin/bash
# Setup script for k3s single-node deployment
# Run on the target VM/machine

set -euo pipefail

echo "=== Installing k3s with Calico CNI (for NetworkPolicy support) ==="
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--flannel-backend=none --disable-network-policy" sh -

echo "=== Waiting for k3s to be ready ==="
sleep 10
kubectl wait --for=condition=Ready nodes --all --timeout=120s

echo "=== Installing Calico ==="
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml
echo "Waiting for Calico pods..."
kubectl -n kube-system wait --for=condition=Ready pods -l k8s-app=calico-node --timeout=120s

echo "=== Creating namespace ==="
kubectl apply -f namespace.yaml

echo "=== Creating RBAC ==="
kubectl apply -f rbac.yaml

echo "=== Creating secrets (EDIT FIRST!) ==="
echo "⚠️  Edit secrets.yaml with real values before applying!"
echo "  Or create secrets manually:"
echo "    kubectl create secret generic app-secrets \\"
echo "      --from-literal=jwt-secret=\"\$(openssl rand -hex 32)\" \\"
echo "      --from-literal=encryption-key=\"\$(openssl rand -hex 32)\" \\"
echo "      -n goldilocks"
echo ""
echo "    kubectl create secret generic api-keys \\"
echo "      --from-literal=anthropic=\"sk-ant-...\" \\"
echo "      -n goldilocks"

echo "=== Applying resource quota ==="
kubectl apply -f resource-quota.yaml

echo "=== Applying network policies ==="
kubectl apply -f network-policies.yaml

echo "=== Deploying MCP server ==="
kubectl apply -f mcp-server.yaml

echo "=== Deploying web app ==="
kubectl apply -f web-app.yaml

echo "=== Applying ingress ==="
kubectl apply -f ingress.yaml

echo ""
echo "=== Deployment complete ==="
echo "Check status: kubectl get pods -n goldilocks"
echo "Logs: kubectl logs -n goldilocks deployment/web-app"
