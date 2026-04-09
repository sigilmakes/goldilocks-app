# Development Guide

## Prerequisites

- **Docker** (for building images)
- **kind** (Kubernetes in Docker) — `go install sigs.k8s.io/kind@latest` or via package manager
- **Tilt** — https://docs.tilt.dev/install
- **Node.js 22+**
- **kubectl** — for debugging

### Using Nix

If you have [Nix](https://nixos.org/) with flakes enabled, all dependencies are provided by the dev shell:

```bash
nix develop        # enter the shell (Node.js 22, kind, kubectl, tilt)
```

Or with [direnv](https://direnv.net/), add `use flake` to `.envrc` for automatic activation.

## Quick Start

```bash
# 1. Install npm dependencies
npm install

# 2. Create the kind cluster (idempotent)
npm run dev:setup

# 3. Start Tilt (builds images, deploys, watches for changes)
tilt up

# 4. Open browser
#    Frontend:  http://localhost:5173
#    API:       http://localhost:3000
#    Headlamp:  http://localhost:8080
#    Tilt UI:   http://localhost:10350
```

## Dev Workflow

Tilt watches for file changes and live-syncs them into the running container:
- `server/src/**/*.ts` — live-synced → tsx watch restarts (~1–2s)
- `frontend/src/**/*.tsx` — live-synced → Vite HMR (instant)
- `shared/types.ts` — live-synced → both restart
- `package.json` / `package-lock.json` — full image rebuild
- `deploy/docker/Dockerfile.agent` — agent image rebuild + kind load
- `k8s/*.yaml` — re-applied to cluster

### First-time setup

1. Register a user account at http://localhost:5173 (any email/password)
2. Go to Settings → API Keys → Add your Anthropic key
3. Create a conversation and start chatting

### Resetting

```bash
tilt down            # stop services
npm run dev:reset   # delete cluster and all data
npm run dev:setup   # start fresh
tilt up
```

## Debugging

### Headlamp dashboard

Tilt port-forwards Headlamp to `http://localhost:8080` and generates a dev login token at `.dev/headlamp-token.txt`.

```bash
cat .dev/headlamp-token.txt
```

If the token expires or the file is missing, regenerate it through Tilt:

```bash
tilt trigger headlamp-token
```

Headlamp runs in-cluster with a dedicated `headlamp` service account scoped to the `goldilocks` namespace.

### Logs

Server logs stream in the Tilt UI. For agent-specific logs:

```bash
# Bridge and pod manager logs
cat data/logs/bridge-*.log
cat data/logs/pod-manager.log

# Agent pod logs (stderr from pi)
kubectl logs -n goldilocks -l app=goldilocks-web  # web pod
kubectl logs -n goldilocks -l role=agent            # agent pods
```

### Common Issues

**Port already in use (3000 or 10350)**

A stale process from a previous Tilt run. Kill it:

```bash
fuser -k 3000/tcp
fuser -k 10350/tcp
```

**Agent pod can't start — `pi` not found in PATH**

The agent image needs rebuilding and loading into kind. Tilt handles this via the `agent-image` local resource, but if you reset the cluster you may need to trigger a rebuild:

```bash
tilt trigger agent-image
```

**EACCES in agent pod**

The hostPath directory is created as root. The init container should fix permissions, but if you see this, delete the agent pod and let it recreate:

```bash
kubectl delete pod -n goldilocks -l role=agent
```

**Bridge closed immediately**

Check the Bridge logs for stderr from pi. Common causes:
- Missing API keys (user hasn't set them in Settings)
- Pi crash on startup (check `data/logs/bridge-*.log`)

### Inspecting the database

```bash
sqlite3 data/goldilocks.db
> SELECT id, title, pi_session_id FROM conversations;
> SELECT user_id, provider FROM api_keys;
```

### Inspecting user files

User home directories are at `data/homes/<userId>/`:

```bash
ls data/homes/
ls data/homes/<userId>/.pi/agent/sessions/
```

## Project Structure

```
goldilocks-app/
├── shared/
│   └── types.ts                  WebSocket protocol types (ClientMessage, ServerMessage)
│
├── server/src/
│   ├── index.ts                  Express app entry point, route registration, WebSocket setup
│   ├── config.ts                 Centralized typed env vars (CONFIG object)
│   ├── db.ts                     SQLite setup (WAL mode), auto-migration runner
│   ├── crypto.ts                 AES-256-GCM encrypt/decrypt for stored API keys
│   │
│   ├── agent/
│   │   ├── websocket.ts          WebSocket handler: auth → open → prompt → Bridge events
│   │   ├── sessions.ts           SessionManager: userId → Bridge cache, session switching
│   │   ├── bridge.ts             JSONL stdin/stdout RPC to pi (only code that talks to pi)
│   │   ├── pod-manager.ts        k8s pod/volume lifecycle, exec streams, idle eviction
│   │   ├── k8s-client.ts         Thin k8s API client wrapper
│   │   └── workspace-guard.ts    Path traversal protection for exec commands
│   │
│   ├── auth/
│   │   ├── routes.ts             POST register, login; GET me
│   │   └── middleware.ts         verifyToken (JWT), AuthRequest type
│   │
│   ├── conversations/routes.ts    GET list, POST create, GET/:id/messages, PATCH, DELETE
│   ├── files/routes.ts           Workspace file CRUD via k8s exec (GET, PUT, DELETE, /upload, /move, /mkdir, /raw)
│   ├── models/routes.ts           GET available LLMs, POST select
│   ├── settings/routes.ts         GET/PATCH settings, API key CRUD
│   ├── structures/routes.ts       Structure CRUD + search (JARVIS, MP, MC3D, OQMD)
│   └── quickgen/routes.ts         POST /predict, POST /generate (goldilocks CLI, no agent)
│
├── frontend/src/
│   ├── main.tsx                  Entry point
│   ├── App.tsx                   Router: /login, /settings (lazy), /* → Workspace
│   ├── api/
│   │   └── client.ts             Typed fetch wrapper; auto-injects Bearer token
│   │
│   ├── hooks/
│   │   ├── useAgent.ts           WebSocket lifecycle: auth → open → prompt → stream to store
│   │   └── useConnectionStatus.ts Polls /api/health, exponential backoff, online/offline
│   │
│   ├── store/
│   │   ├── auth.ts               User session, JWT, login/logout/register
│   │   ├── chat.ts               Messages, streaming state, active tool calls
│   │   ├── chatPrompt.ts         Pending prompt queue for seeded conversations
│   │   ├── conversations.ts      Conversation list, active conversation
│   │   ├── context.ts            ML prediction result, generation defaults
│   │   ├── files.ts              Workspace file tree (tree + flat index)
│   │   ├── models.ts             Available LLM models, selected model
│   │   ├── settings.ts           Theme, defaultModel, defaultFunctional, API key metadata
│   │   ├── tabs.ts               Open tabs, active tab (persisted until logout)
│   │   ├── toast.ts               Notification queue
│   │   └── session-reset.ts      resetUserScopedFrontendState() — clears all user-scoped state
│   │
│   ├── lib/
│   │   ├── fileKinds.ts          Canonical file-kind registry: viewer, icon, Monaco language
│   │   ├── fileAssociations.ts    getFileExtension helper
│   │   └── promptTemplates.ts    Structured prompt templates for QE generation
│   │
│   ├── components/
│   │   ├── ErrorBoundary.tsx     Top-level render error boundary
│   │   │
│   │   ├── auth/
│   │   │   └── LoginForm.tsx
│   │   │
│   │   ├── chat/
│   │   │   ├── MessageBubble.tsx     User/assistant message rendering
│   │   │   ├── ToolCallCard.tsx      Tool call streaming + result display
│   │   │   ├── MarkdownContent.tsx   Markdown renderer (marked + sanitized)
│   │   │   └── WelcomeMessage.tsx    Empty-conversation landing
│   │   │
│   │   ├── layout/
│   │   │   ├── Header.tsx             Model selector, theme, sidebar toggle, user menu
│   │   │   ├── ChatPanel.tsx          Message list + input area
│   │   │   └── GenerationDefaultsPopover.tsx  DFT param quick-set popover
│   │   │
│   │   ├── science/
│   │   │   ├── StructureViewer.tsx    3Dmol.js crystal structure viewer
│   │   │   └── PredictionSummary.tsx  ML k-point prediction result display
│   │   │
│   │   ├── shell/
│   │   │   ├── AppShell.tsx           Root layout: sidebar + center + mobile
│   │   │   ├── SidebarHost.tsx        Conversation/workspace sidebar swap
│   │   │   ├── TabStrip.tsx            Tab bar
│   │   │   └── TabContentHost.tsx      Tab content router
│   │   │
│   │   ├── sidebar/
│   │   │   ├── ConversationSidebar.tsx  Conversation list + new conversation button
│   │   │   └── WorkspaceSidebar.tsx     Workspace file tree + new/upload buttons
│   │   │
│   │   ├── views/
│   │   │   ├── ConversationView.tsx    ChatPanel wrapper
│   │   │   ├── FileView.tsx            FileBrowser + FileViewer side by side
│   │   │   ├── StructureView.tsx       StructureViewer (full pane)
│   │   │   └── WelcomeView.tsx         Empty state
│   │   │
│   │   ├── workspace/
│   │   │   ├── FileBrowser.tsx         Tree view + search + context menus
│   │   │   ├── FileViewer.tsx          Viewer router + lazy-load boundary
│   │   │   ├── MilkdownEditor.tsx     Markdown editor (lazy-loaded)
│   │   │   ├── MonacoEditor.tsx        Code editor (lazy-loaded)
│   │   │   ├── PdfViewer.tsx           PDF renderer (lazy-loaded)
│   │   │   └── ImageViewer.tsx         Image renderer (lazy-loaded)
│   │   │
│   │   └── ui/
│   │       ├── Toast.tsx               Notification component
│   │       ├── Skeleton.tsx            Loading placeholder
│   │       ├── ConnectionBanner.tsx    WebSocket status banner
│   │       └── MermaidDiagram.tsx      Mermaid.js renderer
│   │
│   └── pages/
│       ├── Login.tsx
│       ├── Workspace.tsx             Thin wrapper: <AppShell />
│       └── Settings.tsx              API keys, defaults, theme (lazy-loaded)
│
├── k8s/                              Core Kubernetes manifests (namespace, RBAC, web-app)
├── deploy/
│   ├── docker/
│   │   ├── Dockerfile.web.dev        Dev web app (tsx watch + Vite)
│   │   └── Dockerfile.agent          Agent container (pi installed, sleep infinity)
│   └── kind-config.yaml              Kind cluster config with hostPath bind-mounts
├── dashboard/                        Headlamp ops dashboard (in-cluster)
│   ├── k8s/headlamp.yaml
│   └── k8s/headlamp-rbac.yaml
├── skills/
│   └── goldilocks/SKILL.md           Pi agent skill definition (DFT domain knowledge)
└── Tiltfile                           Dev orchestration: builds, live_update, port-forwards
```

## Code Conventions

### TypeScript

- Strict mode enabled
- Prefer explicit types over `any`
- Use `unknown` for external/untrusted data, narrow with type guards
- Prefer named exports over default exports for stores and hooks

### React

- Functional components with hooks only
- Co-locate component-specific helpers/types within the file
- Use `useCallback` / `useMemo` for functions/values passed as props to prevent unnecessary re-renders
- Use `lazy` + `Suspense` for route-level and heavy component-level splits

### State management

- Stores own one domain; no store reaches into another store's internals
- Cross-store effects live in the component that triggers them
- Auth transitions use `resetUserScopedFrontendState()` from `session-reset.ts`

### Styling

- Tailwind CSS utility classes throughout
- No inline styles except for dynamic values (e.g., positioning from JS)
- Component-scoped styles via Tailwind classes only
