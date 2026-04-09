import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG } from '../config.js';
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
    let browserUser: AuthUser | null = null;
    let agentWs: WebSocket | null = null;
    let agentReady = false;
    const pendingMessages: ClientMessage[] = [];

    const flushPending = () => {
      if (!agentWs || agentWs.readyState !== WebSocket.OPEN || !agentReady) return;
      for (const msg of pendingMessages.splice(0)) {
        agentWs.send(JSON.stringify(msg));
      }
    };

    const cleanup = () => {
      if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.close();
      }
      agentWs = null;
      agentReady = false;
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
        try {
          const payload = jwt.verify(msg.token, CONFIG.jwtSecret) as AuthUser;
          browserUser = payload;
          agentWs = new WebSocket(CONFIG.agentServiceWsUrl);

          agentWs.on('open', () => {
            const authMessage: GatewayToAgentMessage = {
              type: 'auth',
              userId: payload.id,
              gatewayToken: CONFIG.agentServiceSharedSecret,
            };
            agentWs?.send(JSON.stringify(authMessage));
          });

          agentWs.on('message', (agentRaw) => {
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
              cleanup();
              return;
            }

            send(browserWs, agentMsg);
          });

          agentWs.on('close', () => {
            agentReady = false;
            if (browserWs.readyState === WebSocket.OPEN) {
              send(browserWs, { type: 'error', error: 'Agent service disconnected' });
            }
          });

          agentWs.on('error', (err) => {
            console.error('Agent service WebSocket error:', err);
            send(browserWs, { type: 'error', error: 'Agent service connection error' });
          });
        } catch {
          send(browserWs, { type: 'auth_fail', error: 'Invalid or expired token' });
        }
        return;
      }

      if (!browserUser) {
        send(browserWs, { type: 'error', error: 'Not authenticated' });
        return;
      }

      if (!agentWs || agentWs.readyState !== WebSocket.OPEN || !agentReady) {
        pendingMessages.push(msg);
        return;
      }

      agentWs.send(JSON.stringify(msg));
    });

    browserWs.on('close', cleanup);
    browserWs.on('error', (err) => {
      console.error('Browser WebSocket error:', err);
      cleanup();
    });
  });
}
