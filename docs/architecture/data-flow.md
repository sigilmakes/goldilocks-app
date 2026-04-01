# Data Flow

How data moves through the system for each major user action.

## Authentication

```mermaid
sequenceDiagram
    participant LoginForm
    participant AuthStore as useAuthStore
    participant API as api/client.ts
    participant Server as auth/routes.ts
    participant DB as SQLite

    LoginForm->>AuthStore: login(email, password)
    AuthStore->>API: api.post('/auth/login', { email, password })
    API->>Server: POST /api/auth/login
    Server->>DB: SELECT * FROM users WHERE email = ?
    Server->>Server: bcrypt.compare(password, hash)
    Server->>Server: generateToken({ id, email })
    Server-->>API: { token, user }
    API-->>AuthStore: set({ token, user, isAuthenticated: true })
    Note over AuthStore: token persisted to localStorage via zustand/persist
    AuthStore-->>LoginForm: navigate to /workspace
```

The `api/client.ts` module automatically injects the Bearer token from
`useAuthStore.getState().token` into every subsequent request.

## Chat Message Flow

```mermaid
graph LR
    subgraph "User Action"
        Input["ChatPanel textarea"]
    end

    subgraph "Frontend State"
        ChatStore["useChatStore"]
        LocalStorage["localStorage<br/><small>goldilocks-chat-history</small>"]
    end

    subgraph "Network"
        WS["WebSocket"]
    end

    subgraph "Server"
        WSHandler["websocket.ts"]
        PiSDK["Pi SDK"]
    end

    Input -->|"send(text)"| ChatStore
    ChatStore -->|"addUserMessage"| LocalStorage
    Input -->|"WS prompt"| WS
    WS --> WSHandler
    WSHandler --> PiSDK
    PiSDK -->|"events"| WSHandler
    WSHandler -->|"WS messages"| WS
    WS -->|"dispatch"| ChatStore
    ChatStore -->|"endMessage"| LocalStorage
```

**Key detail:** Messages are stored in `localStorage` only, not in the server
database. The `conversations` table stores metadata (title, model, timestamps)
but not message content. This means clearing browser data loses chat history.

### Store Actions During Streaming

| WebSocket Event | Store Action | State Change |
|----------------|--------------|--------------|
| (user sends) | `addUserMessage(text)` | Appends user message, persists to localStorage |
| (user sends) | `startAssistantMessage()` | Sets `isStreaming=true`, clears `currentText`/`currentThinking`/`activeTools` |
| `text_delta` | `appendTextDelta(delta)` | Concatenates to `currentText` |
| `thinking_delta` | `appendThinkingDelta(delta)` | Concatenates to `currentThinking` |
| `tool_start` | `startToolCall(id, name, args)` | Adds to `activeTools` Map |
| `tool_end` | `endToolCall(id, result, isError)` | Updates tool in `activeTools` Map |
| `message_end` | `endMessage()` | Flushes `currentText`/`currentThinking`/`activeTools` into a `ChatMessage`, appends to `messages[]`, persists to localStorage |
| `agent_end` | `endAgent()` | Calls `endMessage()` if pending, sets `isStreaming=false` |

## File Upload Flow

```mermaid
sequenceDiagram
    participant User
    participant ChatPanel
    participant FilesStore as useFilesStore
    participant Server as files/routes.ts
    participant FS as Filesystem

    User->>ChatPanel: clicks paperclip, selects file
    ChatPanel->>ChatPanel: FileReader.readAsDataURL(file)
    ChatPanel->>Server: POST /api/conversations/:id/upload<br/>{ filename, content: base64 }
    Server->>Server: validate extension, check size ≤ 10MB
    Server->>Server: sanitize filename (basename, strip special chars)
    Server->>Server: validateWorkspacePath() — path traversal check
    Server->>FS: write to WORKSPACE_ROOT/<userId>/<convId>/workspace/<filename>
    Server-->>ChatPanel: { file: { name, path, size } }
    ChatPanel->>ChatPanel: send("I've uploaded filename.cif")
    ChatPanel->>FilesStore: fetch(conversationId) — refresh file list
```

Files are uploaded as **JSON with base64 content**, not multipart/form-data.
The `workspace-guard.ts` module validates that the resolved path stays within
the workspace directory (`resolve(basePath, filename).startsWith(basePath)`).

## Quick Generate Flow (No Agent)

```mermaid
sequenceDiagram
    participant ContextPanel as ContextPanel<br/>(ParametersTab)
    participant API as api/client.ts
    participant Server as quickgen/routes.ts
    participant CLI as goldilocks CLI
    participant FS as Filesystem

    ContextPanel->>API: api.post('/predict', { structurePath, conversationId, model })
    API->>Server: POST /api/predict
    Server->>Server: validateWorkspacePath(structurePath)
    Server->>CLI: execFile('goldilocks', ['predict', ...], { timeout: 60s })
    CLI-->>Server: JSON prediction result
    Server-->>API: { prediction: { kdist_median, k_grid, ... } }
    API-->>ContextPanel: update PredictionSummary

    ContextPanel->>API: api.post('/generate', { structurePath, conversationId, functional })
    API->>Server: POST /api/generate
    Server->>CLI: execFile('goldilocks', ['generate', ...], { timeout: 60s })
    CLI->>FS: writes .in file to workspace
    CLI-->>Server: { filename, content }
    Server-->>API: { filename, content, downloadUrl }
    API-->>ContextPanel: show generated file
```

This bypasses the AI agent entirely. The ContextPanel's "Parameters" tab calls
REST endpoints that invoke the `goldilocks` CLI directly via `child_process.execFile()`.
