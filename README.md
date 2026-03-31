# Goldilocks App

React web app with embedded pi agent for DFT input file generation.

## Features

- 🧪 ML-predicted k-point grids for Quantum ESPRESSO calculations
- 🤖 AI-powered chat assistant with DFT domain knowledge
- 📊 3D crystal structure visualization
- 📁 File workspace for structures and generated inputs
- ⚡ Quick generate mode (deterministic, no agent needed)

## Development

### Prerequisites

- Node.js >= 20
- npm >= 10

### Setup

```bash
# Install dependencies
npm install

# Start development servers (frontend + backend)
npm run dev
```

The frontend runs at http://localhost:5173 with hot reload.
The backend runs at http://localhost:3000.

### Build

```bash
npm run build
```

### Production with Docker

```bash
# Copy environment template
cp .env.example .env
# Edit .env with your API keys

# Build and run
docker-compose up -d
```

The app will be available at http://localhost:3000.

## Project Structure

```
goldilocks-app/
├── frontend/           # React + Vite frontend
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── pages/      # Route pages
│   │   ├── store/      # Zustand state stores
│   │   └── api/        # API client
│   └── ...
├── server/             # Express + TypeScript backend
│   ├── src/
│   │   ├── auth/       # Authentication
│   │   ├── migrations/ # Database migrations
│   │   └── ...
│   └── ...
├── skills/             # Pi agent skills
└── AGENTS.md           # Agent context
```

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Zustand
- **Backend**: Express 5, TypeScript, better-sqlite3
- **Auth**: JWT, bcrypt
- **Agent**: Pi SDK (coming in Phase 2)

## License

MIT
