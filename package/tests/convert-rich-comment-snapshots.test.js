import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  convertRichCommentSnapshotFile,
  convertRichSnapshotsToCommentBatch,
} from "../scripts/convert-rich-comment-snapshots.mjs";

test("rich snapshots are flattened into strict five-field comments in source order", () => {
  const payload = [
    {
      comments: {
        items: [
          {
            username: " user ",
            handle: "@one",
            comment: "本文",
            postedAt: "opaque time",
            postedDate: "2026/unknown",
            commentId: "ignored-id",
          },
        ],
      },
    },
    {
      comments: {
        items: [
          {
            username: "second",
            handle: "@two",
            comment: "same text",
            postedAt: "later",
            postedDate: "",
          },
          {
            username: "third",
            handle: "@three",
            comment: "same text",
            postedAt: "later",
            postedDate: "",
          },
        ],
      },
    },
  ];

  assert.deepEqual(convertRichSnapshotsToCommentBatch(payload), [
    { username: " user ", handle: "@one", comment: "本文", postedAt: "opaque time", postedDate: "2026/unknown" },
    { username: "second", handle: "@two", comment: "same text", postedAt: "later", postedDate: "" },
    { username: "third", handle: "@three", comment: "same text", postedAt: "later", postedDate: "" },
  ]);
});

test("conversion rejects missing or non-string required fields", () => {
  assert.throws(
    () => convertRichSnapshotsToCommentBatch([{ comments: { items: [{ username: "user" }] } }]),
    /handle must be a string/,
  );
  assert.throws(
    () => convertRichSnapshotsToCommentBatch([{ comments: { items: [{
      username: "user",
      handle: "@user",
      comment: "text",
      postedAt: null,
      postedDate: "2026-09-20",
    }] } }]),
    /postedAt must be a string/,
  );
});

test("file conversion writes a validated JSON artifact and refuses same-path conversion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "convert-rich-comment-snapshots-test-"));
  try {
    const inputPath = path.join(root, "rich.json");
    const outputPath = path.join(root, "comment-batch.json");
    await writeFile(inputPath, JSON.stringify([{ comments: { items: [{
      username: "user",
      handle: "@user",
      comment: "comment",
      postedAt: "time",
      postedDate: "2026-09-20",
    }] } }]));

    const result = await convertRichCommentSnapshotFile({ inputPath, outputPath });
    assert.equal(result.outputCommentCount, 1);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), [{
      username: "user",
      handle: "@user",
      comment: "comment",
      postedAt: "time",
      postedDate: "2026-09-20",
    }]);
    await assert.rejects(
      () => convertRichCommentSnapshotFile({ inputPath, outputPath }),
      /already exists/,
    );
    await assert.rejects(
      () => convertRichCommentSnapshotFile({ inputPath, outputPath: inputPath }),
      /different paths/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
