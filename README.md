# Goldilocks

AI-powered web application for generating Quantum ESPRESSO input files with ML-predicted k-point grids. Getting your DFT parameters *just right*.

Goldilocks pairs an AI chat assistant with domain-specific ML models to help computational materials scientists set up DFT calculations. Upload a crystal structure, get an optimal k-point grid predicted by ALIGNN or Random Forest models, and generate a ready-to-run Quantum ESPRESSO input file — all through a conversational interface or deterministic quick-generate mode.

## Features

- **ML k-point prediction** — ALIGNN (graph neural network) and Random Forest models trained on thousands of DFT convergence tests. Returns median predictions with confidence intervals.
- **QE input generation** — Complete SCF input files with SSSP pseudopotentials, appropriate smearing, and cutoffs looked up per element.
- **AI chat assistant** — Conversational agent powered by Claude, GPT, or Gemini that can reason about your structures, explain parameters, and call domain tools.
- **3D structure visualization** — Interactive crystal structure viewer (3Dmol.js) with ball-and-stick, spacefill, wireframe, and stick rendering modes.
- **Structure database search** — Query JARVIS, Materials Project, MC3D, and OQMD databases directly from the app.
- **Structure library** — Save and organize frequently used crystal structures.
- **Quick generate mode** — Deterministic pipeline (no agent needed): pick parameters in the sidebar, click generate.
- **Multi-provider LLM support** — Bring your own API keys for Anthropic, OpenAI, or Google, or use server-provided keys.
- **Per-user workspaces** — Each conversation gets an isolated file workspace for uploads and generated files.
- **Dark/light theme** — Persistent theme preference with amber accent throughout.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 4, Zustand 5, React Router 7 |
| Backend | Express 5, TypeScript, better-sqlite3, WebSocket (ws) |
| Agent | [Pi SDK](https://github.com/mariozechner/pi-coding-agent) (`@mariozechner/pi-coding-agent`) |
| Auth | JWT (jsonwebtoken), bcrypt, AES-256-GCM encrypted API key storage |
| Orchestration | Kubernetes (`@kubernetes/client-node`), kind + Tilt for local dev |
| Visualization | 3Dmol.js, Mermaid |
| Build | npm workspaces, multi-stage Docker |

## Quick Start

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker, [kind](https://kind.sigs.k8s.io/), kubectl, [Tilt](https://docs.tilt.dev/install.html)
- At least one LLM API key (Anthropic, OpenAI, or Google) for chat features

### Development

```bash
# Clone and install
git clone <repo-url> goldilocks-app
cd goldilocks-app
npm install

# One-time: create kind cluster
bash deploy/setup-dev.sh

# Start everything — web app, agents, infrastructure, all in k8s
tilt up
```

That's it. Tilt builds images, applies manifests, syncs file changes, and
port-forwards automatically.

- Frontend: http://localhost:5173 (Vite dev server with HMR)
- Backend: http://localhost:3000 (Express with tsx watch)
- Tilt dashboard: http://localhost:10350

Edit a React component → Tilt syncs the file → Vite HMR in the browser.
Edit an Express route → Tilt syncs → tsx restarts the server.
No image rebuilds for source changes. Sub-second for frontend, ~2s for backend.

### Teardown

```bash
tilt down          # Stop services, remove k8s resources
kind delete cluster --name goldilocks   # Delete the cluster entirely
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `DATA_DIR` | No | `./data` | SQLite database and data directory |
| `WORKSPACE_ROOT` | No | `./data/workspaces` | Per-user workspace file storage |
| `JWT_SECRET` | **Yes** (prod) | `dev-secret...` | JWT signing secret. Use a long random string. |
| `ENCRYPTION_KEY` | **Yes** (prod) | `dev-encryption...` | AES-256 key for encrypting stored API keys. |
| `ANTHROPIC_API_KEY` | No | — | Server-wide Anthropic API key (available to all users) |
| `OPENAI_API_KEY` | No | — | Server-wide OpenAI API key |
| `GOOGLE_API_KEY` | No | — | Server-wide Google API key |
| `K8S_NAMESPACE` | No | `goldilocks` | k8s namespace for agent pods |
| `AGENT_IMAGE` | No | `goldilocks-agent:latest` | Agent container image |
| `AGENT_IDLE_TIMEOUT_MS` | No | `1800000` | Agent pod idle timeout (30min) |
| `WORKSPACE_QUOTA_BYTES` | No | `1073741824` | Per-user workspace size (1GB) |

## Project Structure

```
goldilocks-app/
├── frontend/                    # React + Vite frontend
│   ├── src/
│   │   ├── api/client.ts        # Typed HTTP client (wraps fetch + auth)
│   │   ├── components/
│   │   │   ├── auth/            # LoginForm
│   │   │   ├── layout/          # Header, Sidebar, ChatPanel, ContextPanel
│   │   │   ├── science/         # KPointsResultCard, InputFileCard, StructureViewer,
│   │   │   │                    #   PredictionSummary, SearchDialog, StructureLibrary
│   │   │   └── ui/              # ConnectionBanner, MermaidDiagram, Skeleton, Toast
│   │   ├── hooks/
│   │   │   ├── useAgent.ts      # WebSocket connection + message dispatch
│   │   │   └── useConnectionStatus.ts  # Health check with auto-reconnect
│   │   ├── pages/               # Login, Workspace, Settings, Docs
│   │   ├── store/               # Zustand stores (auth, chat, conversations,
│   │   │                        #   context, files, models, settings, toast)
│   │   ├── App.tsx              # Routes + ProtectedRoute wrapper
│   │   └── main.tsx             # Entry point + theme initialization
│   ├── vite.config.ts
│   └── package.json
│
├── server/                      # Express + TypeScript backend
│   ├── src/
│   │   ├── agent/
│   │   │   ├── session-backend.ts    # SessionBackend interface
│   │   │   ├── container-backend.ts  # k8s pod per session (via @kubernetes/client-node)
│   │   │   ├── k8s-client.ts        # Shared KubeConfig/CoreV1Api singleton
│   │   │   ├── sessions.ts          # Session cache (wraps k8s backend)
│   │   │   ├── websocket.ts         # WebSocket server + event mapping
│   │   │   └── workspace-guard.ts   # Path traversal prevention
│   │   ├── auth/routes.ts           # Register, login, refresh, me
│   │   ├── conversations/routes.ts  # CRUD for conversations
│   │   ├── files/routes.ts          # File upload, download, list, delete
│   │   ├── models/routes.ts         # Available LLM models
│   │   ├── settings/routes.ts       # User settings + encrypted API keys
│   │   ├── structures/routes.ts     # Structure search/fetch + library
│   │   ├── quickgen/routes.ts       # Deterministic predict + generate
│   │   ├── config.ts               # Environment config
│   │   ├── db.ts                    # SQLite connection + migration runner
│   │   └── index.ts                 # Express app setup + server start
│   └── package.json
│
├── k8s/                         # Kubernetes manifests
│   ├── namespace.yaml
│   ├── rbac.yaml
│   ├── network-policies.yaml
│   ├── resource-quota.yaml
│   ├── web-app.yaml             # Web app deployment + service
│   ├── mcp-server.yaml
│   └── ingress.yaml
│
├── deploy/                      # Deployment tooling
│   ├── docker/
│   │   ├── Dockerfile.web       # Production multi-stage build
│   │   ├── Dockerfile.web.dev   # Dev mode: tsx watch + vite dev
│   │   ├── Dockerfile.agent     # Agent container (Pi SDK)
│   │   └── Dockerfile.mcp      # MCP server (ML inference)
│   ├── kind-config.yaml         # kind cluster config (no port mappings)
│   ├── setup-dev.sh             # One-time cluster setup
│   └── README.md                # Deployment guide
│
├── Tiltfile                     # Dev orchestration — builds, syncs, port-forwards
├── skills/goldilocks/SKILL.md   # Pi agent skill (DFT domain knowledge)
├── test/smoke-test.sh           # End-to-end smoke test
├── Dockerfile                   # Multi-stage production Docker build
├── AGENTS.md                    # Agent context for Pi SDK sessions
└── package.json                 # npm workspace root
```

## Architecture Overview

Goldilocks follows a three-panel workspace layout: **Sidebar** (conversations + structure library), **Chat** (agent interaction), and **Context** (structure viewer, parameters, files).

The backend serves both the API and the built frontend. Agent sessions are managed via WebSocket — the client authenticates, opens a conversation, and sends prompts. The server creates agent pods in Kubernetes, each running a Pi SDK session scoped to the conversation's workspace.

**Kubernetes is the only way to run agent sessions.** Local dev uses `kind` (Kubernetes IN Docker) with Tilt for live-reload. Production uses a real cluster. The `ContainerSessionBackend` uses `@kubernetes/client-node` to create/delete/watch pods.

## Deployment

See [deploy/README.md](deploy/README.md) for:
- Local development with kind + Tilt
- Production Kubernetes deployment
- Container image builds
- Secret management

## Contributing

### Running Tests

```bash
# Build first (smoke test needs compiled server)
npm run build

# Run the smoke test
bash test/smoke-test.sh

# Type checking
npm run typecheck

# Linting
npm run lint
```

## License

MIT
