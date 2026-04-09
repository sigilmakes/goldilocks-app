import express, { Response } from 'express';
import { createServer } from 'http';
import { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG } from '../../server/src/config.js';
import { getDb, runMigrations, closeDb } from '../../server/src/db.js';
import { sessionManager, type SessionEvent } from '../../server/src/agent/sessions.js';
import type { ClientMessage, HistoryMessage, ServerMessage } from '../../server/src/shared/types.js';
import {
  gatewayConnectionClosed,
  gatewayConnectionOpened,
  getMetrics,
  internalAuthFailed,
  promptFinished,
  promptStarted,
  websocketErrored,
} from './metrics.js';

interface InternalAuthRequest extends express.Request {
  internalUserId?: string;
}

interface InternalWsState {
  userId: string | null;
  conversationId: string | null;
  unsubscribe: (() => void) | null;
  isProcessing: boolean;
  receivedTextDelta: boolean;
  currentToolCallId: string | null;
  toolCallIdMap: Map<string, string>;
}

interface GatewayAuthMessage {
  type: 'auth';
  userId: string;
  gatewayToken: string;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function mapSessionEvent(event: SessionEvent, ws: WebSocket, state: InternalWsState): void {
  switch (event.type) {
    case 'message_update': {
      const delta = event.assistantMessageEvent as {
        type?: string;
        delta?: string;
        toolCall?: { id?: string; name?: string; arguments?: string };
        partial?: { id?: string; name?: string; arguments?: string };
      } | undefined;
      if (!delta) break;

      if (delta.type === 'text_delta' && delta.delta) {
        state.receivedTextDelta = true;
        send(ws, { type: 'text_delta', delta: delta.delta });
      } else if (delta.type === 'thinking_delta' && delta.delta) {
        send(ws, { type: 'thinking_delta', delta: delta.delta });
      } else if (delta.type === 'toolcall_start') {
        const tc = delta.partial ?? delta.toolCall;
        const toolCallId = tc?.id ?? `tc_${Date.now()}`;
        state.currentToolCallId = toolCallId;
        send(ws, {
          type: 'tool_start',
          toolName: tc?.name ?? 'unknown',
          toolCallId,
          args: {},
        });
      } else if (delta.type === 'toolcall_delta' && delta.delta && state.currentToolCallId) {
        send(ws, {
          type: 'tool_update',
          toolCallId: state.currentToolCallId,
          content: delta.delta,
        });
      } else if (delta.type === 'toolcall_end') {
        const tc = delta.toolCall;
        if (tc && state.currentToolCallId) {
          let args: unknown = {};
          try {
            args = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            args = { raw: tc.arguments };
          }
          send(ws, {
            type: 'tool_start',
            toolName: tc.name ?? 'tool',
            toolCallId: state.currentToolCallId,
            args,
          });
        }
      }
      break;
    }

    case 'message_end': {
      if (!state.receivedTextDelta) {
        const msg = event.message as {
          role?: string;
          content?: Array<{ type: string; text?: string }>;
        } | undefined;
        if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
          const fullText = msg.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text ?? '')
            .join('');
          if (fullText) {
            send(ws, { type: 'text_delta', delta: fullText });
          }
        }
      }
      state.receivedTextDelta = false;
      send(ws, { type: 'message_end' });
      break;
    }

    case 'tool_execution_start': {
      const execId = event.toolCallId as string;
      if (state.currentToolCallId && execId) {
        state.toolCallIdMap.set(execId, state.currentToolCallId);
        state.currentToolCallId = null;
      }
      break;
    }

    case 'tool_execution_end': {
      const execId = event.toolCallId as string;
      const mappedId = state.toolCallIdMap.get(execId) ?? execId;
      state.toolCallIdMap.delete(execId);

      let result = event.result;
      if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown[] }).content)) {
        result = (result as { content: Array<{ type: string; text?: string }> }).content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('');
      }

      send(ws, {
        type: 'tool_end',
        toolName: event.toolName as string,
        toolCallId: mappedId,
        result,
        isError: (event.isError as boolean) ?? false,
      });
      break;
    }

    case 'agent_end':
      send(ws, { type: 'agent_end' });
      break;
  }
}

function normalizeMessages(history: unknown[]): HistoryMessage[] {
  const messages: HistoryMessage[] = [];

  for (const entry of history as any[]) {
    if (entry.role === 'user') {
      const text = typeof entry.content === 'string'
        ? entry.content
        : Array.isArray(entry.content)
          ? entry.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
          : '';
      if (text) messages.push({ role: 'user', text });
      continue;
    }

    if (entry.role === 'assistant' && Array.isArray(entry.content)) {
      const text = entry.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text ?? '')
        .join('');
      const toolCalls = entry.content
        .filter((b: any) => b.type === 'toolCall')
        .map((b: any) => ({
          toolCallId: b.id ?? '',
          toolName: b.name ?? 'tool',
          args: b.arguments
            ? typeof b.arguments === 'string'
              ? (() => { try { return JSON.parse(b.arguments); } catch { return { raw: b.arguments }; } })()
              : b.arguments
            : {},
        }));

      if (text || toolCalls.length > 0) {
        messages.push({ role: 'assistant', text, toolCalls });
      }
      continue;
    }

    if (entry.role === 'toolResult') {
      const prev = messages[messages.length - 1];
      if (prev?.role === 'assistant' && prev.toolCalls) {
        const toolCall = prev.toolCalls.find((candidate) => candidate.toolCallId === entry.toolCallId);
        if (toolCall) {
          toolCall.result = Array.isArray(entry.content)
            ? entry.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
            : typeof entry.content === 'string'
              ? entry.content
              : '';
          toolCall.isError = entry.isError ?? false;
        }
      }
    }
  }

  return messages;
}

function verifyInternalRequest(req: InternalAuthRequest, res: Response, next: express.NextFunction): void {
  const sharedSecret = req.header('x-goldilocks-shared-secret');
  const userId = req.header('x-goldilocks-user');

  if (sharedSecret !== CONFIG.agentServiceSharedSecret || !userId) {
    internalAuthFailed();
    res.status(401).json({ error: 'Unauthorized internal request' });
    return;
  }

  req.internalUserId = userId;
  next();
}

const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agent-service', timestamp: Date.now() });
});

app.get('/api/ready', (_req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ready', dependencies: { db: 'ok' } });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      error: err instanceof Error ? err.message : 'Readiness check failed',
    });
  }
});

app.get('/api/metrics', (_req, res) => {
  res.json(getMetrics());
});

app.get('/internal/models', verifyInternalRequest, async (req: InternalAuthRequest, res: Response) => {
  try {
    const result = await sessionManager.getAvailableModels(req.internalUserId!);
    res.json(result);
  } catch (err) {
    console.error('Internal models fetch failed:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

app.post('/internal/models/select', verifyInternalRequest, async (req: InternalAuthRequest, res: Response) => {
  const { modelId } = req.body as { modelId?: string };
  if (!modelId) {
    res.status(400).json({ error: 'modelId is required' });
    return;
  }

  try {
    await sessionManager.setModel(req.internalUserId!, modelId);
    res.json({ ok: true, modelId });
  } catch (err) {
    console.error('Internal set model failed:', err);
    res.status(500).json({ error: 'Failed to set model' });
  }
});

app.post('/internal/sessions/delete', verifyInternalRequest, async (req: InternalAuthRequest, res: Response) => {
  const { sessionPath } = req.body as { sessionPath?: string };
  if (!sessionPath) {
    res.status(400).json({ error: 'sessionPath is required' });
    return;
  }

  try {
    await sessionManager.deleteConversation(req.internalUserId!, sessionPath);
    res.json({ ok: true });
  } catch (err) {
    console.error('Internal delete session failed:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
  gatewayConnectionOpened();
  const state: InternalWsState = {
    userId: null,
    conversationId: null,
    unsubscribe: null,
    isProcessing: false,
    receivedTextDelta: false,
    currentToolCallId: null,
    toolCallIdMap: new Map(),
  };

  const cleanup = () => {
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.conversationId = null;
  };

  ws.on('message', async (raw) => {
    let msg: ClientMessage | GatewayAuthMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage | GatewayAuthMessage;
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    try {
      if (msg.type === 'auth' && 'gatewayToken' in msg) {
        if (msg.gatewayToken !== CONFIG.agentServiceSharedSecret) {
          internalAuthFailed();
          send(ws, { type: 'auth_fail', error: 'Invalid gateway token' });
          return;
        }
        state.userId = msg.userId;
        send(ws, { type: 'auth_ok', userId: msg.userId });
        return;
      }

      if (!state.userId) {
        send(ws, { type: 'error', error: 'Not authenticated' });
        return;
      }

      switch (msg.type) {
        case 'open': {
          cleanup();
          state.conversationId = msg.conversationId;

          const db = getDb();
          const row = db.prepare(
            'SELECT pi_session_id FROM conversations WHERE id = ? AND user_id = ?'
          ).get(msg.conversationId, state.userId) as { pi_session_id: string | null } | undefined;

          if (!row) {
            send(ws, { type: 'error', error: 'Conversation not found' });
            return;
          }

          const unsubscribe = await sessionManager.subscribe(state.userId, msg.conversationId, (event: SessionEvent) => {
            mapSessionEvent(event, ws, state);
          });
          state.unsubscribe = unsubscribe;

          const sessionPath = await sessionManager.switchSession(state.userId, msg.conversationId, row.pi_session_id);
          if (!row.pi_session_id && sessionPath) {
            db.prepare('UPDATE conversations SET pi_session_id = ? WHERE id = ?').run(sessionPath, msg.conversationId);
          }

          const history = await sessionManager.getMessages(state.userId, msg.conversationId);
          send(ws, { type: 'ready', conversationId: msg.conversationId, messages: normalizeMessages(history) });
          break;
        }

        case 'prompt': {
          if (!state.conversationId) {
            send(ws, { type: 'error', error: 'No active session' });
            return;
          }
          if (state.isProcessing) {
            send(ws, { type: 'error', error: 'Already processing a prompt' });
            return;
          }

          state.isProcessing = true;
          promptStarted();
          const db = getDb();
          const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(state.conversationId) as { title: string } | undefined;
          if (conv?.title === 'New conversation' && msg.text.trim()) {
            const title = msg.text.trim().slice(0, 50).replace(/\s+/g, ' ');
            db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), state.conversationId);
          } else {
            db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), state.conversationId);
          }

          try {
            await sessionManager.prompt(state.userId, state.conversationId, msg.text);
          } finally {
            state.isProcessing = false;
            promptFinished();
          }
          break;
        }

        case 'abort': {
          if (state.isProcessing) {
            await sessionManager.abort(state.userId, state.conversationId);
            state.isProcessing = false;
          }
          break;
        }
      }
    } catch (err) {
      console.error('Agent service WebSocket handler error:', err);
      send(ws, { type: 'error', error: err instanceof Error ? err.message : 'Internal agent-service error' });
    }
  });

  ws.on('close', () => {
    gatewayConnectionClosed();
    cleanup();
  });
  ws.on('error', (err) => {
    console.error('Agent service websocket error:', err);
    websocketErrored();
    cleanup();
  });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down agent service...');

  wss.close();
  await sessionManager.shutdown();
  closeDb();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log('Agent service closed');
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

async function main() {
  runMigrations();
  server.listen(3001, () => {
    console.log('🕸️  Goldilocks agent service running on http://localhost:3001');
  });
}

main().catch((err) => {
  console.error('Failed to start agent service:', err);
  process.exit(1);
});
