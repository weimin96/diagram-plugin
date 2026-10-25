import assert from 'node:assert/strict'
import test from 'node:test'
import {
  architectureVisualCriteria, compareArchitectureVisualSampleSummaries,
  summarizeArchitectureVisualSamples, type ArchitectureVisualSample,
  type ArchitectureVisualRatings,
} from '../src/architectureVisualReview.js'

const sha = 'a'.repeat(64)
const make = (score: number, provider = 'dsh-headless-read_image'): ArchitectureVisualSample => ({
  id: 'real-project', provider, screenshotSha256: sha, canvasSha256: sha, svgSha256: sha,
  score, ratings: Object.fromEntries(Object.keys(architectureVisualCriteria).map((key) =>
    [key, { score: score / 20, evidence: '图中的连线较多，部分文字与边界难以辨认。' }])) as ArchitectureVisualRatings,
})

test('repeated DSH pixel assessment reports honest mean, median, range and each criterion', () => {
  const result = summarizeArchitectureVisualSamples([make(35), make(50), make(40)])
  assert.equal(result.sampleCount, 3)
  assert.equal(result.mean, 41.7)
  assert.equal(result.median, 40)
  assert.equal(result.minimum, 35)
  assert.equal(result.maximum, 50)
  assert.equal(result.range, 15)
  assert.equal(result.unstable, true)
  assert.deepEqual(result.criteria.traceability, { median: 2, minimum: 1.75, maximum: 2.5 })
})

test('rejects mixing screenshots, providers or missing/equivocal sample ratings', () => {
  assert.throws(() => summarizeArchitectureVisualSamples([make(40)]), /2–5/)
  assert.throws(() => summarizeArchitectureVisualSamples(Array.from({ length: 6 }, () => make(40))), /2–5/)
  assert.throws(() => summarizeArchitectureVisualSamples([make(40), make(45, 'codex')]), /share one case/)
  assert.throws(() => summarizeArchitectureVisualSamples([make(40), { ...make(40), screenshotSha256: 'b'.repeat(64) }]), /share one case/)
  const broken = make(40)
  delete (broken.ratings as Partial<ArchitectureVisualRatings>).traceability
  assert.throws(() => summarizeArchitectureVisualSamples([make(40), broken]), /Invalid sampled criterion/)
})

test('only separate same-provider score ranges warrant a comparative finding', () => {
  const baseline = summarizeArchitectureVisualSamples([make(45), make(48), make(50)])
  const improved = summarizeArchitectureVisualSamples([make(60), make(62), make(64)])
  const regressed = summarizeArchitectureVisualSamples([make(25), make(29), make(30)])
  const overlapping = summarizeArchitectureVisualSamples([make(47), make(52), make(55)])
  assert.equal(compareArchitectureVisualSampleSummaries(improved, baseline), 'improved')
  assert.equal(compareArchitectureVisualSampleSummaries(regressed, baseline), 'regressed')
  assert.equal(compareArchitectureVisualSampleSummaries(overlapping, baseline), 'inconclusive')
  assert.equal(compareArchitectureVisualSampleSummaries(
    summarizeArchitectureVisualSamples([make(60, 'codex'), make(66, 'codex')]), baseline,
  ), 'inconclusive', 'model switching must not imply visual improvement')
})
