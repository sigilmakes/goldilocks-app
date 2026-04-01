# Goldilocks — Agent Guide

Goldilocks is a web application for generating Quantum ESPRESSO DFT input files
with ML-predicted k-point grids. It pairs an AI chat assistant (powered by Pi SDK)
with domain-specific ML models (ALIGNN, Random Forest) to help computational
materials scientists set up DFT calculations through a conversational interface.

## Running Dev

```bash
npm install                   # install both frontend + server workspaces
bash deploy/setup-dev.sh      # one-time: create kind cluster
tilt up                       # everything starts — web app, agents, infra
```

- Frontend: http://localhost:5173 (Vite HMR via Tilt port-forward)
- Backend: http://localhost:3000 (Express via Tilt port-forward)
- Tilt dashboard: http://localhost:10350

Everything runs in kind. Tilt handles image builds, manifest application,
file syncs (live_update), and port-forwarding. No local servers.

Edit frontend source → Tilt syncs → Vite HMR in browser (sub-second).
Edit server source → Tilt syncs → tsx restarts (1-2s).
Edit agent files → Tilt rebuilds agent image (next pod gets it).

Teardown: `tilt down` (stop services) or `kind delete cluster --name goldilocks` (nuke cluster).

Type checking: `npm run typecheck`
Build: `npm run build`
Smoke test: `npm run build && bash test/smoke-test.sh`

## Directory Structure

```
goldilocks-app/
├── frontend/                       React 19 + Vite 6 + Tailwind 4 + Zustand 5
│   └── src/
│       ├── api/client.ts           Typed fetch wrapper; auto-injects Bearer token from useAuthStore
│       ├── components/
│       │   ├── auth/               LoginForm
│       │   ├── chat/               Extracted from ChatPanel — ToolCallCard, MarkdownContent,
│       │   │                         MessageBubble, ThinkingBlock, WelcomeMessage
│       │   ├── layout/             Top-level panels: Header, Sidebar, ChatPanel, ContextPanel
│       │   ├── science/            Domain cards: KPointsResultCard, InputFileCard,
│       │   │                         StructureViewer (3Dmol), PredictionSummary,
│       │   │                         SearchDialog, StructureLibrary
│       │   └── ui/                 Generic: Toast, Skeleton, ConnectionBanner, MermaidDiagram
│       ├── hooks/
│       │   ├── useAgent.ts         WebSocket lifecycle: auth → open → prompt → stream events to store
│       │   └── useConnectionStatus.ts  Polls /api/health, exponential backoff, online/offline events
│       ├── pages/                  Login, Workspace (main 3-panel layout), Settings, Docs
│       ├── store/                  Zustand stores (see "State Management" below)
│       ├── App.tsx                 React Router routes + ProtectedRoute wrapper
│       └── main.tsx               Entry point + theme init
│
├── server/                         Express 5 + TypeScript + better-sqlite3
│   └── src/
│       ├── agent/
│       │   ├── websocket.ts        WebSocket server: auth → open → prompt → stream Pi SDK events
│       │   ├── sessions.ts         SessionCache wrapper — selects backend, returns AgentSession
│       │   ├── session-backend.ts  SessionBackend interface + SessionHandle type
│       │   ├── container-backend.ts k8s pod per session (via @kubernetes/client-node)
│       │   ├── k8s-client.ts       Shared KubeConfig/CoreV1Api singleton
│       │   └── workspace-guard.ts  resolve() + startsWith() path traversal prevention
│       ├── auth/
│       │   ├── routes.ts           POST register, login, refresh; GET me
│       │   ├── middleware.ts       verifyToken (JWT), generateToken; AuthRequest type
│       │   └── hash.ts            bcrypt password hashing
│       ├── conversations/routes.ts GET list, POST create, GET/:id, PATCH/:id, DELETE/:id
│       ├── files/routes.ts         Upload (base64 JSON), download, list, delete; per-conversation
│       ├── models/routes.ts        GET available LLMs (Pi SDK ModelRegistry)
│       ├── settings/routes.ts      User settings + encrypted API key CRUD
│       ├── structures/routes.ts    Search/fetch from JARVIS/MP/MC3D/OQMD + library CRUD
│       ├── quickgen/routes.ts      POST /api/predict, POST /api/generate (goldilocks CLI, no agent)
│       ├── config.ts               Centralized typed env vars (CONFIG object)
│       ├── crypto.ts               AES-256-GCM encrypt/decrypt for stored API keys
│       ├── db.ts                   SQLite connection (WAL), auto-migration runner
│       └── index.ts                Express app setup, route registration, WebSocket, static serving
│
├── shared/
│   └── types.ts                    WebSocket message types (ClientMessage, ServerMessage) used by both
│
├── Tiltfile                        Dev orchestration: builds, live_update syncs, port-forwards
├── k8s/                            Kubernetes manifests (namespace, RBAC, web-app, etc.)
├── deploy/
│   ├── docker/                     Dockerfiles: web (prod), web.dev (dev), agent, MCP
│   ├── kind-config.yaml            kind cluster config
│   └── setup-dev.sh                One-time cluster setup
├── skills/goldilocks/SKILL.md      Pi agent skill definition (DFT domain knowledge)
├── test/smoke-test.sh              E2E test: starts server, registers user, hits all endpoints
├── Dockerfile                      Multi-stage production build (single image: API + frontend)
└── package.json                    npm workspace root
```

## Key Patterns

### Zustand Stores

All frontend state lives in `frontend/src/store/`. Two patterns:

```ts
// Ephemeral (fetched from API, not persisted):
export const useFilesStore = create<FilesState>((set, get) => ({ ... }));

// Persisted to localStorage:
export const useAuthStore = create<AuthState>()(
  persist((set, get) => ({ ... }), { name: 'goldilocks-auth', partialize: (s) => ({ token: s.token }) })
);
```

| Store | Persistence | Holds |
|-------|-------------|-------|
| `auth` | localStorage (token) | User, token, login/register/logout |
| `chat` | localStorage (messages per conversation) | Messages, streaming deltas, active tool calls |
| `conversations` | None (API) | Conversation list, active conversation ID |
| `context` | None | Current structure info, DFT params, last prediction |
| `files` | None (API) | Workspace file list for active conversation |
| `models` | None (API) | Available LLM models, selected model |
| `settings` | localStorage (theme) | Theme, API key metadata, user preferences |
| `toast` | None | Notification queue (max 3, auto-dismiss 5s) |

### Express Routes

Every route file follows the same pattern:

```ts
const router = Router();
router.use(verifyToken);
router.get('/', (req: AuthRequest, res) => { ... });
export default router;
```

Registered in `server/src/index.ts`: `app.use('/api/<path>', router)`

### WebSocket Protocol

Defined in `shared/types.ts`, implemented in `server/src/agent/websocket.ts` (server)
and `frontend/src/hooks/useAgent.ts` (client).

```
Client                          Server
  │                               │
  ├── { type: 'auth', token } ──→ │  JWT verify
  │ ←── { type: 'auth_ok' } ─────┤
  ├── { type: 'open', convId } ──→│  sessionCache.getOrCreate()
  │ ←── { type: 'ready' } ───────┤
  ├── { type: 'prompt', text } ──→│  session.prompt(text)
  │ ←── thinking_delta* ─────────┤
  │ ←── text_delta* ─────────────┤
  │ ←── tool_start ──────────────┤
  │ ←── tool_end ─────────────────┤
  │ ←── agent_end ────────────────┤
  ├── { type: 'abort' } ────────→ │  session.abort()
```

### SessionBackend

There is only one backend — `ContainerSessionBackend` creates k8s pods per
session via `@kubernetes/client-node`. Pods run with read-only rootfs, non-root
user, all caps dropped, 512Mi memory limit. Idle pods are evicted after 30
minutes (configurable via `AGENT_IDLE_TIMEOUT_MS`).

## Known Quirks

- **3Dmol.js**: Import as `import * as $3Dmol from '3dmol'` — the `$` prefix is required.
- **Express 5**: Catch-all routes use `/{*splat}` syntax, not `*`.
- **Chat persistence**: Messages stored in localStorage, not server DB. Clearing browser data loses history.
- **File uploads**: JSON with base64 content, not multipart/form-data. Max 10MB.
- **WebSocket generation counter**: `useAgent.ts` uses a generation counter to discard stale events on rapid conversation switches.
