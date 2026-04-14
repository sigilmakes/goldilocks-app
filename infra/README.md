# Deployment

## Dev Setup

```bash
# 1. Create kind cluster
npm run dev:setup

# 2. Start Tilt (builds images, deploys to kind, watches for changes)
tilt up

# 3. Open browser
#    Frontend: http://localhost:5173
#    API:      http://localhost:3000
```

## Architecture

- **kind** for local k8s
- **Tilt** for live-reload dev loop
- One **pod per user** with PVC as home directory
- `pi --mode rpc --continue` exec'd into each user's pod
- Web app communicates via Bridge (JSONL over stdin/stdout)

## Files

- `infra/docker/Dockerfile.agent` — Agent container (`sleep infinity` sandbox)
- `infra/docker/Dockerfile.web.dev` — Dev web stack container (gateway + Vite)
- `infra/kind/kind-config.template.yaml` — Kind config template used by `scripts/dev-setup.sh`
- `infra/k8s/` — Kubernetes manifests used by Tilt
