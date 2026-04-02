# Goldilocks

AI-assisted DFT calculation assistant for materials science research.

## Architecture

```
React Frontend ──WebSocket──▶ Express Server ──Bridge──▶ pi (in k8s pod)
                              │                          │
                              │ SQLite (metadata)        │ PVC (user home dir)
                              │ Auth, conversations      │ Sessions, files, config
```

- **One pod per user**, long-lived, with a 5GB PVC as the home directory
- **Bridge pattern**: JSONL over stdin/stdout via `pi --mode rpc --continue`
- **Pi owns agent state**: sessions, conversations, tools, model selection
- **Web app is a thin wrapper**: auth, conversation metadata, file proxy, WebSocket fan-out
- **k8s for dev and prod**: `kind` locally, real cluster for production. Same code path.

## Quick Start

```bash
# Prerequisites: Docker, kind, tilt, node 22+

# 1. Create kind cluster
npm run dev:setup

# 2. Start Tilt (builds images, deploys, watches for changes)
tilt up

# 3. Open browser
#    Frontend: http://localhost:5173
#    API:      http://localhost:3000

# Reset everything:
npm run dev:reset
```

## Project Structure

```
server/src/
  agent/
    bridge.ts          # JSONL RPC communication with pi
    pod-manager.ts     # k8s pod/PVC lifecycle management
    sessions.ts        # Maps users to Bridge instances
    websocket.ts       # WebSocket handler (frontend ↔ Bridge)
    k8s-client.ts      # Shared k8s API client
  auth/                # JWT auth, bcrypt passwords
  conversations/       # Conversation metadata CRUD
  files/               # File operations via k8s exec
  models/              # Model selection via pi RPC
  settings/            # User settings + API key management
  config.ts            # Environment configuration
  crypto.ts            # AES-256-GCM encryption for API keys
  db.ts                # SQLite with migrations

frontend/src/
  hooks/useAgent.ts    # WebSocket connection management
  store/               # Zustand stores (chat, conversations, files, models, etc.)
  components/
    layout/            # Sidebar, ChatPanel, ContextPanel, Header
    chat/              # MessageBubble, ToolCallCard, MarkdownContent
    science/           # StructureViewer (3Dmol.js), PredictionSummary
  pages/               # Login, Workspace, Settings

k8s/                   # Kubernetes manifests (namespace, RBAC, web-app)
deploy/docker/         # Dockerfiles (agent, web dev)
shared/types.ts        # WebSocket protocol types
```

## Key Decisions

- **k8s-only**: No local-mode backend. `kind` for dev, real cluster for prod.
- **Pod per user, not per session**: One long-lived pod, pi switches sessions internally.
- **PVC as home dir**: `/home/node` is a persistent volume. Pi's sessions, config, and user files survive pod restarts.
- **Bridge pattern**: The only code that talks to pi. JSONL parsing, RPC correlation, event dispatch, structured logging.
- **API keys in DB**: Encrypted with AES-256-GCM, decrypted at pod creation and passed as env vars.
- **Messages from pi**: Chat history lives in pi's session files, not in SQLite. DB stores conversation metadata only.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` | Data directory (SQLite, logs) |
| `K8S_NAMESPACE` | `goldilocks` | Kubernetes namespace |
| `AGENT_IMAGE` | `goldilocks-agent:latest` | Agent container image |
| `JWT_SECRET` | dev default | JWT signing secret |
| `ENCRYPTION_KEY` | dev default | API key encryption key |
| `ANTHROPIC_API_KEY` | — | Server-level Anthropic key (fallback) |
| `AGENT_IDLE_TIMEOUT_MS` | `1800000` (30min) | Pod idle timeout |
