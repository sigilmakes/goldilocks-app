-- Wave 4 P8: Per-user key derivation salt and key versioning

ALTER TABLE users ADD COLUMN key_salt TEXT;

ALTER TABLE api_keys ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;