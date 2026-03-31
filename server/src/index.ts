import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'fs';
import { resolve } from 'path';

import { CONFIG } from './config.js';
import { runMigrations, closeDb } from './db.js';
import authRoutes from './auth/routes.js';
import conversationRoutes from './conversations/routes.js';
import fileRoutes from './files/routes.js';
import { setupWebSocket } from './agent/websocket.js';
import { sessionCache } from './agent/sessions.js';

const app = express();
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    version: '0.1.0'
  });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Conversation routes
app.use('/api/conversations', conversationRoutes);

// File routes (nested under conversations)
app.use('/api/conversations', fileRoutes);

// Static file serving for frontend
const frontendDist = resolve(process.cwd(), 'frontend', 'dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(resolve(frontendDist, 'index.html'));
  });
}

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  sessionCache.shutdown();
  closeDb();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function main() {
  try {
    // Run database migrations
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
