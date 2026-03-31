import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'fs';
import { resolve } from 'path';

import { CONFIG } from './config.js';
import { runMigrations, closeDb } from './db.js';
import authRoutes from './auth/routes.js';

const app = express();
const server = createServer(app);

// WebSocket server (will be used in Phase 2)
const wss = new WebSocketServer({ server, path: '/ws' });

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

// Static file serving for frontend
const frontendDist = resolve(process.cwd(), 'frontend', 'dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(resolve(frontendDist, 'index.html'));
  });
}

// WebSocket handling (placeholder for Phase 2)
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('WS message:', msg);
      
      // Placeholder response
      ws.send(JSON.stringify({ type: 'ack', received: msg.type }));
    } catch (err) {
      console.error('Invalid WS message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
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
