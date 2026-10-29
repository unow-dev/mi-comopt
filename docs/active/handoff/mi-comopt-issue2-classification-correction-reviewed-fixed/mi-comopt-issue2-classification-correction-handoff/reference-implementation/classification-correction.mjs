/**
 * Standalone, side-effect-free reference for the Issue #2 correction domain rule.
 * Not wired to the mi-comopt production State Control Plane or Workflow.
 * Current classification state uses schema_version: 1; WorkDefinition uses schemaVersion: 2.
 */
const LABELS = new Set(['normal', 'reactive', 'direct_nuisance']);

export class CorrectionValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CorrectionValidationError';
    this.code = code;
  }
}

function invalid(code, message) { throw new CorrectionValidationError(code, message); }

function idOf(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) invalid('INVALID_OBSERVATION_ID', 'Numeric ID must be a nonnegative safe integer');
    return String(value);
  }
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    invalid('INVALID_OBSERVATION_ID', 'Observation ID must be a nonempty, unpadded string or safe integer');
  }
  return value;
}
function labelOf(value) {
  if (!LABELS.has(value)) invalid('INVALID_LABEL', 'Label must belong to the three-class enum');
  return value;
}
function ensureArray(value, field) {
  if (!Array.isArray(value)) invalid('INVALID_INPUT', `${field} must be an array`);
  return value;
}

/**
 * @param {{survivors: Array<{observationId: string|number,commentText:string}>,
 * baseLabels: Array<{observationId:string|number,label:string}>,
 * correction: {observationId:string|number,expectedLabel:string,newLabel:string}}} input
 * @returns {{state: {schema_version:1,labels:Array<{observationId:string,label:string}>},
 *  change:{commentText:string,affectedObservationCount:number,changedObservationCount:number,
 *  previousLabels:Array<{label:string,count:number}>,newLabel:string}}}
 */
export function buildCorrectedClassificationState({ survivors, baseLabels, correction } = {}) {
  if (!correction || typeof correction !== 'object' || Array.isArray(correction)) invalid('INVALID_INPUT', 'correction is required');
  const requestedId = idOf(correction.observationId);
  const expectedLabel = labelOf(correction.expectedLabel);
  const newLabel = labelOf(correction.newLabel);
  if (expectedLabel === newLabel) invalid('UNCHANGED_CORRECTION', 'newLabel must differ from expectedLabel');

  const survivorById = new Map();
  for (const item of ensureArray(survivors, 'survivors')) {
    if (!item || typeof item !== 'object') invalid('INVALID_SURVIVOR', 'Survivor must be an object');
    const id = idOf(item.observationId);
    if (typeof item.commentText !== 'string') invalid('INVALID_COMMENT_TEXT', 'commentText must be a string');
    if (survivorById.has(id)) invalid('DUPLICATE_SURVIVOR', `Duplicate survivor ID: ${id}`);
    survivorById.set(id, item.commentText);
  }

  const baseById = new Map();
  for (const item of ensureArray(baseLabels, 'baseLabels')) {
    if (!item || typeof item !== 'object') invalid('INVALID_BASE_LABEL', 'Base label must be an object');
    const id = idOf(item.observationId);
    if (baseById.has(id)) invalid('DUPLICATE_BASE_LABEL', `Duplicate base label ID: ${id}`);
    baseById.set(id, labelOf(item.label));
  }
  if (survivorById.size !== baseById.size || [...survivorById.keys()].some(id => !baseById.has(id))) {
    invalid('INCOMPLETE_CLASSIFICATION', 'Base labels must cover every survivor exactly once, with no extras');
  }
  if (!survivorById.has(requestedId)) invalid('TARGET_NOT_FOUND', 'Requested observation is not a survivor');
  if (baseById.get(requestedId) !== expectedLabel) invalid('EXPECTED_LABEL_MISMATCH', 'Target base label differs from expectedLabel');

  const commentText = survivorById.get(requestedId);
  const distribution = new Map();
  let affected = 0;
  let changed = 0;
  const labels = [];
  for (const [id, oldLabel] of baseById) {
    const inGroup = survivorById.get(id) === commentText; // JS exact string comparison; no normalization
    const nextLabel = inGroup ? newLabel : oldLabel;
    labels.push({ observationId: id, label: nextLabel });
    if (inGroup) {
      affected += 1;
      distribution.set(oldLabel, (distribution.get(oldLabel) ?? 0) + 1);
      if (oldLabel !== nextLabel) changed += 1;
    }
  }
  if (changed === 0) invalid('UNCHANGED_CORRECTION', 'A correction must change at least one observation');
  labels.sort((a, b) => a.observationId.localeCompare(b.observationId));
  const previousLabels = [...distribution].sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count }));
  return {
    state: { schema_version: 1, labels },
    change: { commentText, affectedObservationCount: affected, changedObservationCount: changed, previousLabels, newLabel },
  };
}
