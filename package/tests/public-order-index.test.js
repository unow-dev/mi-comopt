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
    [1, 20, 5, 30, 'warning'],
    [20, 1000, 2, 80, 'goal_met'],
    [25, 1000, 2.5, 220 / 3, 'goal_unmet'],
    [30, 1000, 3, 200 / 3, 'goal_unmet'],
    [35, 1000, 3.5, 60, 'caution'],
    [40, 1000, 4, 50, 'caution'],
    [45, 1000, 4.5, 40, 'warning'],
    [60, 1000, 6, 10, 'warning'],
    [65, 1000, 6.5, 0, 'warning'],
    [66, 1000, 6.6, 0, 'warning'],
    [33, 1000, 3.3, 188 / 3, 'goal_unmet'],
  ]

  for (const [direct, observations, rate, score, evaluation] of cases) {
    const result = derivePublicOrderIndex(direct, observations)
    assert.equal(result.directNuisanceRate, rate)
    if (score === null) assert.equal(result.score, null)
    else assert.ok(Math.abs(result.score - score) < 1e-10, `${rate}%: expected score ${score}, got ${result.score}`)
    assert.equal(result.evaluation, evaluation)
    assert.equal(result.status, observations === 0 ? 'unavailable' : 'available')
  }
})

test('uses the raw rate at evaluation boundaries', () => {
  const cases = [
    [1999, 'goal_met'],
    [2000, 'goal_met'],
    [2001, 'goal_unmet'],
    [2499, 'goal_unmet'],
    [2500, 'goal_unmet'],
    [2501, 'goal_unmet'],
    [3499, 'goal_unmet'],
    [3500, 'caution'],
    [3501, 'caution'],
    [4499, 'caution'],
    [4500, 'warning'],
    [4501, 'warning'],
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
    [3.3, 'goal_unmet', '3.3%'],
    [2, 'goal_met', '2.0%'],
    [2.5, 'goal_unmet', '2.5%'],
    [3.03, 'goal_unmet', '3.0%'],
    [2.04, 'goal_unmet', '2.04%'],
    [2.53, 'goal_unmet', '2.5%'],
    [3.46, 'goal_unmet', '3.46%'],
    [4.46, 'caution', '4.46%'],
    [2.001, 'goal_unmet', '2.0%超'],
    [3.499, 'goal_unmet', '3.5%未満'],
    [3.5, 'caution', '3.5%'],
    [4.499, 'caution', '4.5%未満'],
    [4.5, 'warning', '4.5%'],
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

test('derived scores remain continuous and can be formatted across the new rate boundaries', () => {
  let previousScore = 100
  for (let direct = 0; direct <= 10000; direct++) {
    const { directNuisanceRate, score, evaluation } = derivePublicOrderIndex(direct, 100000)
    assert.ok(score <= previousScore)
    assert.ok(previousScore - score <= 0.021)
    assert.doesNotThrow(() => formatDirectNuisanceRate(directNuisanceRate, evaluation))
    assert.doesNotThrow(() => formatPublicOrderScore(score, evaluation))
    previousScore = score
  }
})
