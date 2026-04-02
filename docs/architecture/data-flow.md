# Data Flow

## Prompt Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant WS as WebSocket Handler
    participant SM as Session Manager
    participant B as Bridge
    participant Pi as pi --mode rpc

    UI->>WS: {type: "prompt", text: "hello"}
    WS->>SM: prompt(userId, "hello")
    SM->>B: prompt("hello")
    B->>Pi: {"type":"prompt","message":"hello","streamingBehavior":"followUp"}\n

    Pi-->>B: {"type":"response","success":true}\n

    loop Streaming events
        Pi-->>B: message_update (thinking_delta)
        B-->>WS: event
        WS-->>UI: {type: "thinking_delta", delta: "..."}

        Pi-->>B: message_update (text_delta)
        B-->>WS: event
        WS-->>UI: {type: "text_delta", delta: "Hi!"}

        Pi-->>B: message_update (toolcall_start)
        B-->>WS: event
        WS-->>UI: {type: "tool_start", toolName: "write", ...}

        Pi-->>B: message_update (toolcall_delta)
        B-->>WS: event
        WS-->>UI: {type: "tool_update", content: "..."}
    end

    Pi-->>B: tool_execution_end
    B-->>WS: event
    WS-->>UI: {type: "tool_end", result: "...", isError: false}

    Pi-->>B: agent_end
    B-->>WS: event
    WS-->>UI: {type: "agent_end"}

    SM-->>WS: prompt resolved
```

## Model Selection Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant API as REST API
    participant SM as Session Manager
    participant B as Bridge
    participant Pi as pi --mode rpc

    UI->>API: GET /api/models
    API->>SM: getAvailableModels(userId)
    SM->>B: rpc("get_available_models")
    B->>Pi: {"type":"get_available_models"}\n
    Pi-->>B: {"type":"response","data":{"models":[...]}}\n
    B-->>SM: {models: [...]}
    SM-->>API: models
    API-->>UI: {models: [...], providers: [...]}

    UI->>API: POST /api/models/select {modelId}
    API->>SM: setModel(userId, modelId)
    SM->>B: rpc("set_model", {provider, modelId})
    B->>Pi: {"type":"set_model","provider":"anthropic","modelId":"claude..."}\n
    Pi-->>B: response
```

## File Upload Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant API as REST API
    participant PM as Pod Manager
    participant Pod as Agent Pod

    UI->>API: POST /api/files/upload {filename, content(base64)}
    API->>PM: ensurePod(userId)
    PM-->>API: pod ready
    API->>PM: execInPod(userId, ["sh", "-c", "echo ... | base64 -d > file"])
    PM->>Pod: k8s exec
    Pod-->>PM: done
    PM-->>API: done
    API-->>UI: {file: {name, path, size}}
```

## Conversation Lifecycle

```mermaid
graph TD
    New["New Conversation button"] -->|"POST /api/conversations"| DB["SQLite: create row<br/>pi_session_id = null"]
    DB --> Open["User clicks conversation"]
    Open -->|"WS: open {conversationId}"| Check{"pi_session_id<br/>in DB?"}
    Check -->|null| NewSession["Pi: new_session<br/>Pi: get_state → sessionPath<br/>DB: store pi_session_id"]
    Check -->|exists| Switch["Pi: switch_session {sessionPath}"]
    NewSession --> Load["Pi: get_messages → history"]
    Switch --> Load
    Load --> Ready["WS: ready {messages}"]
    Ready --> Chat["User sends prompts"]
```

## Data Persistence

```mermaid
graph LR
    subgraph Host["Host Machine (./data/)"]
        SQLite["goldilocks.db<br/>Users, conversations,<br/>API keys, settings"]
        Homes["homes/{userId}/<br/>Pi sessions, user files,<br/>.pi/ config"]
        Logs["logs/<br/>bridge-*.log<br/>pod-manager.log"]
    end
    subgraph Kind["Kind Node"]
        WebPod["Web App Pod<br/>/data → hostPath"]
        AgentPod["Agent Pod<br/>/home/node → hostPath"]
    end

    SQLite -.->|"hostPath mount"| WebPod
    Homes -.->|"hostPath mount"| AgentPod
```

All data survives pod restarts and cluster rebuilds because it lives on the host filesystem via bind-mounts.
