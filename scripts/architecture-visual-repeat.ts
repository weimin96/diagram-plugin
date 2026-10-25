/** Repeated isolated image reviews: variability is evidence, not approval. */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  architectureVisualCriteria, compareArchitectureVisualSampleSummaries, summarizeArchitectureVisualSamples,
  type ArchitectureVisualSample, type ArchitectureVisualSampleSummary,
  type ArchitectureVisualReviewEntry,
} from '../src/architectureVisualReview.js'

const flag = (key: string) => process.argv.find((item) => item.startsWith('--' + key + '='))?.slice(key.length + 3)
const manifestPath = path.resolve(flag('manifest') ?? 'test-results/architecture-design-project/manifest.json')
const directory = path.dirname(manifestPath)
const caseId = flag('case')
const count = Number(flag('samples') ?? 3)
if (!caseId || !/^[\w-]+$/.test(caseId)) throw new Error('Specify --case=<safe case ID>')
if (!Number.isInteger(count) || count < 2 || count > 5) throw new Error('--samples must be 2–5')
const output = path.resolve(flag('out') ?? path.join(directory, caseId + '.visual-repeat.json'))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
  version: number
  cases: Array<{ id: string; screenshot?: string; svg: string; evidence?: {
    screenshotSha256?: string; canvasSha256: string; svgSha256: string
  } }>
}
const source = manifest.cases.find((item) => item.id === caseId)
if (manifest.version !== 2 || !source?.screenshot || !source.evidence?.screenshotSha256) {
  throw new Error('Current evidence-bound Chrome screenshot required')
}
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
const snapshot = [
  [source.screenshot, source.evidence.screenshotSha256],
  [caseId + '.diagram.json', source.evidence.canvasSha256],
  [source.svg, source.evidence.svgSha256],
] as const
async function verifyEvidence() {
  for (const [file, expected] of snapshot) {
    if (sha(await readFile(path.join(directory, file))) !== expected)
      throw new Error('Pixel evidence changed during repeated review: ' + file)
  }
}
await verifyEvidence()
const cli = fileURLToPath(new URL('./architecture-visual-blind.ts', import.meta.url))
// Preserve previous raw reviews: a second calibration must never silently
// replace samples referenced by an earlier baseline report.
const samplesDir = path.join(directory, '.visual-repeat-samples', caseId, randomUUID())
await mkdir(samplesDir, { recursive: true })
const samples: ArchitectureVisualSample[] = []
const reviewFiles: string[] = []
for (let i = 0; i < count; i++) {
  const reviewPath = path.join(samplesDir, 'sample-' + (i + 1) + '.json')
  await promisify(execFile)(process.execPath, [
    '--import', 'tsx', cli, '--provider=dsh', '--manifest=' + manifestPath,
    '--case=' + caseId, '--out=' + reviewPath,
  ], { timeout: 220_000, maxBuffer: 512_000 })
  await verifyEvidence()
  const result = JSON.parse(await readFile(reviewPath, 'utf8')) as {
    provider: string; pixelToolVerified: string; reviews: ArchitectureVisualReviewEntry[]
  }
  if (result.provider !== 'dsh' || result.pixelToolVerified !== 'read_image tool_result completed'
    || result.reviews.length !== 1 || result.reviews[0].approval !== 'pending') {
    throw new Error('Invalid independent image proof for sample ' + (i + 1))
  }
  const review = result.reviews[0]
  const score = Math.round(Object.entries(architectureVisualCriteria).reduce((total, [name, criterion]) =>
    total + (review.ratings[name as keyof typeof architectureVisualCriteria].score as number)
      * criterion.weight / 5, 0) * 10) / 10
  samples.push({ id: review.id, provider: 'dsh-headless-read_image',
    screenshotSha256: review.screenshotSha256, canvasSha256: review.canvasSha256,
    svgSha256: review.svgSha256, score, ratings: review.ratings })
  reviewFiles.push(reviewPath)
  console.log('PIXEL_SAMPLE ' + (i + 1) + '/' + count + ': ' + score + '/100')
}
const summary = summarizeArchitectureVisualSamples(samples)
const baselinePath = flag('baseline')
let baseline: ArchitectureVisualSampleSummary | undefined
if (baselinePath) {
  if (path.resolve(baselinePath) === output) {
    throw new Error('Comparison report cannot overwrite its own baseline: use --out=<new path>')
  }
  const old = JSON.parse(await readFile(path.resolve(baselinePath), 'utf8')) as {
    kind: string; summary: ArchitectureVisualSampleSummary
  }
  if (old.kind !== 'diagram-repeated-pixel-review') throw new Error('Incompatible pixel review baseline')
  baseline = old.summary
}
const comparison = baseline ? compareArchitectureVisualSampleSummaries(summary, baseline) : null
const report = {
  kind: 'diagram-repeated-pixel-review', version: 1, manifest: manifestPath,
  reviewer: 'DSH headless via verified read_image', summary, comparison,
  reviewFiles, scores: samples.map((sample) => sample.score),
  note: 'Repeated model judgments are subjective, not human approval. Unlike-provider or overlapping ranges cannot establish improvement.',
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
const markdownFile = output.endsWith('.json') ? output.slice(0, -5) + '.md' : output + '.md'
const criteria = Object.entries(architectureVisualCriteria).map(([key, item]) => {
  const detail = summary.criteria[key as keyof typeof architectureVisualCriteria]
  return '| ' + item.label + ' | ' + detail.median + '/5 | ' + detail.minimum
    + '–' + detail.maximum + '/5 |'
})
const markdown = [
  '# 同一截图独立视觉重复评审',
  '实际 Chrome 截图：' + source.screenshot,
  '模型：DSH headless + 经校验的 read_image；' + count + ' 次隔离会话。',
  '评分：' + report.scores.join(' / ') + '。均值 ' + summary.mean + '，中位数 '
    + summary.median + '，区间 ' + summary.minimum + '–' + summary.maximum + '（极差 '
    + summary.range + '）。',
  summary.unstable ? '**波动过大，禁止使用单次评分推断改善。**'
    : '重复评分未超过预设的 10 分极差提醒线；仍不能自动认定为可靠人工评价。',
  '| 维度 | 中位数 | 观测区间 |', '|---|---:|---:|', ...criteria,
  comparison ? '与同模型基线比较：' + comparison : '尚无严格可比的同模型多次评分基线。',
  '各次评审完整的截图依据与问题清单保存在以下独立报告中：',
  ...reviewFiles.map((file) => '- ' + path.relative(path.dirname(markdownFile), file)),
  '**交付说明：** 该结果只衡量单模型感知评分波动；实际几何门禁、可编辑性和人工批准仍分别验收。',
].join('\n\n') + '\n'
await writeFile(markdownFile, markdown)
console.log('REPEATED_PIXEL_REVIEW', JSON.stringify({ ...summary, comparison, output }))
if (process.argv.includes('--fail-on-unstable') && summary.unstable) {
  console.error('Repeated model visual review is unstable (>10 point spread)')
  process.exitCode = 1
}
