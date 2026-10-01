CREATE TABLE three_class_workset_excluded_comments (
    workset_id TEXT NOT NULL,
    comment_text TEXT NOT NULL,

    PRIMARY KEY (workset_id, comment_text),

    FOREIGN KEY (workset_id)
        REFERENCES three_class_worksets(workset_id)
) STRICT;

PRAGMA user_version = 8;
