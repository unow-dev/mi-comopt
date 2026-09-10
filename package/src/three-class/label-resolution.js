export const THREE_CLASS_LABEL_PRIORITY = new Map([
  ["normal", 1],
  ["reactive", 2],
  ["direct_nuisance", 3],
]);

export function worseThreeClassLabel(left, right) {
  if (left === undefined || left === null) return right;
  if (right === undefined || right === null) return left;

  const leftPriority = THREE_CLASS_LABEL_PRIORITY.get(left);
  const rightPriority = THREE_CLASS_LABEL_PRIORITY.get(right);
  if (leftPriority === undefined || rightPriority === undefined) {
    throw new Error("worseThreeClassLabel requires valid three-class labels");
  }
  return rightPriority > leftPriority ? right : left;
}
