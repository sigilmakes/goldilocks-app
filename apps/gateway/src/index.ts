/**
 * Server entry point.
 *
 * Creates the Express app via createApp(), then:
 *   - Sets up WebSocket
 *   - Runs DB migrations
 *   - Starts listening
 *
 * The app is also exported so test/api/helpers/test-server.ts can
 * create isolated test instances.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { CONFIG } from '@goldilocks/config';
import { runMigrations, closeDb } from '@goldilocks/data';
import { setupWebSocket } from './agent/websocket.js';
import { sessionManager } from '@goldilocks/runtime';

// Create app and HTTP server
export const app = createApp();
const server = createServer(app);

// WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');

  wss.close();
  await sessionManager.shutdown();
  closeDb();

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log('Server closed');
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

// Start
async function main() {
  try {
    runMigrations();

    server.listen(CONFIG.port, () => {
      console.log(`🧪 Goldilocks server running on http://localhost:${CONFIG.port}`);
      console.log(`   Environment: ${CONFIG.nodeEnv}`);
      console.log(`   Database: ${CONFIG.dbPath}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
