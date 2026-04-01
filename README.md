# Goldilocks

AI-powered web application for generating Quantum ESPRESSO input files with ML-predicted k-point grids. Getting your DFT parameters *just right*.

<!-- TODO: Add screenshot of the workspace view here -->

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
| Orchestration | Kubernetes (`@kubernetes/client-node`), kind for local dev |
| Visualization | 3Dmol.js, Mermaid |
| Build | npm workspaces, multi-stage Docker |

## Quick Start

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker, [kind](https://kind.sigs.k8s.io/), kubectl
- At least one LLM API key (Anthropic, OpenAI, or Google) for chat features

### Development

```bash
# Clone and install
git clone <repo-url> goldilocks-app
cd goldilocks-app
npm install

# One-time: create kind cluster + apply k8s manifests
npm run k8s:setup

# Start both frontend and backend in dev mode
# (Express runs locally, agent pods run in kind)
npm run dev
```

- Frontend: http://localhost:5173 (Vite dev server with HMR)
- Backend: http://localhost:3000 (Express with tsx watch)

The Vite dev server proxies `/api` and `/ws` requests to the backend automatically.
Agent sessions always run in k8s pods — even in development.

### Rebuild agent image

```bash
npm run k8s:build-agent
```

### Teardown

```bash
npm run k8s:teardown
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
│   │   ├── auth/
│   │   │   ├── routes.ts        # Register, login, refresh, me
│   │   │   ├── middleware.ts    # JWT verification middleware
│   │   │   └── hash.ts          # bcrypt password hashing
│   │   ├── conversations/routes.ts   # CRUD for conversations
│   │   ├── files/routes.ts           # File upload, download, list, delete
│   │   ├── models/routes.ts          # Available LLM models (via Pi SDK)
│   │   ├── settings/routes.ts        # User settings + encrypted API keys
│   │   ├── structures/routes.ts      # Structure search/fetch + library
│   │   ├── quickgen/routes.ts        # Deterministic predict + generate
│   │   ├── migrations/001_init.sql   # SQLite schema
│   │   ├── config.ts                 # Environment config
│   │   ├── crypto.ts                 # AES-256-GCM encrypt/decrypt
│   │   ├── db.ts                     # SQLite connection + migration runner
│   │   └── index.ts                  # Express app setup + server start
│   └── package.json
│
├── k8s/                         # Kubernetes manifests (primary deployment method)
│   ├── namespace.yaml
│   ├── rbac.yaml
│   ├── network-policies.yaml
│   ├── resource-quota.yaml
│   ├── agent-pod-template.yaml  # Reference spec for agent pods
│   ├── workspace-pvc-template.yaml  # Per-user workspace PVC
│   ├── web-app.yaml
│   ├── mcp-server.yaml
│   ├── ingress.yaml
│   └── secrets.yaml
│
├── deploy/                      # Deployment tooling
│   ├── docker/                  # Dockerfiles for web, agent, MCP server
│   ├── kind-config.yaml         # kind cluster config for local dev
│   ├── setup-dev.sh             # One-command dev environment setup
│   ├── teardown-dev.sh          # Tear down kind cluster
│   └── README.md                # Deployment guide
│
├── shared/types.ts              # WebSocket message types (client + server)
├── skills/goldilocks/SKILL.md   # Pi agent skill (DFT domain knowledge)
├── test/smoke-test.sh           # End-to-end smoke test
├── Dockerfile                   # Multi-stage production Docker build
├── .env.example                 # Environment variable template
├── AGENTS.md                    # Agent context for Pi SDK sessions
└── package.json                 # npm workspace root
```

## Architecture Overview

Goldilocks follows a three-panel workspace layout: **Sidebar** (conversations + structure library), **Chat** (agent interaction), and **Context** (structure viewer, parameters, files).

The backend serves both the API and the built frontend. Agent sessions are managed via WebSocket — the client authenticates, opens a conversation, and sends prompts. The server creates agent pods in Kubernetes, each running a Pi SDK session scoped to the conversation's workspace. Events stream back over the WebSocket as they happen.

**Kubernetes is the only way to run agent sessions.** Local dev uses `kind` (Kubernetes IN Docker), production uses a real cluster. The `ContainerSessionBackend` uses `@kubernetes/client-node` to create/delete/watch pods, with automatic kubeconfig detection (in-cluster service account or local `~/.kube/config`).

For the full architecture diagram and detailed component documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deployment

See [deploy/README.md](deploy/README.md) for:
- Local development with kind
- Production Kubernetes deployment
- Container image builds
- Secret management

## Contributing

### Adding a New API Route

1. Create a route file in `server/src/<domain>/routes.ts`
2. Define a Router with `verifyToken` middleware
3. Register it in `server/src/index.ts` with `app.use('/api/<path>', router)`

### Adding a New Frontend Component

1. Create the component in the appropriate `frontend/src/components/` subdirectory
2. For state, add a Zustand store in `frontend/src/store/` if needed
3. Use the `api` client from `frontend/src/api/client.ts` for HTTP requests

### Adding a New Tool Result Card

When the agent calls a bash command with the `goldilocks` CLI, the `ChatPanel` automatically renders specialized cards for recognized commands. To add a new card:

1. Create a card component in `frontend/src/components/science/`
2. In `ChatPanel.tsx`, add a case in the `ToolCallCard` component that checks `getGoldilocksCommand()` and parses the tool result
3. Return your custom card component instead of the default expandable tool card

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
