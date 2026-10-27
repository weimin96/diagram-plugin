import assert from 'node:assert/strict'
import test from 'node:test'
import { compareEditableArchitectureSemantics, judgeExternalLayout, type measureEditableArchitecture } from '../scripts/architecture-layout-gate.js'
import type { CanvasScene } from '../src/canvas.js'

type Metrics = ReturnType<typeof measureEditableArchitecture>
const baseline: Metrics = {
  quality: {
    nodes: 14, arrows: 12, groups: 3, lanes: 0,
    nodeOverlaps: 0, edgeNodeIntersections: 0, edgeCrossings: 0, edgeOverlaps: 1,
    labelOverlaps: 0, labelNodeIntersections: 0, labelOverflows: 0, longLabels: 0,
    isolatedHubs: 0, repeatedCards: 0, crossLaneRelations: 0, excessiveEdgeDetours: 0,
  }, fitPx: 12, frames: 2, frameOverlapArea: 24000, intrusionPx: 0, nonOrthogonalSegments: 0,
  routeLength: 1800, perimeterDetours: 1, portNormals: 0, routeBends: 5,
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

test('external native bends that break Canvas orthogonality are rejected', () => {
  const decision = judgeExternalLayout(baseline, { ...baseline,
    quality: { ...baseline.quality, edgeOverlaps: 0 },
    nonOrthogonalSegments: 1,
  })
  assert.equal(decision.eligible, false)
  assert.ok(decision.reasons.some((reason) => reason.includes('非正交线段')))
})

test('port tangent defects are compared as real geometry, not ignored or traded for fewer overlaps', () => {
  const increased = judgeExternalLayout(baseline, {
    ...baseline, portNormals: 1, quality: { ...baseline.quality, edgeOverlaps: 0 },
  })
  assert.equal(increased.eligible, false)
  assert.ok(increased.reasons.some((reason) => reason.includes('端口法向')))
  const former = { ...baseline, portNormals: 2 }
  const corrected = judgeExternalLayout(former, { ...former, portNormals: 1 })
  assert.equal(corrected.eligible, true, 'true endpoint geometry improvement can justify an otherwise neutral layout')
  const unnecessaryBend = judgeExternalLayout(former, { ...former, portNormals: 1, routeBends: 6 })
  assert.equal(unnecessaryBend.eligible, false,
    'fixing a tangent alone cannot justify adding routing turns without addressing collisions')
  assert.ok(unnecessaryBend.reasons.some((reason) => reason.includes('关系线转折增加')))
})

test('外部引擎不能通过减少相交边框数量来掩盖更大的分区重叠面积', () => {
  const decision = judgeExternalLayout(baseline, { ...baseline,
    frames: 1, frameOverlapArea: 50000,
    quality: { ...baseline.quality, edgeOverlaps: 0 },
  })
  assert.equal(decision.eligible, false)
  assert.ok(decision.reasons.some((reason) => reason.includes('分区重叠面积增加')))
})

test('no decrease in font size or longer exterior paths is silently accepted', () => {
  assert.ok(judgeExternalLayout(baseline, { ...baseline, fitPx: 11,
    quality: { ...baseline.quality, edgeOverlaps: 0 } }).reasons.some((reason) => reason.includes('可读字号')))
  assert.ok(judgeExternalLayout(baseline, { ...baseline, routeLength: 2200,
    quality: { ...baseline.quality, edgeOverlaps: 0 } }).reasons.some((reason) => reason.includes('总线长')))
  assert.ok(judgeExternalLayout(baseline, { ...baseline, perimeterDetours: 2,
    quality: { ...baseline.quality, edgeOverlaps: 0 } }).reasons.some((reason) => reason.includes('外围绕行')))
})

test('external layout cannot falsify or drop an editable source relation', () => {
  const original: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Real input', width: 600, height: 300,
    elements: [
      { id: 'a', type: 'node', text: 'API', x: 5, y: 10, width: 160, height: 80, locked: true },
      { id: 'b', type: 'node', text: 'Store', x: 350, y: 10, width: 160, height: 80 },
      { id: 'edge', type: 'arrow', from: 'a', to: 'b', label: 'query' },
    ],
  }
  assert.equal(compareEditableArchitectureSemantics(original, {
    ...original, elements: original.elements.map((node) =>
      node.id === 'b' ? { ...node, y: 50 } : node),
  }).faithful, true)
  assert.equal(compareEditableArchitectureSemantics(original, {
    ...original, elements: original.elements.map((node) =>
      node.id === 'edge' && node.type === 'arrow' ? { ...node, from: 'b', to: 'a' } : node),
  }).faithful, false)
  assert.equal(compareEditableArchitectureSemantics(original, {
    ...original, elements: original.elements.slice(0, -1),
  }).faithful, false)
  assert.equal(compareEditableArchitectureSemantics(original, {
    ...original, elements: original.elements.map((node) =>
      node.id === 'a' ? { ...node, x: 25 } : node),
  }).faithful, false)
})
