import test from 'node:test'
import assert from 'node:assert/strict'
import {
  derivePublicOrderIndex,
  formatDirectNuisanceRate,
  formatPublicOrderScore,
} from '../src/ui/public-order-index.js'

test('derives the public order score and evaluation from unrounded rates', () => {
  const cases = [
    [0, 0, null, null, 'unavailable'],
    [0, 1, 0, 100, 'goal_met'],
    [1, 1, 100, 0, 'warning'],
    [1, 20, 5, 20, 'warning'],
    [20, 1000, 2, 80, 'goal_met'],
    [30, 1000, 3, 60, 'caution'],
    [40, 1000, 4, 40, 'warning'],
    [60, 1000, 6, 0, 'warning'],
    [61, 1000, 6.1, 0, 'warning'],
    [33, 1000, 3.3, 54, 'caution'],
  ]

  for (const [direct, observations, rate, score, evaluation] of cases) {
    const result = derivePublicOrderIndex(direct, observations)
    assert.equal(result.directNuisanceRate, rate)
    assert.equal(result.score, score)
    assert.equal(result.evaluation, evaluation)
    assert.equal(result.status, observations === 0 ? 'unavailable' : 'available')
  }
})

test('uses the raw rate at evaluation boundaries', () => {
  const cases = [
    [2001, 'goal_unmet'],
    [2999, 'goal_unmet'],
    [3000, 'caution'],
    [3999, 'caution'],
    [4000, 'warning'],
  ]
  for (const [direct, evaluation] of cases) {
    assert.equal(derivePublicOrderIndex(direct, 100000).evaluation, evaluation)
  }
})

test('rejects counts outside the input contract', () => {
  const invalidCases = [
    [0, -1],
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [0, 1.5],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ]
  for (const values of invalidCases) assert.throws(() => derivePublicOrderIndex(...values), RangeError)
})

test('formats direct nuisance rates without changing their evaluation', () => {
  const cases = [
    [3.3, 'caution', '3.3%'],
    [2.53, 'goal_unmet', '2.5%'],
    [2.04, 'goal_unmet', '2.04%'],
    [2.96, 'goal_unmet', '2.96%'],
    [3.96, 'caution', '3.96%'],
    [2.001, 'goal_unmet', '2.0%超'],
    [2.999, 'goal_unmet', '3.0%未満'],
    [3.999, 'caution', '4.0%未満'],
  ]
  for (const [rate, evaluation, expected] of cases) {
    assert.equal(formatDirectNuisanceRate(rate, evaluation), expected)
  }
  assert.throws(() => formatDirectNuisanceRate(2, 'warning'), RangeError)
})

test('formats scores without crossing their evaluation boundaries', () => {
  const cases = [
    [54, 'caution', '54'],
    [60.8, 'goal_unmet', '61'],
    [59.8, 'caution', '60'],
    [39.8, 'warning', '40'],
    [79.6, 'goal_unmet', '79.6'],
    [79.98, 'goal_unmet', '80未満'],
    [60.4, 'goal_unmet', '60.4'],
    [60.02, 'goal_unmet', '60超'],
    [40.4, 'caution', '40.4'],
    [40.02, 'caution', '40超'],
  ]
  for (const [score, evaluation, expected] of cases) {
    assert.equal(formatPublicOrderScore(score, evaluation), expected)
  }
  assert.throws(() => formatPublicOrderScore(60.02, 'caution'), RangeError)
})
