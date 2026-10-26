import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { parseCanvasScene, createCanvasSource } from '../src/canvas.js'
import { summarizeCanvasQuality, summarizeMermaidQuality } from '../src/diagramQuality.js'
import { countOverlappingRects, readSvgDimensions, rectContains, rectsOverlapWithInset } from '../src/diagramGeometry.js'
import { proposePresentationCandidates, selectPresentationCandidate, withPresentationCandidate } from '../src/diagramPresentationAB.js'
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
  assert.ok(blocked.repairSuggestions.some((item) => item.findingCode === 'visual-review-blocked'
    && item.automatic === false))
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
  assert.ok(obstructed.repairSuggestions.some((item) => item.findingCode === 'text-overflow'
    && item.target === 'presentation' && item.automatic === false))
  const denseSequence = summarizeMermaidQuality('sequence', assessMermaidVisualQuality(
    'sequence', ['sequenceDiagram', ...Array.from({ length: 11 }, (_, i) => `participant P${i}`),
      'P0->>P1: call'].join('\n')))
  assert.ok(denseSequence.repairSuggestions.some((item) => item.target === 'source'
    && item.action.includes('消息') && item.action.includes('顺序')))
  assert.ok(textWarning.repairSuggestions.some((item) => item.action.includes('雷达图')
    && item.target === 'presentation'))
})

test('shared rectangle semantics preserve Canvas insets and browser-pixel strict thresholds', () => {
  const a = { x: 0, y: 0, width: 100, height: 60 }
  const barely = { x: 97, y: 8, width: 120, height: 50 }
  const overlaps = { x: 95, y: 8, width: 120, height: 50 }
  assert.equal(rectsOverlapWithInset(a, barely, 2), false,
    'Canvas intentionally ignores a 3px border contact')
  assert.equal(rectsOverlapWithInset(a, overlaps, 2), true,
    'Canvas still detects interior overlap beyond the existing 2px insets')
  assert.equal(rectContains(a, { x: -2, y: -2, width: 50, height: 50 }, 2), true)
  assert.equal(rectContains(a, { x: -4, y: 0, width: 50, height: 50 }, 2), false)
  assert.equal(countOverlappingRects([a, barely], 4), 0)
  assert.equal(countOverlappingRects([a, overlaps], 4), 1)
  assert.equal(countOverlappingRects([a, overlaps, overlaps], 4), 3,
    'each browser-rendered text pair is counted exactly once')
  assert.deepEqual(readSvgDimensions('0 0 2665.4609375 540.75', '100%', null),
    { width: 2665.4609375, height: 540.75 }, 'percent-sized Mermaid SVG uses real viewBox')
  assert.deepEqual(readSvgDimensions('0   0\n912.4453125\t873.5', null, null),
    { width: 912.4453125, height: 873.5 }, 'SVG viewBox may contain arbitrary whitespace')
  assert.deepEqual(readSvgDimensions(null, '100%', '100%'),
    { width: 0, height: 0 }, 'never accept 100x0 fallback as valid browser geometry')
  assert.deepEqual(readSvgDimensions(null, '720px', '400'),
    { width: 720, height: 400 })
})

test('reversible presentation A/B requires a strict improvement on two themes without side effects', () => {
  const type = 'radar'
  const quality = assessMermaidVisualQuality(type, createTemplate(type, 'Test'))
  const baseline = summarizeMermaidQuality(type, quality, {
    width: 764, height: 629, contentOverflow: 0, nodeOverlaps: 0, labelOverlaps: 0, textOverlaps: 1,
  })
  const baseConfig = { radar: { marginTop: 44 } } as Parameters<typeof withPresentationCandidate>[0]
  const before = JSON.stringify(baseConfig)
  const proposed = proposePresentationCandidates(type, baseline, baseConfig)
  assert.deepEqual(proposed.map((item) => item.id), ['radar-top+12', 'radar-top+28'])
  assert.equal(withPresentationCandidate(baseConfig, proposed[0]).radar?.marginTop, 56)
  assert.equal(JSON.stringify(baseConfig), before, 'candidates must never mutate the production config')
  const baselineGeometry = { width: 764, height: 629, contentOverflow: 0, nodeOverlaps: 0, labelOverlaps: 0, textOverlaps: 1 }
  const observation = (mode: 'light' | 'dark', extras = {}) => ({
    mode, baseline: baselineGeometry, candidates: [
      { id: proposed[0].id, geometry: {
        ...baselineGeometry, height: 641, textOverlaps: 0, ...extras,
      } },
      { id: proposed[1].id, geometry: {
        ...baselineGeometry, height: 657, textOverlaps: 0,
      } },
    ],
  })
  const selected = selectPresentationCandidate(proposed, [observation('light'), observation('dark')])
  assert.equal(selected.state, 'improved')
  assert.equal(selected.selected?.value, 56, 'smallest verified change wins')
  const oneTheme = selectPresentationCandidate(proposed, [observation('light')])
  assert.equal(oneTheme.state, 'rejected')
  const regression = selectPresentationCandidate(proposed,
    [observation('light'), observation('dark', { nodeOverlaps: 1 })])
  assert.equal(regression.selected?.id, proposed[1].id,
    'reject an otherwise improved candidate if its second theme has a new hard collision')
  assert.equal(selectPresentationCandidate(proposed, [
    observation('light', { width: 1100 }),
    observation('dark', { width: 1100 }),
  ]).selected?.id, proposed[1].id, 'reject any candidate that inflates width beyond the geometric cap')
  assert.deepEqual(proposePresentationCandidates(type, summarizeMermaidQuality(type, quality), baseConfig), [],
    'source-only evidence must not propose browser-dependent changes')

  for (const diagram of ['state', 'class', 'er'] as const) {
    for (const [kind, axis] of [['node-overlap', 'nodeSpacing'], ['label-overlap', 'rankSpacing']] as const) {
      const source = createTemplate(diagram, 'Demo')
      const assessed = summarizeMermaidQuality(diagram, assessMermaidVisualQuality(diagram, source), {
        width: 900, height: 700, contentOverflow: 0,
        nodeOverlaps: kind === 'node-overlap' ? 1 : 0,
        labelOverlaps: kind === 'label-overlap' ? 1 : 0,
      })
      const config = { [diagram === 'class' ? 'state' : diagram]: {
        nodeSpacing: 32, rankSpacing: 42,
      } } as Parameters<typeof withPresentationCandidate>[0]
      const pristine = JSON.stringify(config)
      const proposals = proposePresentationCandidates(diagram, assessed, config)
      assert.deepEqual(proposals.map((item) => item.id),
        [`${diagram}-${axis}+12`, `${diagram}-${axis}+24`])
      const configPath = diagram === 'class' ? 'state' : diagram
      assert.equal(withPresentationCandidate(config, proposals[0])[configPath]?.[axis],
        (config[configPath]?.[axis] ?? 0) + 12, diagram)
      assert.equal(JSON.stringify(config), pristine, 'candidate evaluation must not mutate config')
      assert.equal(proposePresentationCandidates(diagram, summarizeMermaidQuality(diagram,
        assessMermaidVisualQuality(diagram, source)), config).length, 0,
      'a source-only quality warning cannot trigger browser geometry alterations')
    }
  }
})
