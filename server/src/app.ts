/**
 * App factory — creates the Express app without starting the server.
 *
 * Used by:
 *   - index.ts: to create + start the production server
 *   - test/api/helpers/test-server.ts: to create an isolated test server
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { resolve } from 'path';

import { CONFIG } from './config.js';
import authRoutes from './auth/routes.js';
import conversationRoutes from './conversations/routes.js';
import fileRoutes from './files/routes.js';
import modelRoutes from './models/routes.js';
import settingsRoutes from './settings/routes.js';
import structureRoutes, { libraryRouter } from './structures/routes.js';
import quickgenRoutes from './quickgen/routes.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors(CONFIG.isProd ? {
    origin: process.env.CORS_ORIGIN ?? false,
    credentials: true,
  } : {}));
  app.use(express.json());

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: CONFIG.isProd ? 60 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api', limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many auth attempts, please try again later' },
  });
  app.use('/api/auth', authLimiter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), version: '0.1.0' });
  });

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/models', modelRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/structures', structureRoutes);
  app.use('/api/library', libraryRouter);
  app.use('/api', quickgenRoutes);

  // Static file serving (frontend dist)
  const frontendDist = resolve(process.cwd(), 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist));

    // SPA fallback — Express 5 requires named params for catch-all
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(resolve(frontendDist, 'index.html'));
    });
  }

  return app;
}
