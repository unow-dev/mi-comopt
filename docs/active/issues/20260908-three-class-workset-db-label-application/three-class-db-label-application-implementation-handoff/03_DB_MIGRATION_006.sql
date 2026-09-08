-- Proposed migration: package/db/comment-database/006-three-class-label-application.sql

CREATE TABLE three_class_worksets (
    workset_id TEXT PRIMARY KEY
) STRICT;

CREATE TABLE three_class_workset_snapshots (
    workset_id TEXT NOT NULL,
    snapshot_id INTEGER NOT NULL,

    PRIMARY KEY (workset_id, snapshot_id),

    FOREIGN KEY (workset_id)
        REFERENCES three_class_worksets(workset_id),

    FOREIGN KEY (snapshot_id)
        REFERENCES raw_snapshots(snapshot_id)
) STRICT;

CREATE TABLE snapshot_comment_three_class_labels (
    observation_id INTEGER PRIMARY KEY,

    label TEXT NOT NULL
        CHECK (label IN ('direct_nuisance', 'reactive', 'normal')),

    FOREIGN KEY (observation_id)
        REFERENCES snapshot_comment_observations(observation_id)
) STRICT;

PRAGMA user_version = 6;
