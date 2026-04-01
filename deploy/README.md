# Goldilocks Deployment Guide

## Architecture

Kubernetes is the **only** way to run agent sessions. Local dev uses `kind`
(Kubernetes IN Docker). Production uses a real k8s cluster. Same code, same
manifests, same behaviour.

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Web App    │────▶│  Agent Pod        │────▶│   MCP Server    │
│  (Deployment)│     │  (per user)       │     │  (Deployment)   │
│              │     │                   │     │                 │
│  auth, UI,   │     │  Pi SDK only.     │     │  ML inference   │
│  pod lifecycle│     │  Reasons. Calls   │     │  HPC gateway    │
│  WS proxy    │     │  MCP tools.       │     │  job lifecycle  │
└──────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │ SSH
                                                       ▼
                                              ┌─────────────────┐
                                              │   HPC Cluster    │
                                              └─────────────────┘
```

### Components

| Component | Image | Lifecycle | Purpose |
|-----------|-------|-----------|---------|
| Web App | `goldilocks-web` | Persistent (Deployment) | Auth, UI, pod orchestration |
| Agent | `goldilocks-agent` | Ephemeral (per session) | Pi SDK reasoning + tool calls |
| MCP Server | `goldilocks-mcp` | Persistent (Deployment) | ML inference, HPC gateway |

### Security Model

- Agent pods are **paper-thin**: just Pi SDK + MCP client
- **No SSH keys** in agent pods — only MCP server has HPC access
- **NetworkPolicy** restricts agent egress to MCP server only
- Pods run as non-root, read-only rootfs, all caps dropped
- Per-namespace resource quota limits total agent pods
- Per-user workspace PVC for file persistence

## Local Development (kind)

### Prerequisites

- Docker
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- kubectl

### Setup

```bash
# One-time setup: creates kind cluster, builds agent image, applies manifests
npm run k8s:setup

# Start the web app locally (agents run in kind)
npm run dev
```

The web app (Express) runs on your host and creates agent pods in the kind
cluster via the k8s API. Vite HMR works normally for frontend development.

### Daily workflow

```bash
npm run dev                   # Start web app (agents in kind)
npm run k8s:build-agent       # Rebuild + reload agent image after changes
kubectl get pods -n goldilocks  # Check agent pods
npm run k8s:teardown          # Delete kind cluster when done
```

## Production (Kubernetes Cluster)

### Prerequisites

- A k8s cluster with NetworkPolicy support (Calico, Cilium)
- kubectl configured with cluster access

### Deploy

```bash
# Apply manifests from the k8s/ directory
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policies.yaml
kubectl apply -f k8s/resource-quota.yaml
kubectl apply -f k8s/mcp-server.yaml
kubectl apply -f k8s/web-app.yaml
kubectl apply -f k8s/ingress.yaml
```

## Building Container Images

```bash
# Web app
docker build -t goldilocks-web -f deploy/docker/Dockerfile.web .

# Agent
docker build -t goldilocks-agent -f deploy/docker/Dockerfile.agent .

# MCP server (needs goldilocks-mcp repo)
docker build -t goldilocks-mcp -f deploy/docker/Dockerfile.mcp .
```

## Configuration

### Environment Variables (Web App)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | `dev-secret...` | JWT signing secret |
| `ENCRYPTION_KEY` | Yes | `dev-encryption...` | AES key for API key encryption |
| `ANTHROPIC_API_KEY` | No | — | Server-wide Anthropic API key |
| `OPENAI_API_KEY` | No | — | Server-wide OpenAI API key |
| `GOOGLE_API_KEY` | No | — | Server-wide Google API key |
| `K8S_NAMESPACE` | No | `goldilocks` | k8s namespace for agent pods |
| `AGENT_IMAGE` | No | `goldilocks-agent:latest` | Agent container image |
| `AGENT_IDLE_TIMEOUT_MS` | No | `1800000` | Agent pod idle timeout (30min) |
| `WORKSPACE_QUOTA_BYTES` | No | `1073741824` | Per-user workspace size (1GB) |

### Secrets

Create secrets before deploying:

```bash
# App secrets
kubectl create secret generic app-secrets \
  --from-literal=jwt-secret="$(openssl rand -hex 32)" \
  --from-literal=encryption-key="$(openssl rand -hex 32)" \
  -n goldilocks

# API keys (optional — users can add their own)
kubectl create secret generic api-keys \
  --from-literal=anthropic="sk-ant-..." \
  -n goldilocks

# HPC SSH key (for MCP server)
kubectl create secret generic hpc-ssh-key \
  --from-file=id_ed25519=/path/to/key \
  --from-file=known_hosts=/path/to/known_hosts \
  -n goldilocks
```

## The Escape Hatch

Power users with their own Pi agent and SSH access don't need any of this:

```bash
pip install goldilocks
# Load the skill doc into their Pi agent
# Agent calls goldilocks CLI + SSH directly
```

The web app serves users who don't have direct agent + SSH access.
