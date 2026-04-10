# Data Flow

## Prompt Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant GW as Gateway
    participant AS as Agent Service
    participant SDK as Pi SDK
    participant Pod as Sandbox Pod

    UI->>GW: WS: {type: "prompt", text: "hello"}
    GW->>AS: WS: {type: "prompt", text: "hello"}
    AS->>SDK: prompt(userId, conversationId, "hello")

    loop Streaming events
        SDK-->>AS: text_delta / thinking_delta
        AS-->>GW: WS: {type: "text_delta", delta: "..."}
        GW-->>UI: WS: {type: "text_delta", delta: "..."}

        SDK->>Pod: bash/read/write/edit via k8s exec
        Pod-->>SDK: tool output
        SDK-->>AS: toolcall_start / tool_execution_end
        AS-->>GW: WS: {type: "tool_start" / "tool_end"}
        GW-->>UI: WS: relay
    end

    SDK-->>AS: agent_end
    AS-->>GW: WS: {type: "agent_end"}
    GW-->>UI: WS: {type: "agent_end"}
```

## Model Selection Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant GW as Gateway
    participant AS as Agent Service
    participant SDK as Pi SDK

    UI->>GW: GET /api/models
    GW->>AS: GET /internal/models (x-goldilocks-shared-secret)
    AS->>SDK: getAvailableModels(userId)
    SDK-->>AS: {models: [...]}
    AS-->>GW: {models: [...], providers: [...]}
    GW-->>UI: {models: [...], providers: [...]}

    UI->>GW: POST /api/models/select {modelId}
    GW->>AS: POST /internal/models/select
    AS->>SDK: setModel(userId, modelId)
    AS-->>GW: {ok: true}
    GW-->>UI: {ok: true}
```

## File Upload Flow

```mermaid
sequenceDiagram
    participant UI as Browser
    participant API as Gateway REST
    participant PM as Pod Manager
    participant Pod as Sandbox Pod

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
    Check -->|null| NewSession["Pi SDK: new session<br/>DB: store pi_session_id"]
    Check -->|exists| Switch["Pi SDK: switchSession"]
    NewSession --> Load["Pi SDK: getMessages → history"]
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
    end
    subgraph Kind["Kind Cluster"]
        WebPod["Gateway Pod<br/>/data → hostPath"]
        AgentPod["Agent Service Pod<br/>reads DB via volume"]
        SandboxPod["Sandbox Pod<br/>/home/node → hostPath"]
    end

    SQLite -.->|"hostPath mount"| WebPod
    SQLite -.->|"hostPath mount"| AgentPod
    Homes -.->|"hostPath mount"| SandboxPod
```

All data survives pod restarts and cluster rebuilds because it lives on the host filesystem via bind-mounts.