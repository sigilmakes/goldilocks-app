# Architecture

This document covers the high-level architecture. For focused deep-dives, see:

- [Data Flow](architecture/data-flow.md) — what happens when a user sends a message
- [Frontend](architecture/frontend.md) — component tree, state management, hooks
- [Backend](architecture/backend.md) — Express routes, middleware, database
- [WebSocket & Sessions](architecture/websocket-sessions.md) — real-time protocol, session backends
- [Security](architecture/security.md) — auth, sandboxing, path traversal, limitations
- [Deployment](architecture/deployment.md) — Docker, Kubernetes, container images

## System Overview

```mermaid
graph TB
    subgraph Browser
        UI["Three-Panel Layout<br/><small>Sidebar · Chat · Context</small>"]
        Stores["Zustand Stores<br/><small>auth · chat · conversations<br/>context · files · models · settings · toast</small>"]
        WS["useAgent hook<br/><small>WebSocket client</small>"]

        UI --> Stores
        UI --> WS
    end

    Stores -->|"fetch /api/*"| Express
    WS -->|"ws:// /ws"| WSS

    subgraph Server["Node.js Server (Express 5)"]
        Express["REST Routes<br/><small>auth · conversations · files<br/>models · settings · structures · quickgen</small>"]
        WSS["WebSocket Server"]
        DB[("SQLite<br/><small>WAL mode</small>")]
        CLI["goldilocks CLI<br/><small>ML predict · QE generate · search</small>"]

        Express --> DB
        Express --> CLI
        WSS --> SessionMgr["Session Manager"]
    end

    SessionMgr --> Local["LocalSessionBackend<br/><small>in-process Pi SDK</small>"]
    SessionMgr --> Container["ContainerSessionBackend<br/><small>Docker per user</small>"]

    Local --> PiSDK["Pi SDK AgentSession"]
    Container --> AgentPod["Agent Container<br/><small>isolated Pi SDK</small>"]
```

## The Request Path (End to End)

Here's exactly what happens when a user types "Predict k-points for BaTiO3"
and hits Enter:

```mermaid
sequenceDiagram
    participant User
    participant ChatPanel
    participant ChatStore as useChatStore
    participant useAgent
    participant WSServer as websocket.ts
    participant Session as AgentSession
    participant Tool as goldilocks CLI
    participant ToolCallCard

    User->>ChatPanel: types message, presses Enter
    ChatPanel->>ChatPanel: handleSend() validates input
    ChatPanel->>useAgent: send("Predict k-points for BaTiO3")
    useAgent->>ChatStore: addUserMessage(text)
    useAgent->>ChatStore: startAssistantMessage()
    useAgent->>WSServer: { type: "prompt", text }

    WSServer->>Session: session.prompt(text)

    Session-->>WSServer: thinking_delta events
    WSServer-->>useAgent: { type: "thinking_delta", delta }
    useAgent-->>ChatStore: appendThinkingDelta(delta)

    Session-->>WSServer: text_delta events
    WSServer-->>useAgent: { type: "text_delta", delta }
    useAgent-->>ChatStore: appendTextDelta(delta)

    Session-->>WSServer: tool_execution_start (bash)
    WSServer-->>useAgent: { type: "tool_start", toolName: "bash", args }
    useAgent-->>ChatStore: startToolCall(id, "bash", args)

    Note over Session,Tool: Agent runs: ./goldilocks predict kpoints BaTiO3.cif --json

    Session-->>WSServer: tool_execution_end
    WSServer-->>useAgent: { type: "tool_end", result: {...} }
    useAgent-->>ChatStore: endToolCall(id, result)

    Session-->>WSServer: message_end → agent_end
    WSServer-->>useAgent: { type: "agent_end" }
    useAgent-->>ChatStore: endAgent()

    ChatStore-->>ChatPanel: re-render with new message
    ChatPanel->>ToolCallCard: renders tool result
    ToolCallCard->>ToolCallCard: getGoldilocksCommand() → "predict"
    ToolCallCard->>ToolCallCard: parsePredictionResult() → PredictionResult
    ToolCallCard-->>User: renders KPointsResultCard
```

1. `ChatPanel.handleSend()` calls `useAgent.send(text)` which pushes a user message to the store and sends `{ type: "prompt", text }` over the WebSocket.

2. `websocket.ts` receives the message, calls `session.prompt(text)` on the Pi SDK `AgentSession`.

3. Pi SDK streams events back — `text_delta`, `thinking_delta`, `tool_start`/`tool_end`, `message_end`, `agent_end`. The `mapAgentEvent()` function in `websocket.ts` translates Pi SDK event types to our `ServerMessage` union.

4. `useAgent` receives each WebSocket message and dispatches to `useChatStore` actions (`appendTextDelta`, `startToolCall`, `endToolCall`, `endMessage`, `endAgent`).

5. `ChatPanel` re-renders. For tool calls, `ToolCallCard` checks if it's a `bash` call to the `goldilocks` CLI. If `getGoldilocksCommand(args)` returns `"predict"`, it parses the result with `parsePredictionResult()` and renders a `KPointsResultCard`.

6. `endAgent()` finalizes: any buffered text/thinking/tools are flushed into a `ChatMessage`, persisted to `localStorage`, and `isStreaming` is set to `false`.
