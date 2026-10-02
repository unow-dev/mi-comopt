const GOAL_MET_RATE = 2
const GOAL_UNMET_RATE = 3
const CAUTION_RATE = 4

function evaluationForRate(ratePercent) {
  if (ratePercent <= GOAL_MET_RATE) return 'goal_met'
  if (ratePercent < GOAL_UNMET_RATE) return 'goal_unmet'
  if (ratePercent < CAUTION_RATE) return 'caution'
  return 'warning'
}

function evaluationForScore(score) {
  if (score >= 80) return 'goal_met'
  if (score > 60) return 'goal_unmet'
  if (score > 40) return 'caution'
  return 'warning'
}

function requireEvaluation(evaluation) {
  if (!['goal_met', 'goal_unmet', 'caution', 'warning'].includes(evaluation)) {
    throw new RangeError('evaluation must be a calculated public order evaluation')
  }
}

export function derivePublicOrderIndex(directNuisanceCount, observationCount) {
  if (!Number.isSafeInteger(directNuisanceCount) || !Number.isSafeInteger(observationCount)
    || directNuisanceCount < 0 || observationCount < 0 || directNuisanceCount > observationCount) {
    throw new RangeError('counts must be non-negative safe integers and direct nuisance cannot exceed observations')
  }

  if (observationCount === 0) {
    return {
      status: 'unavailable',
      directNuisanceRate: null,
      score: null,
      evaluation: 'unavailable',
    }
  }

  const directNuisanceRate = (100 * directNuisanceCount) / observationCount
  const score = directNuisanceRate <= GOAL_MET_RATE
    ? 100 - (10 * directNuisanceRate)
    : Math.max(0, 120 - (20 * directNuisanceRate))

  return {
    status: 'available',
    directNuisanceRate,
    score,
    evaluation: evaluationForRate(directNuisanceRate),
  }
}

export function formatDirectNuisanceRate(ratePercent, evaluation) {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) throw new RangeError('ratePercent must be a non-negative finite number')
  requireEvaluation(evaluation)
  if (evaluationForRate(ratePercent) !== evaluation) throw new RangeError('evaluation does not match ratePercent')

  const oneDecimal = Number(ratePercent.toFixed(1))
  if (evaluationForRate(oneDecimal) === evaluation) return `${oneDecimal.toFixed(1)}%`

  const twoDecimals = Number(ratePercent.toFixed(2))
  if (evaluationForRate(twoDecimals) === evaluation) return `${twoDecimals.toFixed(2)}%`

  if (evaluation === 'goal_unmet') {
    return twoDecimals <= GOAL_MET_RATE ? '2.0%超' : '3.0%未満'
  }
  if (evaluation === 'caution') return '4.0%未満'
  return `${twoDecimals.toFixed(2)}%`
}

export function formatPublicOrderScore(score, evaluation) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new RangeError('score must be a finite number from 0 to 100')
  requireEvaluation(evaluation)
  if (evaluationForScore(score) !== evaluation) throw new RangeError('evaluation does not match score')

  const integer = Math.round(score)
  if (evaluationForScore(integer) === evaluation) return String(integer)

  const oneDecimal = Number(score.toFixed(1))
  if (evaluationForScore(oneDecimal) === evaluation) return oneDecimal.toFixed(1)

  if (evaluation === 'goal_unmet') return score >= 79.5 ? '80未満' : '60超'
  if (evaluation === 'caution') return '40超'
  return String(integer)
}
