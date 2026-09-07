CREATE TABLE raw_snapshots (
    snapshot_id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL CHECK (length(platform) > 0),
    raw_schema_version INTEGER NOT NULL CHECK (raw_schema_version = 1),
    payload_sha256 TEXT NOT NULL UNIQUE CHECK (length(payload_sha256) = 64),
    raw_relpath TEXT NOT NULL UNIQUE CHECK (length(raw_relpath) > 0),
    extracted_at TEXT NOT NULL,
    source_page_url TEXT NOT NULL,
    source_canonical_url TEXT NOT NULL,
    item_source TEXT NOT NULL,
    loaded_count INTEGER NOT NULL,
    reported_count INTEGER NOT NULL,
    coverage_note TEXT NOT NULL,
    imported_at TEXT NOT NULL
) STRICT;

CREATE TABLE videos (
    video_pk INTEGER PRIMARY KEY,
    platform TEXT NOT NULL CHECK (length(platform) > 0),
    external_video_id TEXT NOT NULL CHECK (length(external_video_id) > 0),
    UNIQUE (platform, external_video_id)
) STRICT;

CREATE TABLE authors (
    author_pk INTEGER PRIMARY KEY,
    platform TEXT NOT NULL CHECK (length(platform) > 0),
    external_author_id TEXT NOT NULL CHECK (length(external_author_id) > 0),
    UNIQUE (platform, external_author_id)
) STRICT;

CREATE TABLE comments (
    comment_pk INTEGER PRIMARY KEY,
    video_pk INTEGER NOT NULL,
    external_comment_id TEXT NOT NULL CHECK (length(external_comment_id) > 0),
    UNIQUE (video_pk, external_comment_id),
    FOREIGN KEY (video_pk) REFERENCES videos(video_pk)
) STRICT;

CREATE TABLE snapshot_video_observations (
    snapshot_id INTEGER PRIMARY KEY,
    video_pk INTEGER,
    author_pk INTEGER,
    video_id_raw TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    published_at TEXT NOT NULL,
    published_date TEXT NOT NULL,
    region_code TEXT NOT NULL,
    duration REAL NOT NULL,
    view_count INTEGER NOT NULL,
    like_count INTEGER NOT NULL,
    comment_count INTEGER NOT NULL,
    share_count INTEGER NOT NULL,
    favorite_count INTEGER NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots(snapshot_id),
    FOREIGN KEY (video_pk) REFERENCES videos(video_pk),
    FOREIGN KEY (author_pk) REFERENCES authors(author_pk)
) STRICT;

CREATE TABLE snapshot_comment_observations (
    observation_id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,
    source_index INTEGER NOT NULL CHECK (source_index >= 0),
    comment_pk INTEGER,
    level INTEGER NOT NULL,
    comment_id_raw TEXT NOT NULL,
    video_id_raw TEXT NOT NULL,
    parent_comment_id_raw TEXT NOT NULL,
    username TEXT NOT NULL,
    handle TEXT NOT NULL,
    user_id_raw TEXT NOT NULL,
    comment_text TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    posted_date TEXT NOT NULL,
    like_count INTEGER,
    reply_count INTEGER,
    UNIQUE (snapshot_id, source_index),
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots(snapshot_id),
    FOREIGN KEY (comment_pk) REFERENCES comments(comment_pk)
) STRICT;

CREATE INDEX idx_snapshot_comment_observations_comment
    ON snapshot_comment_observations(comment_pk);

PRAGMA user_version = 2;
