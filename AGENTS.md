# Goldilocks — Agent Guide

Goldilocks is a web application for generating Quantum ESPRESSO DFT input files
with ML-predicted k-point grids. It pairs an AI chat assistant (powered by Pi SDK)
with domain-specific ML models (ALIGNN, Random Forest) to help computational
materials scientists set up DFT calculations through a conversational interface.

## Running Dev

```bash
npm install          # installs both frontend + server workspaces
npm run k8s:setup    # one-time: create kind cluster + apply k8s manifests
npm run dev          # starts Vite (5173) + Express (3000) concurrently
```

Vite proxies `/api` and `/ws` to port 3000. You need at least one LLM API key
set as an env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY`).

Agent sessions always run in k8s pods (kind cluster for local dev).
Rebuild agent image: `npm run k8s:build-agent`
Tear down: `npm run k8s:teardown`

Type checking (both workspaces): `npm run typecheck`
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
├── skills/goldilocks/SKILL.md      Pi agent skill definition (DFT domain knowledge)
├── deploy/                         Docker + k8s deployment configs
│   ├── docker/                     Dockerfiles for web, agent, MCP server
│   └── k8s/                        Namespace, RBAC, network policies, pod templates, ingress
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

Stores are accessed in components via selectors for minimal re-renders:
`const token = useAuthStore((s) => s.token);`

Actions are called directly: `useAuthStore.getState().login(email, password)`

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
// server/src/<domain>/routes.ts
const router = Router();
router.use(verifyToken);     // All routes require JWT
router.get('/', (req: AuthRequest, res) => { ... });
export default router;
```

Registered in `server/src/index.ts`: `app.use('/api/<path>', router)`

The `AuthRequest` type extends Express `Request` with `user?: { id, email }`.

### WebSocket Protocol

Defined in `shared/types.ts`, implemented in `server/src/agent/websocket.ts` (server)
and `frontend/src/hooks/useAgent.ts` (client).

```
Client                          Server
  │                               │
  ├── { type: 'auth', token } ──→ │  JWT verify
  │ ←── { type: 'auth_ok' } ─────┤
  │                               │
  ├── { type: 'open', convId } ──→│  sessionCache.getOrCreate()
  │ ←── { type: 'ready' } ───────┤
  │                               │
  ├── { type: 'prompt', text } ──→│  session.prompt(text)
  │ ←── thinking_delta* ─────────┤  Pi SDK events mapped to WS messages
  │ ←── text_delta* ─────────────┤
  │ ←── tool_start ──────────────┤
  │ ←── tool_update* ────────────┤
  │ ←── tool_end ─────────────────┤
  │ ←── message_end ──────────────┤  (may loop: more text_delta/tool cycles)
  │ ←── agent_end ────────────────┤  Agent done, ready for next prompt
  │                               │
  ├── { type: 'abort' } ────────→ │  session.abort()
```

One prompt at a time. `isProcessing` flag prevents concurrent prompts.
Opening a new conversation on the same WS cleanly tears down the previous session subscription.
The `useAgent` hook uses a generation counter to discard events from stale connections after rapid conversation switches.

### SessionBackend Abstraction

`server/src/agent/session-backend.ts` defines the interface:

```ts
interface SessionBackend {
  getOrCreate(userId, conversationId): Promise<SessionHandle>;
  touch(userId, conversationId): void;    // Reset idle timeout
  dispose(userId, conversationId): void;  // Tear down session
  shutdown(): void;                       // Clean up all (server exit)
}
```

**ContainerSessionBackend** (`container-backend.ts`): Creates k8s pods per session
via `@kubernetes/client-node`. Pods run with read-only rootfs, non-root user,
all caps dropped, 512Mi memory limit. Each user gets a PVC for workspace
persistence. Idle pods are evicted after 30 minutes (configurable via
`AGENT_IDLE_TIMEOUT_MS`). In-cluster: direct pod IP WebSocket. Out-of-cluster:
k8s PortForward API tunnel.

There is only one backend — k8s is the only way to run agent sessions.

## How To: Add a New API Route

1. Create `server/src/<domain>/routes.ts`:
   ```ts
   import { Router, Response } from 'express';
   import { verifyToken, AuthRequest } from '../auth/middleware.js';

   const router = Router();
   router.use(verifyToken);

   router.get('/', (req: AuthRequest, res: Response) => {
     const userId = req.user!.id;
     res.json({ data: [] });
   });

   export default router;
   ```

2. Register in `server/src/index.ts`:
   ```ts
   import myRoutes from './<domain>/routes.js';
   app.use('/api/<path>', myRoutes);
   ```

3. Call from frontend using `api` client (`frontend/src/api/client.ts`):
   ```ts
   import { api } from '../api/client';
   const data = await api.get<MyType>('/my-endpoint');
   ```

## How To: Add a New Tool Result Card in Chat

When the agent calls `bash` with a `goldilocks` CLI command, the `ToolCallCard`
component (`frontend/src/components/chat/ToolCallCard.tsx`) checks
`getGoldilocksCommand(tool.args)` and renders specialized cards.

1. Create `frontend/src/components/science/YourCard.tsx`

2. In `ToolCallCard.tsx`, add a case in the existing `if (tool.toolName === 'bash' && ...)` block:
   ```tsx
   if (cmd === 'yourcommand') {
     const parsed = parseYourResult(tool.result);
     if (parsed) return <YourCard data={parsed} />;
   }
   ```

3. Write a `parseYourResult()` function that extracts structured data from CLI JSON output.

Currently recognized commands: `predict` → KPointsResultCard, `generate` → InputFileCard, `search` → inline table.

## How To: Add a New Zustand Store

1. Create `frontend/src/store/mystore.ts`:
   ```ts
   import { create } from 'zustand';

   interface MyState {
     items: Item[];
     fetch: () => Promise<void>;
   }

   export const useMyStore = create<MyState>((set) => ({
     items: [],
     fetch: async () => {
       const { items } = await api.get<{ items: Item[] }>('/my-items');
       set({ items });
     },
   }));
   ```

2. Use in components: `const items = useMyStore((s) => s.items);`

3. For persistence, wrap with `persist()`:
   ```ts
   export const useMyStore = create<MyState>()(
     persist((set) => ({ ... }), { name: 'goldilocks-my-store' })
   );
   ```

## Testing

**Smoke test** (`test/smoke-test.sh`): Starts the server on a temp port with a
temp data directory, registers a user, creates a conversation, uploads a file,
hits all REST endpoints, and verifies responses. Requires a built server
(`npm run build` first). Does NOT test WebSocket/agent — only HTTP API surface.

**Type checking**: `npm run typecheck` runs `tsc --noEmit` on both workspaces.
Both have `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.

**No unit test framework** is set up. The smoke test + TypeScript strict mode
are the current safety nets.

## Known Quirks and Gotchas

### 3Dmol.js Import

`frontend/src/components/science/StructureViewer.tsx` imports 3Dmol.js with
`import * as $3Dmol from '3dmol'`. The `$` prefix is required because 3Dmol
attaches to the global `$3Dmol` variable. The Vite config may need special
handling for this module's side effects.

### Express 5 Catch-All Syntax

Express 5 requires named parameters for catch-all routes. In `server/src/index.ts`:
```ts
// Express 4: app.get('*', handler)
// Express 5: app.get('/{*splat}', handler)
app.get('/{*splat}', (req, res, next) => { ... });
```

### localStorage Chat Persistence

Chat messages are stored in `localStorage` keyed by conversation ID, NOT in the
server database. The `conversations` table only stores metadata (title, model,
timestamps). Clearing browser data loses all message history. Large tool results
are truncated to 2KB before storage to avoid quota issues. Max 50 conversations
stored; oldest are pruned on save.

### File Upload Format

Files are uploaded as JSON with base64-encoded content (`{ filename, content }`),
NOT as multipart/form-data. This is handled in `server/src/files/routes.ts`.
Max 10MB per file. Allowed extensions are restricted.

### WebSocket Generation Counter

In `useAgent.ts`, a `generationRef` counter prevents stale WebSocket messages
from being dispatched to the store when the user rapidly switches between
conversations. Each `useEffect` run increments the counter; incoming messages
check their generation matches the current one.

### Rate Limiting

`server/src/index.ts` applies `express-rate-limit`: 60 req/min in production
(300 in dev) globally, and 20 req/15min on auth endpoints.

### CORS

Permissive in development (`cors()` with no options). In production, restricted
to `CORS_ORIGIN` env var.
