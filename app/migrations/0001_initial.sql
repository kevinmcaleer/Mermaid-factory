-- Users and their diagrams.
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT    UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);

CREATE TABLE diagrams (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    source       TEXT    NOT NULL DEFAULT '',
    diagram_type TEXT    NOT NULL DEFAULT 'unknown',
    theme        TEXT    NOT NULL DEFAULT 'default',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE INDEX idx_diagrams_user_updated ON diagrams (user_id, updated_at DESC);
CREATE INDEX idx_diagrams_user_type ON diagrams (user_id, diagram_type);
