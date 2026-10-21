-- Server-side sessions so logout and password changes really end a session.
CREATE TABLE sessions (
    id          TEXT    PRIMARY KEY,  -- sha256 of the cookie token
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    user_agent  TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
