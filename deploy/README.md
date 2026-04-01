# Goldilocks Deployment Guide

## Architecture

Kubernetes is the **only** way to run agent sessions. Local dev uses `kind`
(Kubernetes IN Docker) with Tilt for live-reload. Production uses a real k8s
cluster. Same code, same manifests.

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

## Local Development (kind + Tilt)

### Prerequisites

- Docker
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- kubectl
- [Tilt](https://docs.tilt.dev/install.html) (`curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash`)

### Setup

```bash
# One-time: create kind cluster
bash deploy/setup-dev.sh

# Start everything
tilt up
```

Tilt handles:
- Building `goldilocks-web` (dev Dockerfile with tsx + vite)
- Building `goldilocks-agent` image
- Applying all k8s manifests
- Live-syncing source files into the web app pod (no image rebuild)
- Port-forwarding Express (3000) and Vite (5173)

### Daily workflow

```bash
tilt up                         # Start dev environment
# Edit code — Tilt syncs changes automatically
# Frontend: Vite HMR (sub-second)
# Backend: tsx watch restarts (1-2s)
tilt down                       # Stop everything
kind delete cluster --name goldilocks   # Nuclear option
```

### Tilt Dashboard

Open http://localhost:10350 to see build status, logs, and resource health.

## Production (Kubernetes Cluster)

### Prerequisites

- A k8s cluster with NetworkPolicy support (Calico, Cilium)
- kubectl configured with cluster access

### Deploy

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policies.yaml
kubectl apply -f k8s/resource-quota.yaml
kubectl apply -f k8s/mcp-server.yaml
kubectl apply -f k8s/web-app.yaml
kubectl apply -f k8s/ingress.yaml
```

Note: For production, update `k8s/web-app.yaml` to use the production image
(`ghcr.io/sigilmakes/goldilocks-web:latest`) and set `NODE_ENV=production`.

## Building Container Images

```bash
# Web app (production)
docker build -t goldilocks-web -f deploy/docker/Dockerfile.web .

# Agent
docker build -t goldilocks-agent -f deploy/docker/Dockerfile.agent .

# MCP server
docker build -t goldilocks-mcp -f deploy/docker/Dockerfile.mcp .
```

## Configuration

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

### Environment Variables (Web App)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | `dev-secret...` | JWT signing secret |
| `ENCRYPTION_KEY` | Yes | `dev-encryption...` | AES key for API key encryption |
| `ANTHROPIC_API_KEY` | No | — | Server-wide Anthropic API key |
| `K8S_NAMESPACE` | No | `goldilocks` | k8s namespace for agent pods |
| `AGENT_IMAGE` | No | `goldilocks-agent:latest` | Agent container image |
| `AGENT_IDLE_TIMEOUT_MS` | No | `1800000` | Agent pod idle timeout (30min) |

## The Escape Hatch

Power users with their own Pi agent and SSH access don't need any of this:

```bash
pip install goldilocks
# Load the skill doc into their Pi agent
# Agent calls goldilocks CLI + SSH directly
```

The web app serves users who don't have direct agent + SSH access.
