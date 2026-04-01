# Goldilocks App

You are an agent inside the Goldilocks web application. Users interact with you
through a chat interface to generate Quantum ESPRESSO input files for DFT
calculations.

## Your Tools

- `predict_kpoints` — Predict optimal k-point spacing using ML models (ALIGNN or RF)
- `generate_qe_input` — Generate a complete QE SCF input file
- `search_structure` — Search crystal structure databases (Jarvis, MP, MC3D, OQMD)
- Standard tools: `read`, `bash`, `write`, `edit` — operate on the conversation workspace

## Workspace

Your working directory is the conversation's workspace. Users upload structure
files here. You write generated input files here. The workspace persists across
messages in this conversation.

## Guidelines

- When a user uploads a structure, acknowledge it and offer to predict k-points
  or generate an input file.
- When predicting k-points, always report the confidence interval, not just
  the median. Explain what the bounds mean.
- When generating input files, explain the key parameters you chose and why.
- If a prediction has a wide confidence interval (upper - lower > 0.1),
  warn the user and suggest running a convergence test.
- For metallic systems, use cold smearing. For insulators/semiconductors,
  use Gaussian smearing.
- Always use the SSSP pseudopotentials appropriate for the chosen functional.

---

## Codebase Guide

This section documents the codebase structure for developers working on the
Goldilocks web application itself.

### Repository Layout

```
goldilocks-app/
├── frontend/          React 19 + Vite 6 + Tailwind 4 + Zustand 5
├── server/            Express 5 + TypeScript + better-sqlite3
├── skills/            Pi agent skill definitions
├── deploy/            Docker + Kubernetes deployment configs
├── test/              Smoke tests
├── Dockerfile         Multi-stage production build
└── package.json       npm workspace root (workspaces: server, frontend)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/src/index.ts` | Express app setup, route registration, WebSocket server, static file serving |
| `server/src/config.ts` | Environment variable configuration (centralized, typed) |
| `server/src/db.ts` | SQLite connection (WAL mode) + migration runner |
| `server/src/crypto.ts` | AES-256-GCM encrypt/decrypt for stored API keys |
| `server/src/agent/websocket.ts` | WebSocket protocol: auth → open → prompt → stream events |
| `server/src/agent/sessions.ts` | Session cache with backend selection (local vs container) |
| `server/src/agent/local-backend.ts` | In-process Pi SDK sessions with LRU eviction |
| `server/src/agent/container-backend.ts` | Docker container per session (production isolation) |
| `server/src/agent/workspace-guard.ts` | Path traversal prevention for file operations |
| `frontend/src/hooks/useAgent.ts` | WebSocket client: auth, event dispatch to Zustand stores |
| `frontend/src/store/chat.ts` | Chat message state: streaming deltas, tool calls, persistence |
| `frontend/src/api/client.ts` | Typed HTTP client with automatic Bearer token injection |
| `frontend/src/components/layout/ChatPanel.tsx` | Message rendering, tool result cards, markdown + mermaid |

### How to Add a New API Route

1. Create `server/src/<domain>/routes.ts`
2. Create a `Router`, apply `verifyToken` middleware
3. Define your endpoints
4. Register in `server/src/index.ts`:
   ```ts
   import myRoutes from './<domain>/routes.js';
   app.use('/api/<path>', myRoutes);
   ```
5. Add corresponding API calls in `frontend/src/api/client.ts` or use `api.get/post/etc.` directly from stores

### How to Add a New Frontend Component

1. Place it in the appropriate `frontend/src/components/` subdirectory:
   - `auth/` — Authentication-related (LoginForm)
   - `layout/` — Top-level layout panels (Header, Sidebar, ChatPanel, ContextPanel)
   - `science/` — Domain-specific cards and visualizations
   - `ui/` — Reusable generic UI (Toast, Skeleton, ConnectionBanner)
2. If it needs shared state, create a Zustand store in `frontend/src/store/`
3. For API data, use the `api` client: `import { api } from '../api/client'`

### How to Add a New Tool Result Card in Chat

The `ChatPanel.tsx` renders specialized cards when the agent calls `bash` with
recognized `goldilocks` CLI commands. To add a new card type:

1. Create a card component in `frontend/src/components/science/YourCard.tsx`
2. In `ChatPanel.tsx`, find the `ToolCallCard` function
3. Add a new case that checks `getGoldilocksCommand(tool.args)`:
   ```tsx
   if (cmd === 'yourcommand') {
     const parsed = parseYourResult(tool.result);
     if (parsed) return <YourCard data={parsed} />;
   }
   ```
4. Write a parser function that extracts structured data from the CLI output

Currently recognized commands: `predict`, `generate`, `search`.

### Common Patterns

**Zustand stores** — All frontend state lives in `frontend/src/store/`. Stores use:
- `create()` for ephemeral state (chat, context, files, models, toast)
- `create()(persist(...))` for persisted state (auth token, theme settings)
- Actions are defined inside the store, called directly: `useAuthStore.getState().login(...)`
- Selectors with `useStore((s) => s.field)` for minimal re-renders

**Express routes** — All route files follow the same pattern:
```ts
const router = Router();
router.use(verifyToken);  // All routes authenticated
// ...endpoints...
export default router;
```

**WebSocket protocol** — Client sends JSON messages:
1. `{ type: 'auth', token }` → server responds `auth_ok` or `auth_fail`
2. `{ type: 'open', conversationId }` → server creates/resumes session, responds `ready`
3. `{ type: 'prompt', text }` → server streams `text_delta`, `thinking_delta`, `tool_start`, `tool_update`, `tool_end`, `message_end`, `agent_end`
4. `{ type: 'abort' }` → server aborts current generation

**File uploads** — Files are sent as JSON with base64-encoded content (not multipart).
The backend validates extensions, prevents path traversal, and stores files in
`WORKSPACE_ROOT/<userId>/<conversationId>/workspace/`.

**API key management** — User API keys are encrypted with AES-256-GCM before storage
in SQLite. Server-wide keys from environment variables take precedence. The Pi SDK
`AuthStorage` + `ModelRegistry` handle model availability based on configured keys.

### Database Schema

SQLite with WAL mode. Four tables:
- `users` — id, email, password_hash, display_name, settings (JSON), created_at
- `api_keys` — user_id, provider, encrypted_key, created_at (composite PK)
- `conversations` — id, user_id, title, model, provider, timestamps
- `structure_library` — id, user_id, name, formula, source, file_path, metadata (JSON)

Migrations live in `server/src/migrations/` as numbered `.sql` files, applied
automatically on server start.

### Testing

- **Smoke test**: `bash test/smoke-test.sh` — Starts the server, registers a user,
  creates a conversation, uploads a file, hits all API endpoints, and cleans up.
  Requires the server to be built first (`npm run build`).
- **Type checking**: `npm run typecheck` — Runs `tsc --noEmit` on both workspaces.
- **Linting**: `npm run lint` — ESLint on both workspaces.
- No unit test framework is set up yet. The smoke test covers the API surface.

### Environment

- Node.js ≥ 20, npm ≥ 10
- `npm install` at root installs both workspaces
- `npm run dev` starts both frontend (Vite HMR on :5173) and backend (tsx watch on :3000)
- `npm run build` compiles both for production
- See `.env.example` for all environment variables
