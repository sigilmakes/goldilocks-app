/**
 * Structured audit logger for security events.
 *
 * Writes JSON lines to stdout — the Kubernetes-native pattern where the container
 * runtime captures stdout and a log shipper forwards to a centralized store.
 * Each event is a single JSON object on one line.
 */

import { CONFIG } from '@goldilocks/config';

export type AuditEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.register.success'
  | 'auth.register.failure'
  | 'settings.api-key.store'
  | 'settings.api-key.delete'
  | 'settings.update'
  | 'admin.action';

interface AuditEvent {
  ts: string;
  event: AuditEventType;
  userId?: string;
  attemptedEmail?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function getClientIp(req: { ip?: string; headers: Record<string, string | undefined> }): string {
  // Trust X-Forwarded-For only if behind a known proxy (single hop)
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && CONFIG.isProd) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

/**
 * Emit a structured audit event to stdout.
 */
export function audit(event: AuditEventType, req: { ip?: string; headers: Record<string, string | undefined> }, data?: {
  userId?: string;
  attemptedEmail?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}): void {
  const entry: AuditEvent = {
    ts: formatTimestamp(Date.now()),
    event,
    ip: getClientIp(req),
    ...data,
  };

  // Never log key values — only metadata
  console.log(JSON.stringify(entry));
}

/**
 * Prune expired entries from the failed_auth_attempts table.
 * Called lazily during login attempts.
 */
export function pruneExpiredLockouts(db: { prepare: (sql: string) => { run: (...args: number[]) => void } }): void {
  db.prepare('DELETE FROM failed_auth_attempts WHERE locked_until IS NOT NULL AND locked_until <= ?').run(Date.now());
}

/**
 * Query accounts currently locked or near the lockout threshold.
 * Useful for monitoring dashboards and alerting.
 */
export function getActiveLockouts(db: { prepare: (sql: string) => { all: (...args: number[]) => unknown[] } }): Array<{
  email: string;
  attempts: number;
  lockedUntil: number | null;
  lastAttempt: number;
}> {
  const rows = db.prepare(
    `SELECT email, attempts, locked_until, last_attempt
     FROM failed_auth_attempts
     WHERE locked_until IS NOT NULL AND locked_until > ?
        OR attempts >= 3
     ORDER BY last_attempt DESC`
  ).all(Date.now()) as Array<{ email: string; attempts: number; locked_until: number | null; last_attempt: number }>;

  return rows.map((row) => ({
    email: row.email,
    attempts: row.attempts,
    lockedUntil: row.locked_until,
    lastAttempt: row.last_attempt,
  }));
}