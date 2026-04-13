# Goldilocks

AI-powered web application for generating Quantum ESPRESSO input files with ML-predicted k-point grids.

Goldilocks pairs an AI chat assistant with domain-specific tools to help computational materials scientists set up DFT calculations. Upload a crystal structure, ask about k-point convergence, generate ready-to-run Quantum ESPRESSO input files — all through a conversational interface backed by Claude, GPT, or Gemini.

## Features

- **AI chat assistant** — Conversational agent powered by the [Pi coding agent](https://github.com/mariozechner/pi-coding-agent)
- **Live tool streaming** — Tool output and file edits stream back into the UI in real time
- **ML k-point prediction** — ALIGNN and Random Forest models with confidence intervals
- **QE input generation** — End-to-end SCF generation through the Goldilocks CLI
- **3D structure viewer** — Interactive crystal structure visualisation with 3Dmol.js
- **Workspace file browser** — Upload, edit, and manage files in a persistent per-user workspace
- **Multi-provider LLM support** — Bring your own Anthropic, OpenAI, or Google keys
- **Per-user sandbox isolation** — Tool execution happens inside per-user Kubernetes pods

## Repo Layout

```text
goldilocks-app/
  apps/
    frontend/       React UI
    gateway/        Express API + browser websocket edge
    agent-service/  Pi SDK harness + internal websocket/API
  packages/
    contracts/      shared websocket/internal protocol types
    config/         env/config + crypto helpers
    data/           SQLite + migrations
    runtime/        session manager, pod manager, pod tool ops
  infra/
    docker/         development Dockerfiles
    k8s/            deployment manifests used by Tilt
    kind/           kind config template for dev setup
  ops/
    headlamp/       dashboard manifests + token generation
  scripts/
    dev-setup.sh    creates local kind cluster with external state dir
    goldilocks      local Goldilocks CLI placeholder
```

See **[docs/architecture/repo-layout.md](docs/architecture/repo-layout.md)** for the ownership rules.

## Quick Start

Prerequisites: Docker, [kind](https://kind.sigs.k8s.io/), [Tilt](https://docs.tilt.dev/install.html), Node.js 22+.

If you use [Nix](https://nixos.org/), `nix develop` provides Node 22, kind, kubectl, tilt, and native build tools for `better-sqlite3`.

```bash
npm install
npm run dev:setup    # create kind cluster (stores dev state outside the repo)
tilt up              # build, deploy, watch
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000
- **Headlamp**: http://localhost:8080

Register an account, add your API key in Settings, and start chatting.

```bash
tilt down            # stop services
npm run dev:reset    # delete cluster
```

## State & Local Data

By default, local dev state lives in the repo under:

- `${GOLDILOCKS_STATE_DIR}` if set
- otherwise `./.dev`

That state root holds things like the local kind mount and the generated Headlamp login token. It is intentionally gitignored so cleanup is obvious.

## Testing

```bash
npm run typecheck
npm run build
nix develop -c npm test
npm run smoke
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — system overview, layers, ownership
- **[Development Guide](docs/DEVELOPMENT.md)** — workflow, testing, Tilt, local state
- **[Repo Layout](docs/architecture/repo-layout.md)** — monorepo structure and boundaries
- **[WebSocket Protocol](docs/WEBSOCKET-PROTOCOL.md)** — browser ↔ gateway message shapes

## License

MIT
