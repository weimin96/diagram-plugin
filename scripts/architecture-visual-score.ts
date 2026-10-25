import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  architectureVisualCriteria, compareArchitectureVisualScores, evaluateArchitectureVisualReview,
  type ArchitectureVisualReviewEntry, type ArchitectureVisualScoreResult,
} from '../src/architectureVisualReview.js'

const argument = (key: string) => process.argv.find((item) => item.startsWith(`--${key}=`))?.slice(key.length + 3)
const manifestFile = path.resolve(argument('manifest') ?? 'test-results/architecture-design-review/manifest.json')
const directory = path.dirname(manifestFile)
const reviewFile = argument('review')
const outputFile = path.resolve(argument('out') ?? path.join(directory, 'visual-scores.json'))
const baselineFile = argument('baseline')
const requireReviewed = process.argv.includes('--require-reviewed')
const requireHumanApproval = process.argv.includes('--require-human-approval')
const failOnRegression = process.argv.includes('--fail-on-regression')
if (failOnRegression && !baselineFile) throw new Error('--fail-on-regression requires --baseline')

const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
  version: number
  cases: Array<{
    id: string
    svg: string
    screenshot?: string
    readyForVisualReview: boolean
    evidence?: { screenshotSha256?: string; canvasSha256: string; svgSha256: string }
  }>
}
if (manifest.version !== 2 || !Array.isArray(manifest.cases)) {
  throw new Error('Scored visual review requires evidence-bound architecture manifest v2; recapture using --screenshots')
}
const reviewDocument = reviewFile ? JSON.parse(await readFile(path.resolve(reviewFile), 'utf8')) as {
  reviews: ArchitectureVisualReviewEntry[]
} : undefined
if (reviewDocument && !Array.isArray(reviewDocument.reviews)) throw new Error('Invalid review document')
const reviews = new Map<string, ArchitectureVisualReviewEntry>()
for (const review of reviewDocument?.reviews ?? []) {
  if (typeof review.id !== 'string' || reviews.has(review.id)) throw new Error('Duplicate or invalid case review')
  reviews.set(review.id, review)
}
const results: ArchitectureVisualScoreResult[] = []
for (const item of manifest.cases) {
  if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || !item.evidence) throw new Error('Invalid case or missing source hashes')
  const expected = item.evidence
  const actualSvg = hash(await readFile(path.join(directory, item.svg)))
  const actualCanvas = hash(await readFile(path.join(directory, `${item.id}.diagram.json`)))
  if (actualSvg !== expected.svgSha256 || actualCanvas !== expected.canvasSha256) {
    throw new Error(`Stale rendered artifacts for ${item.id}: SVG/Canvas changed since capture`)
  }
  if (reviews.has(item.id) && !item.screenshot) {
    throw new Error(`Cannot score ${item.id} without actual Chrome screenshot pixels`)
  }
  if (item.screenshot) {
    const png = await readFile(path.join(directory, item.screenshot))
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`Screenshot for ${item.id} is not a PNG`)
    }
    const actualScreenshot = hash(png)
    if (actualScreenshot !== expected.screenshotSha256) {
      throw new Error(`Stale Chrome screenshot for ${item.id}: recapture before reviewing`)
    }
  }
  const graph = JSON.parse(await readFile(path.join(directory, `${item.id}.diagram.json`), 'utf8')) as {
    elements: Array<{ id: string }>
  }
  const ids = new Set(graph.elements.map((element) => element.id))
  results.push(evaluateArchitectureVisualReview({
    id: item.id, ...expected, readyForVisualReview: item.readyForVisualReview,
  }, reviews.get(item.id), ids))
  reviews.delete(item.id)
}
if (reviews.size) throw new Error(`Review contains unknown case(s): ${[...reviews.keys()].join(', ')}`)
const countReviewed = results.filter((item) => item.perceptualScore !== null).length
const scoreValues = results.flatMap((item) => item.perceptualScore === null ? [] : [item.perceptualScore])
const baseline = baselineFile
  ? JSON.parse(await readFile(path.resolve(baselineFile), 'utf8')) as {
      kind: string; results: ArchitectureVisualScoreResult[]
    }
  : undefined
if (baseline && (baseline.kind !== 'diagram-perceptual-review' || !Array.isArray(baseline.results))) {
  throw new Error('Visual baseline must be a prior validated perceptual review report')
}
const regressions = baseline ? compareArchitectureVisualScores(results, baseline.results) : []
const report = {
  kind: 'diagram-perceptual-review', version: 1,
  sourceManifest: manifestFile,
  reviewSource: reviewFile ? path.resolve(reviewFile) : null,
  criteria: architectureVisualCriteria,
  totalCases: results.length,
  reviewedCases: countReviewed,
  /** Deliberately null until a real reviewer scores at least one screenshot. */
  meanPerceptualScore: scoreValues.length
    ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length * 10) / 10 : null,
  geometryBlocked: results.filter((item) => item.state === 'geometry-blocked').map((item) => item.id),
  unreviewed: results.filter((item) => item.state === 'unreviewed').map((item) => item.id),
  humanApproved: results.filter((item) => item.humanApproved).map((item) => item.id),
  regressions,
  results,
}
await mkdir(path.dirname(outputFile), { recursive: true })
await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n')
const markdownFile = outputFile.endsWith('.json') ? outputFile.slice(0, -5) + '.md' : outputFile + '.md'
const markdownLine = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const caption = report.meanPerceptualScore === null
  ? '未评分：尚无绑定当前截图的完整视觉评价。' : `已评价 ${countReviewed}/${results.length} 张；已评价部分的平均分 ${report.meanPerceptualScore}/100。`
const markdown = [
  '# 图表像素视觉评分',
  `证据：${manifestFile}`,
  '此分数由有归属的人工或独立模型像素评审提供，**不是** Canvas 结构评分，也不代表正式人工批准。',
  caption,
  ...results.flatMap((item) => {
    const source = manifest.cases.find((entry) => entry.id === item.id)!
    const state = item.humanApproved ? '人工批准' : item.state === 'geometry-blocked' ? '几何门禁阻断'
      : item.state === 'unreviewed' ? '尚未评分' : '已评分但未人工批准'
    return [
      `## ${item.id}：${item.perceptualScore === null ? '未评分' : `${item.perceptualScore}/100`} · ${state}`,
      `证据指纹：PNG ${item.screenshotSha256 ?? '未提供'}；Canvas ${item.canvasSha256}`,
      source.screenshot ? `![Chrome 实际渲染图](./${source.screenshot})` : '本案例没有真实 Chrome 截图。',
      `评审人：${item.reviewer ?? '无'}；类型：${item.reviewMode ?? '无'}`,
      [
        '| 维度 | 权重 | 分值 | 真实像素观察 |',
        '|---|---:|---:|---|',
        ...Object.entries(architectureVisualCriteria).map(([name, rule]) =>
          `| ${rule.label} | ${rule.weight}% | ${item.criteria[name as keyof typeof architectureVisualCriteria].score ?? '—'}/5 | ${markdownLine(item.criteria[name as keyof typeof architectureVisualCriteria].evidence)} |`),
      ].join('\n'),
      item.summary ? `评审摘要：${item.summary}` : '评审摘要：尚无真实评分。',
      ...item.issues.map((issue) =>
        `- 观察：${issue.observation}；建议：${issue.suggestedFix}${issue.elementIds.length ? `（元素：${issue.elementIds.join('、')}）` : ''}`),
    ]
  }),
  ...(regressions.length ? ['## 相对基线的视觉回退', ...regressions.map((item) =>
    `- ${item.id}：${item.before} → ${item.after}（${item.delta} 分）`)] : []),
].join('\n\n')
await writeFile(markdownFile, markdown + '\n')
console.log('VISUAL_SCORE', JSON.stringify({
  reviewed: `${countReviewed}/${results.length}`,
  mean: report.meanPerceptualScore ?? 'unscored',
  geometryBlocked: report.geometryBlocked, regressions,
  outputFile, markdownFile,
}))
if (requireReviewed && countReviewed !== results.length) {
  console.error('Visual review incomplete: real screenshot-based ratings are required')
  process.exitCode = 1
}
if (requireHumanApproval && results.some((item) => !item.humanApproved)) {
  console.error('Delivery blocked: current screenshot, geometric eligibility and explicit HUMAN approval are all required')
  process.exitCode = 1
}
if (failOnRegression && regressions.length) {
  console.error('Visual score regression exceeds five points for the same case')
  process.exitCode = 1
}

function hash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}
