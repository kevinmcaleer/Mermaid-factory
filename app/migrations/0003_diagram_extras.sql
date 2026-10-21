-- Diagram config, tags, share links and version history.
ALTER TABLE diagrams ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE diagrams ADD COLUMN share_token TEXT;

CREATE UNIQUE INDEX idx_diagrams_share_token ON diagrams (share_token)
    WHERE share_token IS NOT NULL;

CREATE TABLE diagram_tags (
    diagram_id INTEGER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    tag        TEXT    NOT NULL COLLATE NOCASE,
    PRIMARY KEY (diagram_id, tag)
);

CREATE INDEX idx_diagram_tags_tag ON diagram_tags (tag);

CREATE TABLE diagram_versions (
    id         INTEGER PRIMARY KEY,
    diagram_id INTEGER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    theme      TEXT    NOT NULL,
    config     TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL
);

CREATE INDEX idx_diagram_versions_diagram ON diagram_versions (diagram_id, id DESC);
