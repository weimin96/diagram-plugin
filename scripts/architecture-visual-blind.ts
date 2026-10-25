/** Optional separate-process image-only visual review, inspired by codex-ppt.
 * The model sees ONLY the captured PNG and six criterion names, not source
 * files, structural metrics, the score baseline or the prior review.
 * Its result is attributed model opinion, not human acceptance.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { architectureVisualCriteria, evaluateArchitectureVisualReview,
  type ArchitectureVisualReviewEntry } from '../src/architectureVisualReview.js'

const flag = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const manifestFile = path.resolve(flag('manifest') ?? 'test-results/architecture-design-project/manifest.json')
const selectedId = flag('case')
const model = flag('model') ?? process.env.DIAGRAM_VISUAL_REVIEW_MODEL
if (!selectedId) throw new Error('Specify --case=<manifest case ID>; each call reviews one actual screenshot')
const directory = path.dirname(manifestFile)
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
  version: number
  cases: Array<{
    id: string; screenshot?: string; svg: string
    readyForVisualReview: boolean
    evidence?: { screenshotSha256?: string; canvasSha256: string; svgSha256: string }
  }>
}
if (manifest.version !== 2) throw new Error('Capture screenshot evidence with manifest v2 first')
const item = manifest.cases.find((candidate) => candidate.id === selectedId)
if (!item?.screenshot || !item.evidence?.screenshotSha256) {
  throw new Error('No real Chrome screenshot exists for this selected case')
}
const png = await readFile(path.join(directory, item.screenshot))
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const graphFile = await readFile(path.join(directory, `${selectedId}.diagram.json`))
const svgFile = await readFile(path.join(directory, item.svg))
if (hash(png) !== item.evidence.screenshotSha256 || hash(graphFile) !== item.evidence.canvasSha256
  || hash(svgFile) !== item.evidence.svgSha256) throw new Error('Screenshot or Canvas/SVG changed since capture')
const temp = await mkdtemp(path.join(os.tmpdir(), 'diagram-blind-vision-'))
try {
  await writeFile(path.join(temp, 'anonymous.png'), png)
  const required = Object.keys(architectureVisualCriteria)
  const rating = {
    type: 'object', additionalProperties: false, required: ['score', 'evidence'],
    properties: {
      score: { type: 'number', minimum: 0, maximum: 5, multipleOf: 0.5 },
      evidence: { type: 'string', minLength: 12 },
    },
  }
  const schema = {
    type: 'object', additionalProperties: false, required: ['ratings', 'summary', 'issues'],
    properties: {
      ratings: {
        type: 'object', additionalProperties: false, required,
        properties: Object.fromEntries(required.map((name) => [name, rating])),
      },
      summary: { type: 'string', minLength: 12 },
      issues: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['observation', 'suggestedFix'],
        properties: { observation: { type: 'string', minLength: 8 },
          suggestedFix: { type: 'string', minLength: 8 } } } },
    },
  }
  await writeFile(path.join(temp, 'schema.json'), JSON.stringify(schema))
  const prompt = `请作为新的独立图表视觉评价者，只依据附件中的真实浏览器 PNG 像素，评审一张架构图。
不得查看仓库、运行工具、推测未展示的依赖事实，也不知道任何算法、结构评分或之前的方案。
分别按 0–5 分（允许 0.5 分）评价六个维度：${required.map((name) =>
    `${name}=${architectureVisualCriteria[name as keyof typeof architectureVisualCriteria].label}`).join('；')}。
每个维度必须给出截图中实际看得到的正面与负面证据；看不清的内容应扣分，不得凭空给高分。
指出最重要的具体视觉缺陷和建议，但不要编造源码中的节点 ID。若截图本身很差，应如实打低分。
这是一项单次模型主观像素评价，不是人类验收，也不代表真实业务依赖正确。严格输出 JSON。若不能清楚看到像素，应失败而不是猜测。`
  const args = ['exec', '--skip-git-repo-check', '--ignore-user-config', '--ephemeral',
    '--sandbox', 'read-only', '--image', 'anonymous.png', '--output-schema', 'schema.json',
    '--output-last-message', 'judgment.json', ...(model ? ['--model', model] : []), '-']
  const child = spawn('codex', args, { cwd: temp, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.end(prompt)
  let error = ''
  child.stdout.on('data', () => { /* Avoid copying image review context or unrelated model text to stdout. */ })
  child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-2000) })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 180_000)
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (value) => resolve(value ?? 1))
  }).finally(() => clearTimeout(timer))
  if (code) throw new Error(`Independent image-only review failed: ${timedOut ? 'timeout' : error.slice(-450)}`)
  const assessment = JSON.parse(await readFile(path.join(temp, 'judgment.json'), 'utf8')) as {
    ratings: ArchitectureVisualReviewEntry['ratings']; summary: string
    issues: Array<{ observation: string; suggestedFix: string }>
  }
  const result: ArchitectureVisualReviewEntry = {
    id: item.id, ...item.evidence, screenshotSha256: item.evidence.screenshotSha256,
    reviewer: model ? `Codex isolated pixel reviewer (${model})` : 'Codex isolated pixel reviewer (default model)',
    reviewMode: 'independent-vision', approval: 'pending',
    ratings: assessment.ratings, summary: assessment.summary,
    issues: assessment.issues.map((issue) => ({ ...issue, elementIds: [] })),
  }
  const graph = JSON.parse(graphFile.toString('utf8')) as { elements: Array<{ id: string }> }
  const validated = evaluateArchitectureVisualReview({
    id: item.id, ...item.evidence, readyForVisualReview: item.readyForVisualReview,
  }, result, new Set(graph.elements.map((element) => element.id)))
  const outputFile = path.resolve(flag('out') ?? path.join(directory, `${item.id}.model-review.json`))
  await mkdir(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, JSON.stringify({
    kind: 'diagram-independent-pixel-review', version: 1,
    limitations: 'Single fresh image-only model opinion; no human sign-off; geometric gating remains separate.',
    reviews: [result],
  }, null, 2) + '\n')
  console.log('PIXEL_REVIEW', JSON.stringify({
    caseId: item.id, model: model ?? 'Codex default', score: validated.perceptualScore,
    geometryBlocked: validated.state === 'geometry-blocked', outputFile,
  }))
} finally {
  await rm(temp, { recursive: true, force: true })
}
