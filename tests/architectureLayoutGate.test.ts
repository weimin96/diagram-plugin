import assert from 'node:assert/strict'
import test from 'node:test'
import { judgeExternalLayout, type measureEditableArchitecture } from '../scripts/architecture-layout-gate.js'

type Metrics = ReturnType<typeof measureEditableArchitecture>
const baseline: Metrics = {
  quality: {
    nodes: 14, arrows: 12, groups: 3, lanes: 0,
    nodeOverlaps: 0, edgeNodeIntersections: 0, edgeCrossings: 0, edgeOverlaps: 1,
    labelOverlaps: 0, labelNodeIntersections: 0, labelOverflows: 0, longLabels: 0,
    isolatedHubs: 0, repeatedCards: 0, crossLaneRelations: 0, excessiveEdgeDetours: 0,
  }, fitPx: 12, frames: 2, intrusionPx: 0,
}

test('better overlap does not compensate an unreadable external layout', () => {
  const decision = judgeExternalLayout(baseline, { ...baseline, fitPx: 9,
    quality: { ...baseline.quality, edgeOverlaps: 0 }, frames: 0 })
  assert.equal(decision.eligible, false)
  assert.ok(decision.reasons.some((reason) => reason.includes('可读字号')))
})

test('external layout rejects extra crossing even if all overlaps disappear', () => {
  const decision = judgeExternalLayout(baseline, { ...baseline,
    quality: { ...baseline.quality, edgeCrossings: 6, edgeOverlaps: 0 }, fitPx: 14 })
  assert.equal(decision.eligible, false)
  assert.ok(decision.reasons.some((reason) => reason.includes('交叉增加')))
})

test('quality gate accepts genuinely improved alignment and rejects neutral alternatives', () => {
  assert.equal(judgeExternalLayout(baseline, {
    ...baseline, quality: { ...baseline.quality, edgeOverlaps: 0 }, frames: 0,
  }).eligible, true)
  assert.equal(judgeExternalLayout(baseline, baseline).eligible, false)
})

test('a layout with new label collisions cannot pass even when paths improve', () => {
  assert.equal(judgeExternalLayout(baseline, { ...baseline,
    quality: { ...baseline.quality, edgeOverlaps: 0, labelOverlaps: 1 },
  }).eligible, false)
})
