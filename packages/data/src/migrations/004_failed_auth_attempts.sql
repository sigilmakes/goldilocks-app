-- Wave 3 auth hardening: account lockout tracking

CREATE TABLE IF NOT EXISTS failed_auth_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_attempt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_failed_auth_attempts_locked_until
ON failed_auth_attempts (locked_until);
