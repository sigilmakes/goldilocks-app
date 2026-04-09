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
    let agentGeneration = 0;
    const pendingMessages: ClientMessage[] = [];

    const cleanupAgentConnection = () => {
      agentGeneration += 1;
      agentReady = false;
      pendingMessages.length = 0;
      if (agentWs) {
        const ws = agentWs;
        agentWs = null;
        ws.removeAllListeners();
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
          browserUser = payload;
          const connectionGeneration = agentGeneration;
          const nextAgentWs = new WebSocket(CONFIG.agentServiceWsUrl);
          agentWs = nextAgentWs;

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

            send(browserWs, agentMsg);
          });

          nextAgentWs.on('close', () => {
            if (connectionGeneration !== agentGeneration) return;
            agentReady = false;
            agentWs = null;
            if (browserWs.readyState === WebSocket.OPEN) {
              send(browserWs, { type: 'error', error: 'Agent service disconnected' });
            }
          });

          nextAgentWs.on('error', (err) => {
            if (connectionGeneration !== agentGeneration) return;
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

    browserWs.on('close', cleanupAgentConnection);
    browserWs.on('error', (err) => {
      console.error('Browser WebSocket error:', err);
      cleanupAgentConnection();
    });
  });
}
