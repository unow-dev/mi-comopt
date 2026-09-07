import {
  COMMENT_BATCH_INPUT_FORMAT,
  parseAndValidateCommentBatchBytes,
} from "./comment-batch-contract.js";

export function mapCommentBatchToSnapshot(payload) {
  return {
    materializationKind: "comment-batch",
    platform: "tiktok",
    loadedCount: payload.length,
    comments: payload.map((item) => ({
      username: item.username,
      handle: item.handle,
      commentText: item.comment,
      postedAt: item.postedAt,
      postedDate: item.postedDate,
    })),
  };
}

export function adaptCommentBatchBytes(bytes) {
  const parsed = parseAndValidateCommentBatchBytes(bytes);
  return {
    payloadBytes: Buffer.from(bytes),
    inputFormat: COMMENT_BATCH_INPUT_FORMAT,
    snapshots: [mapCommentBatchToSnapshot(parsed.payload)],
  };
}
