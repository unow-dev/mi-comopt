CREATE TABLE imports (
    import_id INTEGER PRIMARY KEY,
    payload_sha256 TEXT NOT NULL UNIQUE,
    imported_at TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    observation_count INTEGER NOT NULL CHECK (observation_count >= 0)
) STRICT;

CREATE TABLE comment_observations (
    observation_id INTEGER PRIMARY KEY,
    import_id INTEGER NOT NULL,
    source_index INTEGER NOT NULL CHECK (source_index >= 0),

    source TEXT NOT NULL CHECK (length(source) > 0),
    post_ref TEXT NOT NULL CHECK (length(post_ref) > 0),
    collected_at TEXT NOT NULL,
    comment_text TEXT NOT NULL,

    UNIQUE (import_id, source_index),

    FOREIGN KEY (import_id)
        REFERENCES imports(import_id)
        ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_comment_observations_post_time
    ON comment_observations(source, post_ref, collected_at);

CREATE INDEX idx_comment_observations_collected_at
    ON comment_observations(collected_at);

PRAGMA user_version = 1;
