import assert from 'node:assert/strict'
import test from 'node:test'
import {
  architectureVisualCriteria, compareArchitectureVisualScores, draftArchitectureVisualReview,
  evaluateArchitectureVisualReview, type ArchitectureReviewEvidence,
} from '../src/architectureVisualReview.js'

const source: ArchitectureReviewEvidence = {
  id: 'real-imports', screenshotSha256: 'a'.repeat(64),
  canvasSha256: 'b'.repeat(64), svgSha256: 'c'.repeat(64),
  readyForVisualReview: false,
}
const nodes = new Set(['composer', 'routing', 'canvas'])
const complete = () => {
  const review = draftArchitectureVisualReview(source)
  review.reviewer = 'Independent visual reviewer'
  review.summary = '实际截图里可读性不足，关系与层级仍存在混淆。'
  for (const [name, rating] of Object.entries(review.ratings)) {
    rating.score = name === 'traceability' ? 3.5 : 4
    rating.evidence = `在实际截图里，${name} 对应的区域与节点位置可观察，尚有拥挤。`
  }
  review.issues = [{ elementIds: ['composer', 'routing'],
    observation: '两个模块的箭头在截图中心区域重叠',
    suggestedFix: '把端口和共享主干放进联合走廊优化' }]
  return review
}

test('pixel score is null until an attributed current-screenshot review exists', () => {
  const empty = evaluateArchitectureVisualReview(source, undefined, nodes)
  assert.equal(empty.state, 'unreviewed')
  assert.equal(empty.perceptualScore, null)
  const draft = evaluateArchitectureVisualReview(source, draftArchitectureVisualReview(source), nodes)
  assert.equal(draft.state, 'unreviewed')
  assert.equal(draft.perceptualScore, null)
  assert.equal(Object.values(architectureVisualCriteria).reduce((n, criterion) => n + criterion.weight, 0), 100)
})

test('six criteria produce a weighted score independently of deterministic geometry qualification', () => {
  const review = complete()
  const result = evaluateArchitectureVisualReview(source, review, nodes)
  assert.equal(result.perceptualScore, 77.5)
  assert.equal(result.state, 'geometry-blocked')
  assert.equal(result.reviewMode, 'human')
  assert.equal(result.humanApproved, false)
  assert.equal(result.issues[0].elementIds[0], 'composer')
  const eligible = evaluateArchitectureVisualReview({ ...source, readyForVisualReview: true }, review, nodes)
  assert.equal(eligible.state, 'reviewed')
  assert.equal(eligible.perceptualScore, 77.5)
  const approved = complete()
  approved.approval = 'approved'
  assert.equal(evaluateArchitectureVisualReview({ ...source, readyForVisualReview: true },
    approved, nodes).humanApproved, true)
  assert.equal(evaluateArchitectureVisualReview(source, approved, nodes).humanApproved, false,
    'human approval cannot override a failed geometry gate')
  approved.reviewMode = 'independent-vision'
  assert.throws(() => evaluateArchitectureVisualReview(source, approved, nodes), /Only actual human/)
})

test('stale screenshots or editable artifacts invalidate their old visual rating', () => {
  const review = complete()
  assert.throws(() => evaluateArchitectureVisualReview({
    ...source, screenshotSha256: 'd'.repeat(64),
  }, review, nodes), /Stale visual review/)
  assert.throws(() => evaluateArchitectureVisualReview({
    ...source, canvasSha256: 'd'.repeat(64),
  }, review, nodes), /Stale visual review/)
  assert.throws(() => evaluateArchitectureVisualReview({
    ...source, screenshotSha256: undefined,
  }, review, nodes), /real Chrome screenshot/)
})

test('reject missing evidence, anonymous scores and issues targeting nonexistent elements', () => {
  const anonymous = complete()
  anonymous.reviewer = ''
  assert.throws(() => evaluateArchitectureVisualReview(source, anonymous, nodes), /Incomplete attributed/)
  const incomplete = complete()
  incomplete.ratings.hierarchy.score = null
  assert.throws(() => evaluateArchitectureVisualReview(source, incomplete, nodes), /Incomplete attributed/)
  const ungrounded = complete()
  ungrounded.ratings.hierarchy.evidence = '好'
  assert.throws(() => evaluateArchitectureVisualReview(source, ungrounded, nodes), /pixel-grounded rating/)
  const invented = complete()
  invented.issues[0].elementIds.push('invented')
  assert.throws(() => evaluateArchitectureVisualReview(source, invented, nodes), /element-linked visual issue/)
})

test('visual regression only compares genuinely scored matching cases, not missing scores as zeros', () => {
  const baseline = evaluateArchitectureVisualReview({ ...source, readyForVisualReview: true }, complete(), nodes)
  const latestReview = complete()
  latestReview.ratings.traceability.score = 2
  const latest = evaluateArchitectureVisualReview({ ...source, readyForVisualReview: true }, latestReview, nodes)
  assert.deepEqual(compareArchitectureVisualScores([latest], [baseline]), [
    { id: 'real-imports', before: 77.5, after: 70, delta: -7.5 },
  ])
  assert.deepEqual(compareArchitectureVisualScores([evaluateArchitectureVisualReview(source, undefined, nodes)],
    [baseline]), [])
})
