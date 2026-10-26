import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { parseCanvasScene, createCanvasSource } from '../src/canvas.js'
import { summarizeCanvasQuality, summarizeMermaidQuality } from '../src/diagramQuality.js'
import { assessMermaidVisualQuality } from '../src/mermaidQuality.js'
import { mermaidDiagramTypes } from '../src/types.js'
import { createTemplate } from '../src/templates.js'

test('one quality report preserves Canvas facts and never invents a human approval', () => {
  const scene = parseCanvasScene(createCanvasSource('Source', 'architecture'))
  const source = assessCanvasVisualQuality(scene)
  const simple = summarizeCanvasQuality(source)
  assert.equal(simple.engine, 'canvas')
  assert.equal(simple.type, 'canvas')
  assert.equal(simple.geometry, source.needsRevision ? 'needs-revision' : 'passed')
  assert.equal(simple.visualReview, 'not-assessed')
  assert.equal(simple.humanApproval, 'not-approved')
  assert.deepEqual(simple.metrics, source.metrics)
  const blocked = summarizeCanvasQuality(source, { readyForVisualReview: false, blockers: ['真实依赖重叠'] })
  assert.equal(blocked.visualReview, 'blocked')
  assert.ok(blocked.needsRevision)
  assert.ok(blocked.findings.some((item) => item.code === 'visual-review-blocked'))
  const eligible = summarizeCanvasQuality(source, { readyForVisualReview: true, blockers: [] })
  assert.equal(eligible.visualReview, 'eligible')
  assert.equal(eligible.humanApproval, 'not-approved')
})

test('all 19 semantic engines use the same report, but source-only cannot claim geometry or visual approval', () => {
  for (const { type } of mermaidDiagramTypes) {
    const source = createTemplate(type, 'Example')
    const quality = assessMermaidVisualQuality(type, source)
    const unmeasured = summarizeMermaidQuality(type, quality)
    assert.equal(unmeasured.engine, 'mermaid', type)
    assert.equal(unmeasured.type, type)
    assert.equal(unmeasured.geometry, 'not-measured', type)
    assert.equal(unmeasured.visualReview, 'not-assessed', type)
    assert.equal(unmeasured.humanApproval, 'not-approved', type)
    assert.equal(unmeasured.needsRevision, quality.splitRecommended, type)

    const measured = summarizeMermaidQuality(type, quality, {
      width: 800, height: 600, contentOverflow: 0, nodeOverlaps: 0, labelOverlaps: 0,
    })
    assert.equal(measured.geometry, 'passed', type)
    assert.equal(measured.evidence, 'browser', type)
    assert.equal(measured.visualReview, 'not-assessed', type)
  }
  const flowchart = assessMermaidVisualQuality('flowchart', 'flowchart LR\n  A --> B')
  const obstructed = summarizeMermaidQuality('flowchart', flowchart, {
    width: 800, height: 600, contentOverflow: 1, nodeOverlaps: 2, labelOverlaps: 1,
  })
  assert.equal(obstructed.geometry, 'needs-revision')
  assert.equal(obstructed.needsRevision, true)
  assert.deepEqual(obstructed.findings.map((item) => item.code),
    ['text-overflow', 'node-overlap', 'label-overlap'])
  const textWarning = summarizeMermaidQuality('radar', assessMermaidVisualQuality('radar', createTemplate('radar', 'Demo')), {
    width: 800, height: 600, contentOverflow: 0, nodeOverlaps: 0, labelOverlaps: 0, textOverlaps: 1,
  })
  assert.equal(textWarning.needsRevision, false, 'advisory text intersections cannot become an unverified hard failure')
  assert.ok(textWarning.findings.some((issue) => issue.code === 'text-overlap'
    && issue.severity === 'warning' && issue.origin === 'browser'))
  assert.equal(obstructed.humanApproval, 'not-approved')
})
