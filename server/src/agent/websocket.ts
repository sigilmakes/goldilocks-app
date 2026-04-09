import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG } from '../config.js';
import {
  recordAgentConnectionClosed,
  recordAgentConnectionOpened,
  recordAuthAttempt,
  recordBrowserConnectionClosed,
  recordBrowserConnectionOpened,
  recordRelayError,
  recordTtft,
} from './relay-metrics.js';
import type { ClientMessage, ServerMessage } from '../shared/types.js';

interface AuthUser {
  id: string;
  email: string;
}

interface GatewayToAgentMessage {
  type: 'auth';
  userId: string;
  gatewayToken: string;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

// Events that count as "first meaningful output" for TTFT.
// Includes toolcall_start so a model that immediately calls a tool
// doesn't inflate TTFT to the full turn time.
const TTFT_CLEAR_TYPES = new Set(['text_delta', 'thinking_delta', 'tool_start', 'message_end']);

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error('Failed to send WebSocket message:', err);
  }
}

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (browserWs: WebSocket, _req: IncomingMessage) => {
    recordBrowserConnectionOpened();
    let browserUser: AuthUser | null = null;
    let agentWs: WebSocket | null = null;
    let agentReady = false;
    let agentGeneration = 0;
    let currentAgentHeartbeat: ReturnType<typeof setInterval> | null = null;
    const pendingMessages: ClientMessage[] = [];
    let promptSentAt: number | null = null;

    // ── Browser keepalive ──
    // Ping every HEARTBEAT_INTERVAL_MS. If no pong arrives within
    // HEARTBEAT_TIMEOUT_MS since the last pong, terminate the connection.
    let browserLastPong = Date.now();
    const browserHeartbeat = setInterval(() => {
      if (browserWs.readyState !== WebSocket.OPEN) {
        clearInterval(browserHeartbeat);
        return;
      }
      browserWs.ping();

      if (Date.now() - browserLastPong > HEARTBEAT_TIMEOUT_MS) {
        console.warn('Browser WebSocket pong timeout — terminating connection');
        browserWs.terminate();
        clearInterval(browserHeartbeat);
      }
    }, HEARTBEAT_INTERVAL_MS);

    browserWs.on('pong', () => {
      browserLastPong = Date.now();
    });

    const cleanupAgentConnection = () => {
      agentGeneration += 1;
      agentReady = false;
      pendingMessages.length = 0;
      promptSentAt = null;
      if (currentAgentHeartbeat) {
        clearInterval(currentAgentHeartbeat);
        currentAgentHeartbeat = null;
      }
      if (agentWs) {
        const ws = agentWs;
        agentWs = null;
        ws.removeAllListeners();
        recordAgentConnectionClosed();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    };

    const flushPending = () => {
      if (!agentWs || agentWs.readyState !== WebSocket.OPEN || !agentReady) return;
      for (const msg of pendingMessages.splice(0)) {
        agentWs.send(JSON.stringify(msg));
      }
    };

    browserWs.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(browserWs, { type: 'error', error: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'auth') {
        cleanupAgentConnection();

        try {
          const payload = jwt.verify(msg.token, CONFIG.jwtSecret) as AuthUser;
          recordAuthAttempt(true);
          browserUser = payload;
          const connectionGeneration = agentGeneration;
          const nextAgentWs = new WebSocket(CONFIG.agentServiceWsUrl);
          agentWs = nextAgentWs;
          recordAgentConnectionOpened();

          // ── Agent keepalive ──
          // Same pattern: ping at interval, enforce pong timeout.
          let agentLastPong = Date.now();
          const agentHeartbeat = setInterval(() => {
            if (nextAgentWs.readyState !== WebSocket.OPEN) {
              clearInterval(agentHeartbeat);
              return;
            }
            nextAgentWs.ping();

            if (Date.now() - agentLastPong > HEARTBEAT_TIMEOUT_MS) {
              console.warn('Agent service WebSocket pong timeout — closing connection');
              nextAgentWs.terminate();
              clearInterval(agentHeartbeat);
            }
          }, HEARTBEAT_INTERVAL_MS);
          currentAgentHeartbeat = agentHeartbeat;

          nextAgentWs.on('pong', () => {
            agentLastPong = Date.now();
          });

          nextAgentWs.on('open', () => {
            if (connectionGeneration !== agentGeneration) return;
            const authMessage: GatewayToAgentMessage = {
              type: 'auth',
              userId: payload.id,
              gatewayToken: CONFIG.agentServiceSharedSecret,
            };
            nextAgentWs.send(JSON.stringify(authMessage));
          });

          nextAgentWs.on('message', (agentRaw) => {
            if (connectionGeneration !== agentGeneration) return;

            let agentMsg: ServerMessage;
            try {
              agentMsg = JSON.parse(agentRaw.toString()) as ServerMessage;
            } catch {
              send(browserWs, { type: 'error', error: 'Invalid agent-service message' });
              return;
            }

            if (agentMsg.type === 'auth_ok') {
              agentReady = true;
              send(browserWs, { type: 'auth_ok', userId: payload.id });
              flushPending();
              return;
            }

            if (agentMsg.type === 'auth_fail') {
              send(browserWs, agentMsg);
              cleanupAgentConnection();
              return;
            }

            // TTFT: record time from prompt send to first meaningful output
            if (promptSentAt !== null && TTFT_CLEAR_TYPES.has(agentMsg.type)) {
              recordTtft(Date.now() - promptSentAt);
              promptSentAt = null;
            }

            send(browserWs, agentMsg);
          });

          nextAgentWs.on('close', () => {
            clearInterval(agentHeartbeat);
            if (currentAgentHeartbeat === agentHeartbeat) {
              currentAgentHeartbeat = null;
            }
            if (connectionGeneration !== agentGeneration) {
              // Stale socket — counter already decremented by cleanupAgentConnection()
              return;
            }
            // Spontaneous disconnect — counter was not decremented yet
            recordAgentConnectionClosed();
            agentReady = false;
            agentWs = null;
            if (browserWs.readyState === WebSocket.OPEN) {
              send(browserWs, { type: 'error', error: 'Agent service disconnected' });
            }
          });

          nextAgentWs.on('error', (err) => {
            if (connectionGeneration !== agentGeneration) return;
            console.error('Agent service WebSocket error:', err);
            recordRelayError();
            send(browserWs, { type: 'error', error: 'Agent service connection error' });
          });
        } catch {
          recordAuthAttempt(false);
          send(browserWs, { type: 'auth_fail', error: 'Invalid or expired token' });
        }
        return;
      }

      if (!browserUser) {
        send(browserWs, { type: 'error', error: 'Not authenticated' });
        return;
      }

      // Track prompt send time for TTFT
      if (msg.type === 'prompt') {
        promptSentAt = Date.now();
      }

      if (!agentWs || agentWs.readyState !== WebSocket.OPEN || !agentReady) {
        pendingMessages.push(msg);
        return;
      }

      agentWs.send(JSON.stringify(msg));
    });

    browserWs.on('close', () => {
      clearInterval(browserHeartbeat);
      recordBrowserConnectionClosed();
      cleanupAgentConnection();
    });
    browserWs.on('error', (err) => {
      clearInterval(browserHeartbeat);
      console.error('Browser WebSocket error:', err);
      recordRelayError();
      cleanupAgentConnection();
    });
  });
}