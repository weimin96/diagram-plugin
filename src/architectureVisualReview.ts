/** Perceptual review evidence, separate from deterministic Canvas geometry QA.
 * Scores are attributed to a person or independently identified visual
 * reviewer, never computed from the old structuralScore or screenshot pixels.
 */
export const architectureVisualCriteria = {
  hierarchy: { weight: 20, label: '视觉主次与阅读路径' },
  traceability: { weight: 25, label: '关系与箭头可追踪性' },
  legibility: { weight: 20, label: '文字、端口与标签可读性' },
  composition: { weight: 15, label: '布局、对齐与留白' },
  boundaries: { weight: 10, label: '分区边界与视觉分组' },
  consistency: { weight: 10, label: '风格和图元一致性' },
} as const

export type ArchitectureVisualCriterion = keyof typeof architectureVisualCriteria
export type ArchitectureVisualRating = { score: number | null; evidence: string }
export type ArchitectureVisualRatings = Record<ArchitectureVisualCriterion, ArchitectureVisualRating>

export interface ArchitectureVisualReviewEntry {
  id: string
  screenshotSha256: string
  canvasSha256: string
  svgSha256: string
  reviewer: string
  reviewMode: 'human' | 'independent-vision'
  /** Human approval is explicit; neither scoring nor an AI review grants it. */
  approval: 'pending' | 'approved' | 'changes-required'
  ratings: ArchitectureVisualRatings
  summary: string
  issues: Array<{ elementIds: string[]; observation: string; suggestedFix: string }>
}

export interface ArchitectureReviewEvidence {
  id: string
  screenshotSha256?: string
  canvasSha256: string
  svgSha256: string
  readyForVisualReview: boolean
}

const criterionNames = Object.keys(architectureVisualCriteria) as ArchitectureVisualCriterion[]
const hashPattern = /^[a-f0-9]{64}$/

export function draftArchitectureVisualReview(evidence: ArchitectureReviewEvidence): ArchitectureVisualReviewEntry {
  return {
    id: evidence.id, screenshotSha256: evidence.screenshotSha256 ?? '',
    canvasSha256: evidence.canvasSha256, svgSha256: evidence.svgSha256,
    reviewer: '', reviewMode: 'human', approval: 'pending',
    ratings: Object.fromEntries(criterionNames.map((name) => [name, { score: null, evidence: '' }])) as ArchitectureVisualRatings,
    summary: '', issues: [],
  }
}

export type ArchitectureVisualScoreResult = {
  id: string
  state: 'unreviewed' | 'reviewed' | 'geometry-blocked'
  /** Null means no legitimate current-pixel rating exists, not 0/100. */
  perceptualScore: number | null
  criteria: ArchitectureVisualRatings
  reviewer: string | null
  reviewMode: ArchitectureVisualReviewEntry['reviewMode'] | null
  screenshotSha256: string | null
  canvasSha256: string
  humanApproved: boolean
  summary: string | null
  issues: ArchitectureVisualReviewEntry['issues']
}

export function evaluateArchitectureVisualReview(
  evidence: ArchitectureReviewEvidence,
  review: ArchitectureVisualReviewEntry | undefined,
  validElementIds: ReadonlySet<string>,
): ArchitectureVisualScoreResult {
  for (const [name, hash] of Object.entries({
    canvas: evidence.canvasSha256, svg: evidence.svgSha256,
  })) if (!hashPattern.test(hash)) throw new Error(`Invalid ${name} evidence SHA-256`)
  if (evidence.screenshotSha256 !== undefined && !hashPattern.test(evidence.screenshotSha256)) {
    throw new Error('Invalid screenshot evidence SHA-256')
  }
  if (review) {
    if (review.id !== evidence.id) throw new Error(`Visual review case mismatch: ${review.id}`)
    if (!evidence.screenshotSha256) throw new Error('Visual scoring requires real Chrome screenshot evidence')
    if (review.screenshotSha256 !== evidence.screenshotSha256
      || review.canvasSha256 !== evidence.canvasSha256 || review.svgSha256 !== evidence.svgSha256) {
      throw new Error(`Stale visual review for ${evidence.id}: screenshot/Canvas/SVG fingerprint changed`)
    }
    if (!['human', 'independent-vision'].includes(review.reviewMode)) throw new Error('Unknown reviewer mode')
    if (!['pending', 'approved', 'changes-required'].includes(review.approval)) throw new Error('Unknown approval state')
    if (review.reviewMode !== 'human' && review.approval === 'approved') {
      throw new Error('Only actual human reviewers may approve visual delivery')
    }
    if (!review.ratings || Object.keys(review.ratings).sort().join('|') !== [...criterionNames].sort().join('|')) {
      throw new Error('Visual review must use the complete six-criterion rubric')
    }
    if (!Array.isArray(review.issues)) throw new Error('Review issues must be an array')
    for (const issue of review.issues) {
      if (!Array.isArray(issue.elementIds) || issue.elementIds.some((id) => !validElementIds.has(id))
        || typeof issue.observation !== 'string' || issue.observation.trim().length < 8
        || typeof issue.suggestedFix !== 'string' || issue.suggestedFix.trim().length < 8) {
        throw new Error(`Invalid element-linked visual issue for ${evidence.id}`)
      }
    }
  }
  const ratings = review?.ratings ?? draftArchitectureVisualReview(evidence).ratings
  const scores = criterionNames.map((name) => ratings[name].score)
  const answered = scores.some((score) => score !== null)
  const complete = scores.every((score) => score !== null)
  if (answered) {
    if (!complete || !review || typeof review.reviewer !== 'string' || review.reviewer.trim().length < 3
      || typeof review.summary !== 'string' || review.summary.trim().length < 12) {
      throw new Error(`Incomplete attributed visual review for ${evidence.id}`)
    }
    for (const name of criterionNames) {
      const rating = ratings[name]
      if (typeof rating.score !== 'number' || !Number.isFinite(rating.score)
        || rating.score < 0 || rating.score > 5 || !Number.isInteger(rating.score * 2)
        || typeof rating.evidence !== 'string' || rating.evidence.trim().length < 12) {
        throw new Error(`Invalid pixel-grounded rating for ${evidence.id} / ${name}`)
      }
    }
  }
  const perceptualScore = complete
    ? Math.round(criterionNames.reduce((sum, name) =>
      sum + (ratings[name].score as number) * architectureVisualCriteria[name].weight / 5, 0) * 10) / 10
    : null
  return {
    id: evidence.id, state: perceptualScore === null ? 'unreviewed'
      : evidence.readyForVisualReview ? 'reviewed' : 'geometry-blocked',
    perceptualScore, criteria: ratings,
    reviewer: perceptualScore !== null ? review!.reviewer : null,
    reviewMode: perceptualScore !== null ? review!.reviewMode : null,
    screenshotSha256: evidence.screenshotSha256 ?? null, canvasSha256: evidence.canvasSha256,
    humanApproved: perceptualScore !== null && review!.reviewMode === 'human'
      && review!.approval === 'approved' && evidence.readyForVisualReview,
    summary: perceptualScore !== null ? review!.summary : null,
    issues: perceptualScore !== null ? review!.issues : [],
  }
}

/** Compare reviews for the SAME graph across two independently captured
 * screenshots. No implicit 0 for missing review and no aesthetic regression
 * inferred from deterministic geometry alone.
 */
export function compareArchitectureVisualScores(current: ArchitectureVisualScoreResult[],
  baseline: ArchitectureVisualScoreResult[], minRegressionPoints = 5,
): Array<{ id: string; before: number; after: number; delta: number }> {
  const previous = new Map(baseline.filter((row) => row.perceptualScore !== null).map((row) => [row.id, row]))
  return current.flatMap((row) => {
    const old = previous.get(row.id)
    if (!old || old.perceptualScore === null || row.perceptualScore === null
      || row.perceptualScore > old.perceptualScore - minRegressionPoints) return []
    return [{ id: row.id, before: old.perceptualScore, after: row.perceptualScore,
      delta: Math.round((row.perceptualScore - old.perceptualScore) * 10) / 10 }]
  })
}

export interface ArchitectureVisualSample {
  id: string
  screenshotSha256: string
  canvasSha256: string
  svgSha256: string
  provider: string
  score: number
  ratings: ArchitectureVisualRatings
}

export interface ArchitectureVisualSampleSummary {
  id: string
  provider: string
  screenshotSha256: string
  canvasSha256: string
  svgSha256: string
  sampleCount: number
  mean: number
  median: number
  minimum: number
  maximum: number
  range: number
  /** A score spread exceeding 10 points needs re-evaluation; not approval. */
  unstable: boolean
  criteria: Record<ArchitectureVisualCriterion, { median: number; minimum: number; maximum: number }>
}

/** Aggregates actual independent image reviews, never geometric scores. */
export function summarizeArchitectureVisualSamples(
  samples: readonly ArchitectureVisualSample[],
): ArchitectureVisualSampleSummary {
  if (samples.length < 2 || samples.length > 5) throw new Error('Pixel calibration requires 2–5 genuine samples')
  const [first] = samples
  if (!first.provider || samples.some((sample) => sample.id !== first.id
    || sample.provider !== first.provider || sample.screenshotSha256 !== first.screenshotSha256
    || sample.canvasSha256 !== first.canvasSha256 || sample.svgSha256 !== first.svgSha256)) {
    throw new Error('Pixel samples must share one case, provider, PNG, SVG and Canvas evidence')
  }
  const sorted = (numbers: number[]) => numbers.sort((a, b) => a - b)
  const median = (numbers: number[]) => {
    const values = sorted(numbers)
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
  }
  const values = sorted(samples.map((sample) => sample.score))
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100))
    throw new Error('Invalid sample score')
  const criterionNames = Object.keys(architectureVisualCriteria) as ArchitectureVisualCriterion[]
  const criteria = Object.fromEntries(criterionNames.map((name) => {
    const value = sorted(samples.map((sample) => sample.ratings[name]?.score as number))
    if (value.some((score) => !Number.isFinite(score) || score < 0 || score > 5))
      throw new Error(`Invalid sampled criterion ${name}`)
    return [name, { median: median(value), minimum: value[0], maximum: value[value.length - 1] }]
  })) as ArchitectureVisualSampleSummary['criteria']
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    id: first.id, provider: first.provider, screenshotSha256: first.screenshotSha256,
    canvasSha256: first.canvasSha256, svgSha256: first.svgSha256,
    sampleCount: values.length, mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(median(values)), minimum: values[0], maximum: values[values.length - 1],
    range: round(values[values.length - 1] - values[0]),
    unstable: values[values.length - 1] - values[0] > 10, criteria,
  }
}

/** Require separation of observed sample ranges; never compare unlike providers. */
export function compareArchitectureVisualSampleSummaries(
  current: ArchitectureVisualSampleSummary, previous: ArchitectureVisualSampleSummary,
): 'improved' | 'regressed' | 'inconclusive' {
  if (current.id !== previous.id || current.provider !== previous.provider
    || current.sampleCount < 2 || previous.sampleCount < 2) return 'inconclusive'
  if (current.minimum > previous.maximum + 5) return 'improved'
  if (current.maximum < previous.minimum - 5) return 'regressed'
  return 'inconclusive'
}
