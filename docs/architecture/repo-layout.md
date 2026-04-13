# Repo Layout

## Why the repo is shaped this way

Goldilocks is a monorepo with multiple deployable applications, shared runtime libraries, and infrastructure. The root is intentionally split into `apps/`, `packages/`, `infra/`, and `ops/` so small changes stay local:

- a UI change should usually stay inside `apps/frontend`
- a gateway REST change should usually stay inside `apps/gateway`
- a Pi/session/pod-runtime change should usually stay inside `packages/runtime`
- an ops/dashboard change should not restart app containers in Tilt

## Ownership Rules

### Apps

- `apps/frontend` owns the React UI
- `apps/gateway` owns browser auth, REST, browser websocket relay, and static serving
- `apps/agent-service` owns the Pi SDK harness and internal websocket/API

Apps may import from `packages/*`, but **must not import from another app's `src/` tree**.

### Packages

- `packages/contracts` owns shared protocol types
- `packages/config` owns environment/config helpers and crypto helpers
- `packages/data` owns SQLite access and migrations
- `packages/runtime` owns the session manager, pod manager, k8s client, and pod-backed tool operations

Packages may depend on other packages, but should stay acyclic and sharply scoped.

### Infra / Ops

- `infra/` is for Docker, Kubernetes, and kind configuration
- `ops/` is for operational tooling that is not part of the app runtime itself
- `scripts/` is for developer entrypoints and local tooling

## Import Rules

Allowed:

```ts
import type { ServerMessage } from '@goldilocks/contracts';
import { sessionManager } from '@goldilocks/runtime';
```

Forbidden:

```ts
import { sessionManager } from '../../apps/gateway/src/...';
import type { ServerMessage } from '../../../shared/types';
```

## Tilt Rules

Each Tilt image watches only:
- its owning app directory
- the shared packages it depends on
- its own Dockerfile and package manifests

Operational files such as Headlamp token generation must stay isolated from app rebuilds.

## Local State

Source and runtime state are separated.

Defaults:
- app state: `${GOLDILOCKS_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/goldilocks}`
- kind host mount: created by `scripts/dev-setup.sh`
- Headlamp token: `${STATE_ROOT}/headlamp/headlamp-token.txt`

The repo may still contain legacy ignored state directories on older checkouts, but new setup paths should use the external state root.
