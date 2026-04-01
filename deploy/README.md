# Goldilocks Deployment Guide

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Web App    │────▶│  Agent Container  │────▶│   MCP Server    │
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

- Agent containers are **paper-thin**: just Pi SDK + MCP client
- **No SSH keys** in agent containers — only MCP server has HPC access
- **NetworkPolicy** restricts agent egress to MCP server only
- Containers run as non-root, read-only rootfs, all caps dropped
- Per-namespace resource quota limits total agent pods

## Deployment Options

### Option A: Docker Compose (Development / Single User)

```bash
# From the repo root
docker compose -f deploy/docker/docker-compose.prod.yaml up --build
```

This runs the web app with `SESSION_BACKEND=local` (in-process Pi SDK, no isolation).

### Option B: k3s Single Node (Prototyping)

```bash
cd deploy/k8s
bash setup-k3s.sh
```

Prerequisites:
- A Linux VM with 4+ GB RAM
- Root access (for k3s install)

### Option C: Institutional Kubernetes Cluster

1. Request a namespace from your cluster admins
2. Ensure a CNI with NetworkPolicy support (Calico, Cilium)
3. Build and push container images
4. Apply manifests:

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/rbac.yaml
kubectl apply -f deploy/k8s/network-policies.yaml
kubectl apply -f deploy/k8s/resource-quota.yaml
kubectl apply -f deploy/k8s/mcp-server.yaml
kubectl apply -f deploy/k8s/web-app.yaml
kubectl apply -f deploy/k8s/ingress.yaml
```

## Building Container Images

```bash
# Web app
docker build -t ghcr.io/sigilmakes/goldilocks-web:latest \
  -f deploy/docker/Dockerfile.web .

# Agent
docker build -t ghcr.io/sigilmakes/goldilocks-agent:latest \
  -f deploy/docker/Dockerfile.agent .

# MCP server (needs goldilocks-mcp repo)
docker build -t ghcr.io/sigilmakes/goldilocks-mcp:latest \
  -f deploy/docker/Dockerfile.mcp .
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
| `SESSION_BACKEND` | No | `local` | `local` or `container` |
| `AGENT_IMAGE` | No | `ghcr.io/.../goldilocks-agent:latest` | Agent container image |
| `K8S_NAMESPACE` | No | `goldilocks` | k8s namespace for agent pods |

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
