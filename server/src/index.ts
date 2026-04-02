import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'fs';
import { resolve } from 'path';

import rateLimit from 'express-rate-limit';
import { CONFIG } from './config.js';
import { runMigrations, closeDb } from './db.js';
import authRoutes from './auth/routes.js';
import conversationRoutes from './conversations/routes.js';
import fileRoutes from './files/routes.js';
import modelRoutes from './models/routes.js';
import settingsRoutes from './settings/routes.js';
import { setupWebSocket } from './agent/websocket.js';
import { sessionManager } from './agent/sessions.js';

const app = express();
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Middleware
app.use(cors(CONFIG.isProd ? {
  origin: process.env.CORS_ORIGIN ?? false,
  credentials: true,
} : {}));
app.use(express.json());

// Rate limiting (§5.9)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: CONFIG.isProd ? 60 : 300, // tighter in production
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// Stricter limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many auth attempts, please try again later' },
});
app.use('/api/auth', authLimiter);

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

// Model routes
app.use('/api/models', modelRoutes);

// Settings routes
app.use('/api/settings', settingsRoutes);



// Static file serving for frontend
const frontendDist = resolve(process.cwd(), 'frontend', 'dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  
  // SPA fallback - serve index.html for all non-API routes
  // Express 5 requires named parameters for catch-all routes
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(resolve(frontendDist, 'index.html'));
  });
}

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  sessionManager.shutdown();
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
