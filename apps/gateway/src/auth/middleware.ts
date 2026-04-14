import { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { getDb } from '@goldilocks/data';
import { CONFIG } from '@goldilocks/config';

export interface AuthUser {
  id: string;
  email: string;
  jti: string;
}

export interface AuthTokenPayload extends JwtPayload {
  id: string;
  email: string;
  jti: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  authToken?: string;
  authClaims?: AuthTokenPayload;
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: CONFIG.isProd,
  path: '/',
  maxAge: CONFIG.sessionCookieMaxAgeMs,
};

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) {
        return cookies;
      }

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getTokenFromAuthorizationHeader(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function assertValidPayload(payload: string | JwtPayload): AuthTokenPayload {
  if (typeof payload === 'string') {
    throw new Error('Invalid token payload');
  }

  if (typeof payload.id !== 'string' || typeof payload.email !== 'string' || typeof payload.jti !== 'string') {
    throw new Error('Invalid token payload');
  }

  if (typeof payload.exp !== 'number') {
    throw new Error('Token missing expiry');
  }

  return payload as AuthTokenPayload;
}

function pruneExpiredRevocations(): void {
  getDb().prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(Date.now());
}

function isTokenRevoked(jti: string): boolean {
  pruneExpiredRevocations();
  const row = getDb().prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
  return Boolean(row);
}

export function getTokenFromCookieHeader(cookieHeader?: string): string | null {
  return parseCookies(cookieHeader)[CONFIG.sessionCookieName] ?? null;
}

export function getRequestToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[CONFIG.sessionCookieName]
    ?? getTokenFromCookieHeader(req.headers.cookie);

  return cookieToken ?? getTokenFromAuthorizationHeader(req.headers.authorization);
}

export function verifySignedToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, CONFIG.jwtSecret, {
    issuer: CONFIG.jwtIssuer,
    audience: CONFIG.jwtAudience,
  });

  const claims = assertValidPayload(payload);
  if (isTokenRevoked(claims.jti)) {
    throw new Error('Token revoked');
  }

  return claims;
}

export function revokeToken(claims: { jti: string; exp: number }): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO revoked_tokens (jti, expires_at)
    VALUES (?, ?)
  `).run(claims.jti, claims.exp * 1000);
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = getRequestToken(req);

  if (!token) {
    res.status(401).json({ error: 'Missing session cookie or bearer token' });
    return;
  }

  try {
    const claims = verifySignedToken(token);
    req.authToken = token;
    req.authClaims = claims;
    req.user = {
      id: claims.id,
      email: claims.email,
      jti: claims.jti,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid, expired, or revoked token' });
  }
}

export function generateToken(user: Pick<AuthUser, 'id' | 'email'>): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      jti: uuid(),
    },
    CONFIG.jwtSecret,
    {
      expiresIn: CONFIG.jwtExpiresIn as SignOptions['expiresIn'],
      issuer: CONFIG.jwtIssuer,
      audience: CONFIG.jwtAudience,
    }
  );
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(CONFIG.sessionCookieName, token, SESSION_COOKIE_OPTIONS);
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(CONFIG.sessionCookieName, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: undefined,
  });
}
