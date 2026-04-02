# Goldilocks

AI-powered web application for generating Quantum ESPRESSO input files with ML-predicted k-point grids. Getting your DFT parameters *just right*.

Goldilocks pairs an AI chat assistant with domain-specific tools to help computational materials scientists set up DFT calculations. Upload a crystal structure, ask about k-point convergence, generate ready-to-run Quantum ESPRESSO input files — all through a conversational interface backed by Claude, GPT, or Gemini.

## Features

- **AI chat assistant** — Conversational agent powered by the [Pi coding agent](https://github.com/mariozechner/pi-coding-agent). Reasons about your structures, explains parameters, writes and runs code, calls domain tools.
- **Live tool streaming** — Watch the agent work in real-time: file writes stream character by character, bash output appears as it runs.
- **ML k-point prediction** — ALIGNN and Random Forest models for predicting optimal k-point grids with confidence intervals.
- **QE input generation** — Complete SCF input files with SSSP pseudopotentials, appropriate smearing, and per-element cutoffs.
- **3D structure viewer** — Interactive crystal structure visualisation (3Dmol.js) with multiple rendering modes.
- **Multi-provider LLM support** — Bring your own API keys for Anthropic, OpenAI, or Google. Switch models mid-conversation.
- **Per-user isolation** — Each user gets their own k8s pod with a persistent home directory.

## Quick Start

Prerequisites: Docker, [kind](https://kind.sigs.k8s.io/), [Tilt](https://docs.tilt.dev/install.html), Node.js 22+, and at least one LLM API key.

```bash
npm install
npm run dev:setup    # create kind cluster
tilt up              # build, deploy, watch
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3000

Register an account, add your API key in Settings, and start chatting.

```bash
tilt down            # stop
npm run dev:reset    # delete cluster
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — System overview, layers, data ownership
  - [Backend](docs/architecture/backend.md), [Frontend](docs/architecture/frontend.md), [Data Flow](docs/architecture/data-flow.md), [Deployment](docs/architecture/deployment.md), [Security](docs/architecture/security.md), [WebSocket Sessions](docs/architecture/websocket-sessions.md)
- **[Development Guide](docs/DEVELOPMENT.md)** — Workflow, debugging, project structure
- **[WebSocket Protocol](docs/WEBSOCKET-PROTOCOL.md)** — Client/server messages, state machine

## License

MIT
