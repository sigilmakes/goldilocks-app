# Goldilocks — Agent Guide

Goldilocks is a web application for generating Quantum ESPRESSO DFT input files
with ML-predicted k-point grids. It pairs an AI chat assistant (powered by Pi SDK)
with domain-specific ML models (ALIGNN, Random Forest) to help computational
materials scientists set up DFT calculations through a conversational interface.

## Running Dev

```bash
npm install
npm run dev:setup            # creates the kind cluster using external state storage
 tilt up                      # everything starts — frontend, gateway, agent-service, infra
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
- Headlamp: http://localhost:8080
- Tilt dashboard: http://localhost:10350

Everything runs in kind. Tilt handles image builds, manifest application,
scoped live_update syncs, and port-forwarding. No local servers.

Edit `apps/frontend/src` → Tilt syncs → Vite HMR.
Edit `apps/gateway/src` → Tilt syncs → gateway restart.
Edit `apps/agent-service/src` → Tilt syncs → agent-service restart.
Edit `packages/*/src` → only dependent services rebuild/restart.

Teardown: `tilt down` (stop services) or `kind delete cluster --name goldilocks`.

Type checking: `npm run typecheck`
Build: `npm run build`
Smoke test: `npm run build && bash apps/gateway/test/smoke-test.sh`

## Directory Structure

```text
goldilocks-app/
├── apps/
│   ├── frontend/                   React UI
│   ├── gateway/                    Express API + browser websocket edge
│   └── agent-service/              Pi SDK harness + internal websocket/API
├── packages/
│   ├── contracts/                  shared websocket/internal protocol types
│   ├── config/                     env/config + crypto helpers
│   ├── data/                       SQLite + migrations
│   └── runtime/                    session manager, pod manager, pod tool ops
├── infra/
│   ├── docker/                     dev Dockerfiles
│   ├── k8s/                        manifests used by Tilt
│   └── kind/                       kind config template
├── ops/headlamp/                   dashboard manifests + token generation
├── scripts/
│   ├── dev-setup.sh                kind bootstrap with external state root
│   └── goldilocks                  local CLI placeholder
├── Tiltfile                        dev orchestration
└── package.json                    npm workspace root
```

Rule of the crypt: apps import `packages/*`; apps do **not** import each other.

## Key Patterns

### Zustand Stores

All frontend state lives in `apps/frontend/src/store/`. Two patterns:

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

Registered in `apps/gateway/src/index.ts`: `app.use('/api/<path>', router)`

### WebSocket Protocol

Defined in `packages/contracts/src/websocket.ts`, implemented in `apps/gateway/src/agent/websocket.ts` (gateway)
and `apps/frontend/src/hooks/useAgent.ts` (client).

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
