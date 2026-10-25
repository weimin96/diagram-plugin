import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { draftArchitectureVisualReview } from '../src/architectureVisualReview.js'

const invoke = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/architecture-visual-score.ts', import.meta.url))
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fQAAAABJRU5ErkJggg==', 'base64')

test('CLI requires real pixel evidence, records attributed six-axis scores and detects stale artifacts/regressions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-visual-score-test-'))
  try {
    const scene = Buffer.from(JSON.stringify({ type: 'diagram-plugin-canvas', version: 1, elements: [
      { id: 'source', type: 'node' }, { id: 'target', type: 'node' },
      { id: 'edge', type: 'arrow', from: 'source', to: 'target' },
    ] }))
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    await writeFile(path.join(root, 'fixture.diagram.json'), scene)
    await writeFile(path.join(root, 'fixture.svg'), svg)
    await writeFile(path.join(root, 'fixture.png'), image)
    const evidence = {
      screenshotSha256: digest(image), canvasSha256: digest(scene), svgSha256: digest(svg),
    }
    const manifest = path.join(root, 'manifest.json')
    await writeFile(manifest, JSON.stringify({ version: 2, cases: [
      { id: 'fixture', svg: 'fixture.svg', screenshot: 'fixture.png',
        readyForVisualReview: false, evidence },
    ] }))
    const review = draftArchitectureVisualReview({ id: 'fixture', ...evidence, readyForVisualReview: false })
    review.reviewer = 'QA screenshot reviewer'
    review.summary = '源节点与目标节点在渲染区域可辨认，仍有线路问题。'
    for (const rating of Object.values(review.ratings)) {
      rating.score = 4
      rating.evidence = '实测像素截图中，文字间距适当但仍有可见的局部缺陷。'
    }
    const reviewFile = path.join(root, 'review.json')
    await writeFile(reviewFile, JSON.stringify({ reviews: [review] }))
    const output = path.join(root, 'score.json')
    const args = [script, `--manifest=${manifest}`, `--review=${reviewFile}`, `--out=${output}`, '--require-reviewed']
    await invoke(process.execPath, ['--import', 'tsx', ...args])
    const baseline = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(baseline.meanPerceptualScore, 80)
    assert.deepEqual(baseline.geometryBlocked, ['fixture'])
    const readable = await readFile(path.join(root, 'score.md'), 'utf8')
    assert.match(readable, /80\/100/)
    assert.match(readable, /几何门禁阻断/)
    assert.match(readable, /真实像素观察/)
    review.ratings.traceability.score = 2
    await writeFile(reviewFile, JSON.stringify({ reviews: [review] }))
    await assert.rejects(invoke(process.execPath, ['--import', 'tsx', ...args,
      `--baseline=${output}`, '--fail-on-regression']), /Command failed/)
    // The report remains auditable even when the comparison gate fails.
    assert.equal(JSON.parse(await readFile(output, 'utf8')).regressions[0].delta, -10)
    await writeFile(path.join(root, 'fixture.png'), Buffer.concat([image, Buffer.from('new-pixels')]))
    await assert.rejects(invoke(process.execPath, ['--import', 'tsx', ...args]), /Command failed/)
    const draftFile = path.join(root, 'draft.json')
    await writeFile(path.join(root, 'fixture.png'), image)
    await writeFile(draftFile, JSON.stringify({ reviews: [
      draftArchitectureVisualReview({ id: 'fixture', ...evidence, readyForVisualReview: false }),
    ] }))
    await assert.rejects(invoke(process.execPath, ['--import', 'tsx', script,
      `--manifest=${manifest}`, `--review=${draftFile}`, '--require-reviewed']), /Command failed/)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).meanPerceptualScore, 70,
      'missing review cannot be silently conflated with the previous scored report')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
