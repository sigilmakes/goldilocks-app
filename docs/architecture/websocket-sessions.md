# WebSocket & Session Management

The WebSocket layer connects the frontend chat to the Pi SDK agent sessions.
This document covers the protocol state machine, event mapping, and session
backend abstraction.

## WebSocket State Machine

Each WebSocket connection tracks a `ClientState` object with authentication,
conversation binding, and processing status:

```mermaid
stateDiagram-v2
    [*] --> CONNECTED: WebSocket connect

    CONNECTED --> AUTHENTICATED: auth message<br/>jwt.verify() succeeds
    CONNECTED --> CLOSED: auth_fail

    AUTHENTICATED --> READY: open message<br/>sessionCache.getOrCreate()
    AUTHENTICATED --> AUTHENTICATED: open fails (error sent)

    READY --> PROCESSING: prompt message<br/>session.prompt()
    READY --> READY: open (switch conversation,<br/>cleans up previous)

    PROCESSING --> READY: agent_end
    PROCESSING --> READY: abort → session.abort()
    PROCESSING --> READY: error

    READY --> CLOSED: socket close
    PROCESSING --> CLOSED: socket close
    CLOSED --> [*]
```

### Server-Side State

```ts
// server/src/agent/websocket.ts
interface ClientState {
  user: AuthUser | null;           // Set after auth
  conversationId: string | null;   // Set after open
  session: AgentSession | null;    // Pi SDK session
  unsubscribe: (() => void) | null; // Event subscription cleanup
  isProcessing: boolean;           // Prevents concurrent prompts
}
```

## Pi SDK Event Mapping

The `mapAgentEvent()` function in `websocket.ts` translates Pi SDK event types
to the `ServerMessage` union (defined in `shared/types.ts`):

```mermaid
graph LR
    subgraph "Pi SDK Events"
        MU_text["message_update<br/>(text_delta)"]
        MU_think["message_update<br/>(thinking_delta)"]
        TES["tool_execution_start"]
        TEU["tool_execution_update"]
        TEE["tool_execution_end"]
        ME["message_end"]
        AE["agent_end"]
    end

    subgraph "WebSocket Messages"
        TD["text_delta"]
        ThD["thinking_delta"]
        TS["tool_start"]
        TU["tool_update"]
        TE2["tool_end"]
        ME2["message_end"]
        AE2["agent_end"]
    end

    MU_text --> TD
    MU_think --> ThD
    TES --> TS
    TEU --> TU
    TEE --> TE2
    ME --> ME2
    AE --> AE2
```

The `tool_update` message carries streaming output from tools (e.g., partial
bash stdout). Currently the frontend's `updateToolCall` store action is a no-op
placeholder, but the infrastructure is in place.

## Session Backend Interface

```mermaid
graph TD
    WSHandler["websocket.ts"]
    Cache["sessionCache<br/><small>sessions.ts</small>"]
    Backend["SessionBackend<br/><small>interface</small>"]
    Local["LocalSessionBackend<br/><small>local-backend.ts</small>"]
    Container["ContainerSessionBackend<br/><small>container-backend.ts</small>"]

    WSHandler -->|"getOrCreate()"| Cache
    Cache --> Backend
    Backend --> Local
    Backend --> Container
```

### Interface — `session-backend.ts`

```ts
interface SessionBackend {
  getOrCreate(userId: string, conversationId: string): Promise<SessionHandle>;
  touch(userId: string, conversationId: string): void;
  dispose(userId: string, conversationId: string): void;
  shutdown(): void;
}

interface SessionHandle {
  session: AgentSession;     // Pi SDK session object
  workspacePath: string;     // /data/workspaces/<userId>/<convId>/workspace
  sessionPath: string;       // /data/workspaces/<userId>/<convId>/pi-session
}
```

### `sessionCache` Wrapper — `sessions.ts`

The `sessionCache` in `sessions.ts` is a thin compatibility wrapper that
selects the backend based on `SESSION_BACKEND` env var and provides a
simplified API that returns `AgentSession` directly (the WebSocket layer
only needs the session object):

```ts
const sessionCache = {
  getOrCreate(userId, convId): Promise<AgentSession>,  // Unwraps SessionHandle
  touch(userId, convId): void,
  dispose(userId, convId): void,
  shutdown(): void,
  get backend(): SessionBackend,  // For code that needs full SessionHandle
};
```

## LocalSessionBackend

Used in development and single-user deployments (`SESSION_BACKEND=local`,
the default).

```mermaid
graph TD
    Open["WebSocket 'open' message"]
    Check["Check cache"]
    Hit["Cache hit → return existing"]
    Capacity["At capacity?"]
    EvictLRU["Evict least-recently-used"]
    CreateDirs["Create workspace + session dirs"]
    WriteAgents["Write AGENTS.md to workspace"]
    Symlink["Symlink goldilocks CLI"]
    LoadKeys["Load user API keys from DB<br/><small>decrypt with AES-256-GCM</small>"]
    SetServerKeys["Set server-wide API keys<br/><small>as fallback</small>"]
    CreateSession["Pi SDK createAgentSession()"]
    Cache2["Store in cache Map"]
    Return["Return SessionHandle"]

    Open --> Check
    Check -->|"hit"| Hit --> Return
    Check -->|"miss"| Capacity
    Capacity -->|"yes"| EvictLRU --> CreateDirs
    Capacity -->|"no"| CreateDirs
    CreateDirs --> WriteAgents --> Symlink --> LoadKeys --> SetServerKeys --> CreateSession --> Cache2 --> Return
```

### Key Details

- **Cache key:** `${userId}:${conversationId}`
- **LRU eviction:** When `sessions.size >= CONFIG.maxSessions`, the session with
  the oldest `lastActive` timestamp is disposed
- **Idle eviction:** Every 60 seconds, sessions idle longer than
  `SESSION_IDLE_TIMEOUT_MS` (default: 5 min) are disposed
- **API key priority:** User's encrypted keys from the `api_keys` table are
  decrypted and set on `AuthStorage` first. Server-wide keys from env vars
  are set as fallback.
- **Session continuity:** Uses `SessionManager.continueRecent()` to resume
  the most recent Pi session if one exists in the session directory. Falls back
  to `SessionManager.create()` for new sessions.

### ⚠️ Security Warning

All users share the same OS process. No filesystem or process isolation.
A prompt injection could access other users' data. **Use
ContainerSessionBackend for multi-user deployments.**

## ContainerSessionBackend

Used in production multi-user deployments (`SESSION_BACKEND=container`).

```mermaid
graph TD
    Open["WebSocket 'open' message"]
    Check["Check container map"]
    Hit["Running container → return proxy"]
    AllocPort["Allocate port 9000-9999"]
    Docker["docker run -d<br/><small>--memory 512m --cpus 0.5<br/>--read-only --cap-drop ALL<br/>--security-opt no-new-privileges</small>"]
    Wait["Poll /health until ready<br/><small>timeout: 30s</small>"]
    Proxy["Create proxy AgentSession<br/><small>WebSocket to container</small>"]
    Return["Return SessionHandle"]

    Open --> Check
    Check -->|"running"| Hit --> Return
    Check -->|"none"| AllocPort --> Docker --> Wait --> Proxy --> Return
```

### Container Configuration

Each container runs with strict isolation:

| Flag | Purpose |
|------|---------|
| `--memory 512m` | Memory limit |
| `--cpus 0.5` | CPU limit |
| `--read-only` | Read-only root filesystem |
| `--tmpfs /tmp:size=256m` | Writable temp |
| `--tmpfs /work:size=1g` | Writable workspace |
| `--security-opt no-new-privileges` | No privilege escalation |
| `--cap-drop ALL` | Drop all Linux capabilities |

### Proxy Session

The `ContainerSessionBackend` creates a proxy `AgentSession` that looks like
a normal session to the WebSocket handler but forwards all calls via WebSocket
to the container:

- `subscribe(callback)` → connects a WebSocket to `ws://localhost:<port>`,
  parses incoming JSON events, forwards to callback
- `prompt(text)` → sends `{ type: "prompt", text }` to container
- `abort()` → sends `{ type: "abort" }` to container
- `dispose()` → closes WebSocket, stops container

### PodReaper — `pod-reaper.ts`

Periodic cleanup process that finds orphaned agent containers:

- Runs every 5 minutes (configurable)
- Lists all containers with the `goldilocks-agent` label
- Kills any container running longer than 4 hours
- Kills containers not tracked by the session backend
- Logs each reap operation
