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

Tilt watches ownership boundaries rather than the whole repo:
- `apps/frontend/src/**` — Vite HMR in the `web-app` resource
- `apps/gateway/src/**` — gateway restart in the `web-app` resource
- `apps/agent-service/src/**` — agent-service restart in the `agent-service` resource
- `packages/contracts|config|data|runtime/src/**` — only dependent resources restart
- `ops/headlamp/**` — ops-only updates; should not restart app resources
- package manifests / lockfile / Dockerfiles — full image rebuilds

Local kind state is created by `npm run dev:setup` under:
- `${GOLDILOCKS_STATE_DIR}` if set
- otherwise `./.dev`

### First-time setup

1. Register a user account at http://localhost:5173
2. Go to Settings → API Keys → add an Anthropic/OpenAI/Google key
3. Create a conversation and start chatting

### Resetting

```bash
tilt down
npm run dev:reset
npm run dev:setup
tilt up
```

## Debugging

## Testing

The project uses [Vitest](https://vitest.dev/) for unit and integration tests.

```bash
# Run all tests (preferred in the project dev shell so native deps match)
nix develop -c npm test

# Watch mode
npm run test:watch

# Vitest UI
npm run test:ui

# Smoke test against the built gateway
npm run smoke
```

### What the tests cover

- **`apps/gateway/test/api/*.test.ts`** — Auth, conversations, settings, and file-route integration tests
- **`packages/runtime/test/*.test.ts`** — Pod manager, pod tool operations, session manager
- **`packages/config/test/config.test.ts`** — config/env edge cases
- **`apps/frontend/src/lib/fileKinds.test.ts`** — pure frontend file-kind logic

Gateway API tests use an in-process Express server with:
- a fresh SQLite DB per suite
- a stubbed pod manager / session manager surface
- local filesystem-backed file operations instead of real k8s exec

The smoke test lives at `apps/gateway/test/smoke-test.sh` and runs against the built gateway.

### Debugging

### Headlamp dashboard

Tilt port-forwards Headlamp to `http://localhost:8080` and generates a dev login token under the local state root:

```bash
cat "${GOLDILOCKS_STATE_DIR:-$PWD/.dev}/headlamp/headlamp-token.txt"
```

If the token expires or the file is missing, regenerate it through Tilt:

```bash
tilt trigger headlamp-token
```

Headlamp runs in-cluster with a dedicated `headlamp` runtime service account, but the Tilt-generated login token comes from a separate `headlamp-admin` service account bound to `cluster-admin` for local dev.

### Logs

Server and agent-service logs stream in the Tilt UI. For agent-specific logs:

```bash
# Gateway logs
kubectl logs -n goldilocks -l app=web-app

# Agent service logs
kubectl logs -n goldilocks -l app=agent-service

# Sandbox pod
kubectl logs -n goldilocks -l role=agent
```

### Common Issues

**Port already in use (3000 or 10350)**

A stale process from a previous Tilt run. Kill it:

```bash
fuser -k 3000/tcp
fuser -k 10350/tcp
```

**Agent pod tools aren't working**

The sandbox image no longer includes pi — it just runs `sleep infinity`. Tool commands are exec'd into it by the agent-service. If file operations fail:

```bash
kubectl logs -n goldilocks -l app=agent-service
```

**Bridge not found**

The JSONL Bridge (`bridge.ts`) has been removed. The agent-service uses the Pi SDK in-process. If you see references to `bridge` in errors, check that you're looking at the current codebase.

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

If you are running locally outside Kubernetes, the DB defaults to:

```bash
sqlite3 "${GOLDILOCKS_STATE_DIR:-$PWD/.dev}/goldilocks.db"
> SELECT id, title, pi_session_id FROM conversations;
> SELECT user_id, provider FROM api_keys;
```

In kind dev, the DB lives inside the kind host mount under the local state root created by `npm run dev:setup`.

### Inspecting user files

Sandbox home directories are mounted under the kind host data directory created by `scripts/dev-setup.sh`.
The exact location is printed when the cluster is created.

## Project Structure

For the current monorepo layout, see **[docs/architecture/repo-layout.md](architecture/repo-layout.md)**.

High-level summary:

```text
goldilocks-app/
├── apps/
│   ├── frontend/
│   ├── gateway/
│   └── agent-service/
├── packages/
│   ├── contracts/
│   ├── config/
│   ├── data/
│   └── runtime/
├── infra/
│   ├── docker/
│   ├── k8s/
│   └── kind/
├── ops/headlamp/
├── scripts/
└── Tiltfile
```

Code rule: apps import from `packages/*`; apps do not import each other.

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
