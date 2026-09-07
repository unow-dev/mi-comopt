CREATE TABLE raw_inputs (
    payload_sha256 TEXT PRIMARY KEY
        CHECK (
            length(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
    payload_bytes BLOB NOT NULL,
    byte_length INTEGER NOT NULL
        CHECK (byte_length >= 0 AND byte_length = length(payload_bytes)),
    input_format TEXT NOT NULL CHECK (length(input_format) > 0),
    imported_at TEXT NOT NULL
) STRICT;

INSERT INTO raw_inputs
    (payload_sha256, payload_bytes, byte_length, input_format, imported_at)
SELECT
    old.payload_sha256,
    staged.payload_bytes,
    staged.byte_length,
    'tiktokRawSnapshot-1.0.0',
    old.imported_at
FROM raw_snapshots AS old
JOIN temp.legacy_raw_input_backfill AS staged
  ON staged.payload_sha256 = old.payload_sha256;

CREATE TABLE raw_snapshots_v3 (
    snapshot_id INTEGER PRIMARY KEY,
    platform TEXT NOT NULL CHECK (length(platform) > 0),
    payload_sha256 TEXT NOT NULL,
    snapshot_index INTEGER NOT NULL CHECK (snapshot_index >= 0),
    extracted_at TEXT NOT NULL,
    source_page_url TEXT NOT NULL,
    source_canonical_url TEXT NOT NULL,
    item_source TEXT NOT NULL,
    loaded_count INTEGER NOT NULL,
    reported_count INTEGER NOT NULL,
    coverage_note TEXT NOT NULL,
    UNIQUE (payload_sha256, snapshot_index),
    FOREIGN KEY (payload_sha256)
        REFERENCES raw_inputs(payload_sha256)
) STRICT;

CREATE TABLE snapshot_video_observations_v3 (
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
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots_v3(snapshot_id),
    FOREIGN KEY (video_pk) REFERENCES videos(video_pk),
    FOREIGN KEY (author_pk) REFERENCES authors(author_pk)
) STRICT;

CREATE TABLE snapshot_comment_observations_v3 (
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
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots_v3(snapshot_id),
    FOREIGN KEY (comment_pk) REFERENCES comments(comment_pk)
) STRICT;

INSERT INTO raw_snapshots_v3
    (snapshot_id, platform, payload_sha256, snapshot_index, extracted_at,
     source_page_url, source_canonical_url, item_source, loaded_count,
     reported_count, coverage_note)
SELECT
    snapshot_id,
    platform,
    payload_sha256,
    0,
    extracted_at,
    source_page_url,
    source_canonical_url,
    item_source,
    loaded_count,
    reported_count,
    coverage_note
FROM raw_snapshots;

INSERT INTO snapshot_video_observations_v3
    (snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
     description, published_at, published_date, region_code, duration,
     view_count, like_count, comment_count, share_count, favorite_count)
SELECT
    snapshot_id,
    video_pk,
    author_pk,
    video_id_raw,
    canonical_url,
    title,
    description,
    published_at,
    published_date,
    region_code,
    duration,
    view_count,
    like_count,
    comment_count,
    share_count,
    favorite_count
FROM snapshot_video_observations;

INSERT INTO snapshot_comment_observations_v3
    (observation_id, snapshot_id, source_index, comment_pk, level,
     comment_id_raw, video_id_raw, parent_comment_id_raw, username, handle,
     user_id_raw, comment_text, posted_at, created_at, posted_date,
     like_count, reply_count)
SELECT
    observation_id,
    snapshot_id,
    source_index,
    comment_pk,
    level,
    comment_id_raw,
    video_id_raw,
    parent_comment_id_raw,
    username,
    handle,
    user_id_raw,
    comment_text,
    posted_at,
    created_at,
    posted_date,
    like_count,
    reply_count
FROM snapshot_comment_observations;

DROP TABLE snapshot_comment_observations;
DROP TABLE snapshot_video_observations;
DROP TABLE raw_snapshots;

ALTER TABLE raw_snapshots_v3 RENAME TO raw_snapshots;
ALTER TABLE snapshot_video_observations_v3 RENAME TO snapshot_video_observations;
ALTER TABLE snapshot_comment_observations_v3 RENAME TO snapshot_comment_observations;

CREATE INDEX idx_snapshot_comment_observations_comment
    ON snapshot_comment_observations(comment_pk);

PRAGMA user_version = 3;
