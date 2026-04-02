# Architecture

Detailed documentation in sub-pages:

- **[Backend](architecture/backend.md)** — Server modules, Bridge, Pod Manager, REST API
- **[Frontend](architecture/frontend.md)** — React components, Zustand stores, connection hook
- **[Data Flow](architecture/data-flow.md)** — Prompt flow, model selection, file upload, conversation lifecycle
- **[Deployment](architecture/deployment.md)** — Kind + Tilt setup, k8s resources, production notes
- **[Security](architecture/security.md)** — Auth, API key encryption, container isolation, network
- **[WebSocket Sessions](architecture/websocket-sessions.md)** — Connection model, idle timeout, failure handling, multi-tab

## Overview

Goldilocks is a web application that wraps the [Pi coding agent](https://github.com/mariozechner/pi-coding-agent) with a multi-user UI for DFT calculation assistance. The web app is a thin layer — Pi owns all agent logic, sessions, tools, and model selection.

```mermaid
graph TD
    Browser["React Frontend<br/>Chat UI, Structure Viewer, Settings"]
    Express["Express Server<br/>Auth, SQLite metadata, WebSocket handler"]
    Bridge["Bridge (per user)<br/>JSONL stdin/stdout, RPC correlation"]
    PodMgr["Pod Manager<br/>k8s API, pod/volume lifecycle"]
    Pod["Agent Pod (per user)<br/>pi --mode rpc --continue"]

    Browser -->|"WebSocket + REST"| Express
    Express -->|"one Bridge per user"| Bridge
    Bridge -->|"stdin/stdout via k8s exec"| PodMgr
    PodMgr -->|"k8s API"| Pod
```

## Principles

1. **One architecture.** k8s for dev (`kind` + Tilt) and prod. No local-mode alternative.
2. **Pi owns the agent.** Sessions, conversations, tools, models — all managed by Pi. The web app doesn't reimplement any of it.
3. **Bridge pattern.** Communication with Pi is JSONL over stdin/stdout. The Bridge is the only code that talks to Pi.
4. **Pod per user, not per session.** One long-lived pod per user. Pi switches sessions internally via RPC.
5. **Build bottom-up.** Every layer tested against real infrastructure before the next layer goes on.

## Layers

### Frontend (React)

The browser-side application. Connects to the server via WebSocket for streaming chat and REST for metadata (conversations, files, models, settings).

**Owns:** UI rendering, local UI state (which panel is open, textarea content).

**Does not own:** Message history, session state, file storage, model selection logic.

### Express Server

The HTTP/WebSocket server. Handles auth (JWT), serves the REST API, and bridges WebSocket connections to per-user Bridge instances.

**Owns:** Authentication, conversation metadata (SQLite), file proxy, WebSocket fan-out, Bridge lifecycle.

**Does not own:** Agent logic, conversation content, model selection logic.

### Bridge

One instance per user. Communicates with Pi via JSONL over stdin/stdout streams. Handles RPC request/response correlation, event dispatch to subscribers, and structured logging.

```mermaid
sequenceDiagram
    participant WS as WebSocket Handler
    participant B as Bridge
    participant Pi as pi --mode rpc

    WS->>B: rpc("prompt", {message: "hello"})
    B->>Pi: {"id":"abc","type":"prompt","message":"hello"}\n
    Pi-->>B: {"type":"response","id":"abc","success":true}\n
    Pi-->>B: {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hi"}}\n
    B-->>WS: event: text_delta "Hi"
    Pi-->>B: {"type":"message_end",...}\n
    B-->>WS: event: message_end
    Pi-->>B: {"type":"agent_end",...}\n
    B-->>WS: event: agent_end
```

**Owns:** JSONL protocol, RPC correlation with timeouts, event parsing, text delta accumulation, `message_end` fallback text extraction, tool call streaming, file logging.

**Does not own:** k8s, HTTP, WebSocket, auth.

**Key file:** `server/src/agent/bridge.ts`

### Pod Manager

Manages k8s resources. Creates pods and hostPath volumes per user, execs commands into pods, handles idle timeouts and failure backoff.

**Owns:** k8s API calls, pod creation/deletion, hostPath volume provisioning, exec streams, idle timeout eviction, backoff on failures.

**Does not own:** Pi, RPC protocol, conversations.

**Key file:** `server/src/agent/pod-manager.ts`

### Agent Pod

A container running Pi. One per user, long-lived. The pod runs `sleep infinity` and Pi is started via k8s exec (`pi --mode rpc --continue`). The user's home directory is a hostPath volume that persists across pod restarts and cluster rebuilds.

```mermaid
graph LR
    subgraph Pod["Agent Pod"]
        Sleep["CMD: sleep infinity"]
        Pi["pi --mode rpc --continue<br/>(started via k8s exec)"]
    end
    subgraph Volumes
        Home["/home/node<br/>hostPath → ./data/homes/userId/"]
        Tmp["/tmp<br/>emptyDir"]
    end
    Home --> Pod
    Tmp --> Pod
```

**Owns:** Running Pi, user's home directory, all Pi state.

## Data Ownership

| Data | Where | Why |
|------|-------|-----|
| Users, auth | SQLite | Web app owns auth |
| Encrypted API keys | SQLite | Decrypted and passed as env vars on pod creation |
| Conversation metadata | SQLite | Sidebar needs titles/timestamps without hitting the pod |
| Conversation content | Pi session files on hostPath (`~/.pi/`) | Pi owns this |
| User files | hostPath (`~/`) | Pi's working directory |
| Available models | Pi (via `get_available_models` RPC) | Pi knows which keys are set |

## Event Flow

### Tool Call Lifecycle

Tool calls go through two phases: argument generation (streamed by the model) and execution (run by Pi).

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant WS as WebSocket
    participant B as Bridge
    participant Pi as Pi RPC

    Note over Pi: Model generates tool call
    Pi-->>B: message_update (toolcall_start)
    B-->>WS: tool_start {name, id, args:{}}
    WS-->>UI: Show tool card with spinner

    Pi-->>B: message_update (toolcall_delta)
    B-->>WS: tool_update {id, content}
    WS-->>UI: Stream content in card

    Pi-->>B: message_update (toolcall_end)
    B-->>WS: tool_start {name, id, parsedArgs}
    WS-->>UI: Update card header

    Note over Pi: Pi executes the tool
    Pi-->>B: tool_execution_start
    Note over WS: Map execution ID → stream ID

    Pi-->>B: tool_execution_end
    B-->>WS: tool_end {id, result, isError}
    WS-->>UI: Show result in card
```

### Conversation Switching

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant WS as WebSocket
    participant SM as SessionManager
    participant Pi as Pi RPC
    participant DB as SQLite

    UI->>WS: open {conversationId}
    WS->>DB: SELECT pi_session_id
    alt Has pi_session_id
        WS->>SM: switchSession(userId, sessionPath)
        SM->>Pi: switch_session {sessionPath}
    else New conversation
        WS->>SM: switchSession(userId, null)
        SM->>Pi: new_session
        SM->>Pi: get_state
        SM-->>WS: sessionPath
        WS->>DB: UPDATE pi_session_id
    end
    WS->>SM: getMessages(userId)
    SM->>Pi: get_messages
    Pi-->>SM: {messages: [...]}
    SM-->>WS: messages
    WS-->>UI: ready {messages}
    UI->>UI: Render chat history
```

## Security

- **Per-user isolation:** Each user runs in their own k8s pod with their own filesystem.
- **API keys:** Encrypted with AES-256-GCM in SQLite. Decrypted at pod creation, passed as env vars.
- **Non-root containers:** Agent runs as uid 1000. Init container runs as root only to fix hostPath permissions.
- **Dropped capabilities:** All Linux capabilities dropped, privilege escalation disabled.
- **JWT auth:** Tokens expire after 7 days. Secret must be set in production.
- **Path traversal protection:** File operations go through k8s exec, not direct filesystem access.
