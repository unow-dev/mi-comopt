CREATE TABLE raw_snapshots_v5 (
    snapshot_id INTEGER PRIMARY KEY,
    materialization_kind TEXT NOT NULL
        CHECK (materialization_kind IN ('rich-snapshot', 'comment-batch')),
    platform TEXT NOT NULL CHECK (length(platform) > 0),
    payload_sha256 TEXT NOT NULL,
    snapshot_index INTEGER NOT NULL CHECK (snapshot_index >= 0),
    extracted_at TEXT,
    source_page_url TEXT,
    source_canonical_url TEXT,
    item_source TEXT,
    loaded_count INTEGER NOT NULL CHECK (loaded_count >= 0),
    reported_count INTEGER,
    coverage_note TEXT,
    UNIQUE (payload_sha256, snapshot_index),
    CHECK (
        (materialization_kind = 'rich-snapshot'
         AND extracted_at IS NOT NULL
         AND source_page_url IS NOT NULL
         AND source_canonical_url IS NOT NULL
         AND item_source IS NOT NULL
         AND coverage_note IS NOT NULL)
        OR
        (materialization_kind = 'comment-batch'
         AND extracted_at IS NULL
         AND source_page_url IS NULL
         AND source_canonical_url IS NULL
         AND item_source IS NULL
         AND reported_count IS NULL
         AND coverage_note IS NULL)
    ),
    FOREIGN KEY (payload_sha256) REFERENCES raw_inputs(payload_sha256)
) STRICT;

CREATE TABLE snapshot_video_observations_v5 (
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
    duration REAL,
    view_count INTEGER,
    like_count INTEGER,
    comment_count INTEGER,
    share_count INTEGER,
    favorite_count INTEGER,
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots_v5(snapshot_id),
    FOREIGN KEY (video_pk) REFERENCES videos(video_pk),
    FOREIGN KEY (author_pk) REFERENCES authors(author_pk)
) STRICT;

CREATE TABLE snapshot_comment_observations_v5 (
    observation_id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,
    source_index INTEGER NOT NULL CHECK (source_index >= 0),
    comment_pk INTEGER,
    level INTEGER,
    comment_id_raw TEXT,
    video_id_raw TEXT,
    parent_comment_id_raw TEXT,
    username TEXT NOT NULL,
    handle TEXT NOT NULL,
    user_id_raw TEXT,
    comment_text TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    created_at TEXT,
    posted_date TEXT NOT NULL,
    like_count INTEGER,
    reply_count INTEGER,
    UNIQUE (snapshot_id, source_index),
    CHECK (
        (level IS NULL
         AND comment_id_raw IS NULL
         AND video_id_raw IS NULL
         AND parent_comment_id_raw IS NULL
         AND user_id_raw IS NULL
         AND created_at IS NULL)
        OR
        (level IS NOT NULL
         AND comment_id_raw IS NOT NULL
         AND video_id_raw IS NOT NULL
         AND parent_comment_id_raw IS NOT NULL
         AND user_id_raw IS NOT NULL
         AND created_at IS NOT NULL)
    ),
    FOREIGN KEY (snapshot_id) REFERENCES raw_snapshots_v5(snapshot_id),
    FOREIGN KEY (comment_pk) REFERENCES comments(comment_pk)
) STRICT;

INSERT INTO raw_snapshots_v5
    (snapshot_id, materialization_kind, platform, payload_sha256, snapshot_index,
     extracted_at, source_page_url, source_canonical_url, item_source,
     loaded_count, reported_count, coverage_note)
SELECT snapshot_id, 'rich-snapshot', platform, payload_sha256, snapshot_index,
       extracted_at, source_page_url, source_canonical_url, item_source,
       loaded_count, reported_count, coverage_note
FROM raw_snapshots;

INSERT INTO snapshot_video_observations_v5
    (snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
     description, published_at, published_date, region_code, duration,
     view_count, like_count, comment_count, share_count, favorite_count)
SELECT snapshot_id, video_pk, author_pk, video_id_raw, canonical_url, title,
       description, published_at, published_date, region_code, duration,
       view_count, like_count, comment_count, share_count, favorite_count
FROM snapshot_video_observations;

INSERT INTO snapshot_comment_observations_v5
    (observation_id, snapshot_id, source_index, comment_pk, level,
     comment_id_raw, video_id_raw, parent_comment_id_raw, username, handle,
     user_id_raw, comment_text, posted_at, created_at, posted_date,
     like_count, reply_count)
SELECT observation_id, snapshot_id, source_index, comment_pk, level,
       comment_id_raw, video_id_raw, parent_comment_id_raw, username, handle,
       user_id_raw, comment_text, posted_at, created_at, posted_date,
       like_count, reply_count
FROM snapshot_comment_observations;

DROP TABLE snapshot_comment_observations;
DROP TABLE snapshot_video_observations;
DROP TABLE raw_snapshots;

ALTER TABLE raw_snapshots_v5 RENAME TO raw_snapshots;
ALTER TABLE snapshot_video_observations_v5 RENAME TO snapshot_video_observations;
ALTER TABLE snapshot_comment_observations_v5 RENAME TO snapshot_comment_observations;

CREATE INDEX idx_snapshot_comment_observations_comment
    ON snapshot_comment_observations(comment_pk);

PRAGMA user_version = 5;
