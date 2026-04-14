/**
 * App factory — creates the Express app without starting the server.
 *
 * Used by:
 *   - index.ts: to create + start the production server
 *   - test/api/helpers/test-server.ts: to create an isolated test server
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet, { type HelmetOptions } from 'helmet';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { CONFIG } from '@goldilocks/config';
import { getDb } from '@goldilocks/data';
import { getRequestToken, verifySignedToken } from './auth/middleware.js';
import { getRelayMetrics } from './agent/relay-metrics.js';
import authRoutes from './auth/routes.js';
import conversationRoutes from './conversations/routes.js';
import fileRoutes from './files/routes.js';
import modelRoutes from './models/routes.js';
import settingsRoutes from './settings/routes.js';
import structureRoutes, { libraryRouter } from './structures/routes.js';
import quickgenRoutes from './quickgen/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAllowedCorsOrigins(): Set<string> {
  const origins = new Set<string>([CONFIG.frontendUrl]);

  if (!CONFIG.isProd) {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
  }

  return origins;
}

function getHelmetOptions(): Readonly<HelmetOptions> {
  const directives: Record<string, string[]> = {
    'connect-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
  };

  if (!CONFIG.isProd) {
    directives['connect-src'] = [
      "'self'",
      ...CONFIG.allowedWebSocketOrigins,
      'ws://localhost:5173',
      'ws://127.0.0.1:5173',
    ];
    directives['script-src'] = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
    directives['style-src'] = ["'self'", "'unsafe-inline'"];
  }

  const options: HelmetOptions = {
    contentSecurityPolicy: {
      useDefaults: true,
      directives,
    },
  };

  if (!CONFIG.isProd) {
    options.crossOriginEmbedderPolicy = false;
  }

  return options;
}

function parseJsonBody(req: Request, res: Response, next: NextFunction): void {
  const jsonParser = req.path.startsWith('/api/files')
    ? express.json({ limit: CONFIG.fileUploadBodyLimit })
    : express.json();

  jsonParser(req, res, next);
}

export function getRateLimitKey(req: Pick<Request, 'headers' | 'ip'> & { cookies?: Record<string, string> }): string {
  const token = getRequestToken(req as Request);

  if (token) {
    try {
      return verifySignedToken(token).id;
    } catch {
      // Invalid or revoked tokens fall back to IP bucketing.
    }
  }

  return ipKeyGenerator(req.ip ?? '127.0.0.1');
}

export function buildReadinessFailureResponse(err: unknown) {
  console.error('Readiness check failed:', err);
  return {
    status: 'degraded' as const,
    error: 'Service unavailable',
  };
}

export function createApp() {
  const app = express();
  const allowedOrigins = getAllowedCorsOrigins();

  // Middleware
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }));
  app.use(helmet(getHelmetOptions()));
  app.use(cookieParser());
  app.use(parseJsonBody);

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: CONFIG.isProd ? 60 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api', limiter);

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getRateLimitKey,
    message: { error: 'Too many auth attempts, please try again later' },
  });
  app.use('/api/auth', authLimiter);

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
    message: { error: 'Too many registration attempts, please try again later' },
  });
  app.use('/api/auth/register', registerLimiter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now(), version: '0.1.0', service: 'gateway' });
  });

  app.get('/api/ready', (_req, res) => {
    try {
      getDb().prepare('SELECT 1').get();
      res.json({ status: 'ready', dependencies: { db: 'ok' } });
    } catch (err) {
      res.status(503).json(buildReadinessFailureResponse(err));
    }
  });

  app.get('/api/metrics', (_req, res) => {
    res.json({ relay: getRelayMetrics() });
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

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
        res.status(413).json({ error: `File upload exceeds limit of ${CONFIG.fileUploadMaxBytes} bytes` });
        return;
      }

      if (err instanceof SyntaxError && 'body' in err) {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }
    }

    next(err);
  });

  // Static file serving (frontend dist)
  const frontendDist = resolve(__dirname, '../../frontend/dist');
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
