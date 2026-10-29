import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCorrectedClassificationState as build, CorrectionValidationError } from './classification-correction.mjs';

const survivors = [
  { observationId: '101', commentText: 'AAA' },
  { observationId: '102', commentText: 'AAA' },
  { observationId: '103', commentText: 'BBB' },
];
const baseLabels = [
  { observationId: '101', label: 'direct_nuisance' },
  { observationId: '102', label: 'direct_nuisance' },
  { observationId: '103', label: 'reactive' },
];
const correction = { observationId: '101', expectedLabel: 'direct_nuisance', newLabel: 'normal' };
const input = (updates = {}) => ({ survivors, baseLabels, correction, ...updates });
const failure = (dto, code) => assert.throws(() => build(dto), e => e instanceof CorrectionValidationError && e.code === code);

test('T01 exact group is corrected, unrelated label unchanged; schema_version stays 1', () => {
  const result = build(input());
  assert.deepEqual(result.state, { schema_version: 1, labels: [
    { observationId: '101', label: 'normal' },
    { observationId: '102', label: 'normal' },
    { observationId: '103', label: 'reactive' },
  ] });
  assert.deepEqual(result.change, {
    commentText: 'AAA', affectedObservationCount: 2, changedObservationCount: 2,
    previousLabels: [{ label: 'direct_nuisance', count: 2 }], newLabel: 'normal',
  });
});
test('T02 heterogeneous labels converge with accurate distribution', () => {
  const result = build(input({ baseLabels: [...baseLabels.slice(0, 1), { observationId: '102', label: 'reactive' }, baseLabels[2]] }));
  assert.equal(result.change.affectedObservationCount, 2);
  assert.equal(result.change.changedObservationCount, 2);
  assert.deepEqual(result.change.previousLabels, [{ label: 'direct_nuisance', count: 1 }, { label: 'reactive', count: 1 }]);
});
test('T03 invalid IDs and labels fail closed', () => {
  for (const invalidId of [null, undefined, true, {}, Number.NaN, Number.POSITIVE_INFINITY, 1.5, '']) {
    failure(input({ correction: { ...correction, observationId: invalidId } }), 'INVALID_OBSERVATION_ID');
  }
  failure(input({ correction: { ...correction, observationId: '999' } }), 'TARGET_NOT_FOUND');
  failure(input({ correction: { ...correction, expectedLabel: 'reactive' } }), 'EXPECTED_LABEL_MISMATCH');
  failure(input({ correction: { ...correction, newLabel: 'unknown' } }), 'INVALID_LABEL');
  failure(input({ correction: { ...correction, newLabel: 'direct_nuisance' } }), 'UNCHANGED_CORRECTION');
});
test('T03 duplicates/missing/extra labels fail closed', () => {
  failure(input({ survivors: [...survivors, survivors[0]] }), 'DUPLICATE_SURVIVOR');
  failure(input({ baseLabels: [...baseLabels, baseLabels[0]] }), 'DUPLICATE_BASE_LABEL');
  failure(input({ baseLabels: baseLabels.slice(0, 2) }), 'INCOMPLETE_CLASSIFICATION');
  failure(input({ baseLabels: [...baseLabels, { observationId: '999', label: 'normal' }] }), 'INCOMPLETE_CLASSIFICATION');
  failure(input({ survivors: [...survivors.slice(0, 2), { observationId: '103', commentText: null }] }), 'INVALID_COMMENT_TEXT');
});
test('T03 string matching is exact without trim, case fold or Unicode normalization', () => {
  const extended = [
    { observationId: '1', commentText: 'AAA' },
    { observationId: '2', commentText: 'AAA ' },
    { observationId: '3', commentText: 'aaa' },
    { observationId: '4', commentText: '\u00e9' },
    { observationId: '5', commentText: 'e\u0301' },
  ];
  const labels = extended.map(x => ({ observationId: x.observationId, label: 'direct_nuisance' }));
  const result = build({ survivors: extended, baseLabels: labels, correction: { observationId: '4', expectedLabel: 'direct_nuisance', newLabel: 'normal' } });
  assert.equal(result.change.affectedObservationCount, 1);
  assert.equal(result.state.labels.find(x => x.observationId === '5').label, 'direct_nuisance');
});
test('T03 numeric/string canonical ID collisions are rejected', () => {
  failure(input({ survivors: [...survivors, { observationId: 101, commentText: 'AAA' }] }), 'DUPLICATE_SURVIVOR');
  failure(input({ baseLabels: [...baseLabels, { observationId: 101, label: 'normal' }] }), 'DUPLICATE_BASE_LABEL');
});
test('pure function does not mutate inputs', () => {
  const dto = input({ survivors: structuredClone(survivors), baseLabels: structuredClone(baseLabels), correction: { ...correction } });
  const snapshot = structuredClone(dto);
  build(dto);
  assert.deepEqual(dto, snapshot);
});
test('sorting follows localeCompare, not numeric sort', () => {
  const dto = {
    survivors: [{ observationId: '10', commentText: 'A' }, { observationId: '2', commentText: 'B' }],
    baseLabels: [{ observationId: '10', label: 'reactive' }, { observationId: '2', label: 'direct_nuisance' }],
    correction: { observationId: '10', expectedLabel: 'reactive', newLabel: 'normal' },
  };
  assert.deepEqual(build(dto).state.labels.map(x => x.observationId), ['10', '2'].sort((a, b) => a.localeCompare(b)));
});
