-- Wave 2 auth hardening: JWT revocation denylist

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
ON revoked_tokens (expires_at);
