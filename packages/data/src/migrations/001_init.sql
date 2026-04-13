-- Initial schema for Goldilocks App

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    settings      TEXT DEFAULT '{}'
);

CREATE TABLE api_keys (
    user_id       TEXT NOT NULL,
    provider      TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE conversations (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    title         TEXT DEFAULT 'New conversation',
    model         TEXT,
    provider      TEXT,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE structure_library (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    formula       TEXT NOT NULL,
    source        TEXT,
    source_id     TEXT,
    file_path     TEXT NOT NULL,
    metadata      TEXT DEFAULT '{}',
    created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_structure_library_user ON structure_library(user_id);
