import type express from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { CONFIG } from '@goldilocks/config';
import { getDb } from '@goldilocks/data';

export interface InternalUserClaims extends JwtPayload {
  id: string;
  email: string;
  jti: string;
}

export interface InternalHttpAuthResult {
  ok: true;
  userId: string;
  claims: InternalUserClaims;
}

export interface InternalWsAuthResult extends InternalHttpAuthResult {}

function assertValidClaims(payload: string | JwtPayload): InternalUserClaims {
  if (typeof payload === 'string') {
    throw new Error('Invalid token payload');
  }

  if (typeof payload.id !== 'string' || typeof payload.email !== 'string' || typeof payload.jti !== 'string') {
    throw new Error('Invalid token payload');
  }

  if (typeof payload.exp !== 'number') {
    throw new Error('Token missing expiry');
  }

  return payload as InternalUserClaims;
}

function pruneExpiredRevocations(): void {
  getDb().prepare('DELETE FROM revoked_tokens WHERE expires_at <= ?').run(Date.now());
}

function isRevoked(jti: string): boolean {
  pruneExpiredRevocations();
  const row = getDb().prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
  return Boolean(row);
}

function getBearerToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

export function verifyInternalUserToken(token: string): InternalUserClaims {
  const payload = jwt.verify(token, CONFIG.jwtSecret, {
    issuer: CONFIG.jwtIssuer,
    audience: CONFIG.jwtAudience,
  });

  const claims = assertValidClaims(payload);
  if (isRevoked(claims.jti)) {
    throw new Error('Token revoked');
  }

  return claims;
}

export function authenticateInternalHttpRequest(req: express.Request): InternalHttpAuthResult {
  const sharedSecret = req.header('x-goldilocks-shared-secret');
  if (sharedSecret !== CONFIG.agentServiceSharedSecret) {
    throw new Error('Invalid shared secret');
  }

  const token = getBearerToken(req.header('authorization'));
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const claims = verifyInternalUserToken(token);
  return {
    ok: true,
    userId: claims.id,
    claims,
  };
}

export function authenticateInternalWebSocketMessage(message: { gatewayToken?: string; userToken?: string }): InternalWsAuthResult {
  if (message.gatewayToken !== CONFIG.agentServiceSharedSecret) {
    throw new Error('Invalid gateway token');
  }

  if (!message.userToken) {
    throw new Error('Missing user token');
  }

  const claims = verifyInternalUserToken(message.userToken);
  return {
    ok: true,
    userId: claims.id,
    claims,
  };
}
