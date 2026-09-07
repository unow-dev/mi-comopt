import {
  getEffectiveVideoId,
  NEW_COMMENTS_WRAPPER_INPUT_FORMAT,
  parseAndValidateNewCommentsWrapperBytes,
} from "./new-comments-wrapper-contract.js";

function mapItemToSnapshotDto(item) {
  return {
    platform: "tiktok",
    extractedAt: item.extractedAt,
    sourcePageUrl: item.source.pageUrl,
    sourceCanonicalUrl: item.source.canonicalUrl,
    itemSource: item.source.itemSource,
    loadedCount: item.comments.loadedCount,
    reportedCount: item.comments.reportedCount,
    coverageNote: item.comments.note,
    video: {
      externalVideoId: getEffectiveVideoId(item),
      externalAuthorId: item.author.id === "" ? null : item.author.id,
      videoIdRaw: item.video.id,
      canonicalUrl: item.video.canonicalUrl,
      title: item.video.title,
      description: item.video.description,
      publishedAt: item.video.publishedAt,
      publishedDate: item.video.publishedDate,
      regionCode: item.video.regionCode,
      duration: item.video.duration,
      viewCount: item.stats.viewCount,
      likeCount: item.stats.likeCount,
      commentCount: item.stats.commentCount,
      shareCount: item.stats.shareCount,
      favoriteCount: item.stats.favoriteCount,
    },
    comments: item.comments.items.map((comment) => ({
      externalCommentId: comment.commentId === "" ? null : comment.commentId,
      level: comment.level,
      commentIdRaw: comment.commentId,
      videoIdRaw: comment.videoId,
      parentCommentIdRaw: comment.parentCommentId,
      username: comment.username,
      handle: comment.handle,
      userIdRaw: comment.userId,
      commentText: comment.comment,
      postedAt: comment.postedAt,
      createdAt: comment.createdAt,
      postedDate: comment.postedDate,
      likeCount: comment.likeCount,
      replyCount: comment.replyCount,
    })),
  };
}

export function mapNewCommentsWrapperToSnapshots(payload) {
  return payload.items.map(mapItemToSnapshotDto);
}

export function adaptNewCommentsWrapperBytes(bytes) {
  const parsed = parseAndValidateNewCommentsWrapperBytes(bytes);
  return {
    payloadBytes: Buffer.from(bytes),
    inputFormat: NEW_COMMENTS_WRAPPER_INPUT_FORMAT,
    snapshots: mapNewCommentsWrapperToSnapshots(parsed.payload),
  };
}
