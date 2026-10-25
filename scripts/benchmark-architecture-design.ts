import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { architectureCases } from '../tests/fixtures/architecture/cases.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { projectArchitectureCase } from './architecture-project-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'
import { draftArchitectureVisualReview } from '../src/architectureVisualReview.js'

/** Expert review template: none of the boxes are pre-checked or AI-scored. */
const humanChecklist = [
  '架构实体、边界和依赖方向有明确事实依据',
  '五秒内能够定位入口、关键链路和下游',
  '场景专用阅读方向与系统运行逻辑一致',
  '主次层级、留白、图元及字号适合正式文档',
  '跨区连线不干扰主要业务信息',
  'Canvas 可编辑，SVG 在目标尺寸下清晰可读',
]
const extended = process.argv.includes('--extended')
const projectMode = process.argv.includes('--project')
const ids = projectMode ? ['diagram-plugin-source-imports'] : [
  'business-platform', 'microservices', 'data-platform',
  ...(extended ? ['microservices-fanout', 'data-platform-fanout', 'deployment-fanout'] : []),
]
const referenceCases = projectMode ? [await projectArchitectureCase()]
  : extended ? architectureBenchmarkCases('extended') : architectureCases
const captureScreenshots = process.argv.includes('--screenshots')
const output = path.resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? (projectMode ? 'test-results/architecture-design-project' : 'test-results/architecture-design-review'))
await mkdir(output, { recursive: true })
const chrome = captureScreenshots ? await findChrome() : undefined
if (captureScreenshots && !chrome) throw new Error('截图验收需要本地 Chrome/Chromium，当前未找到浏览器。')
const cases = []
for (const id of ids) {
  const sample = referenceCases.find((item) => item.id === id)!
  const started = performance.now()
  const result = composeArchitectureGraph(sample.intent)
  const elapsedMs = Math.round(performance.now() - started)
  const file = `${id}.svg`
  await writeFile(path.join(output, file), canvasSceneToSvg(result.scene))
  await writeFile(path.join(output, `${id}.diagram.json`), serializeCanvasScene(result.scene))
  const screenshot = captureScreenshots ? `${id}.png` : undefined
  if (screenshot && chrome) await captureDiagramScreenshot(chrome, output, file, screenshot)
  const evidence = {
    canvasSha256: sha256(await readFile(path.join(output, `${id}.diagram.json`))),
    svgSha256: sha256(await readFile(path.join(output, file))),
    ...(screenshot ? { screenshotSha256: sha256(await readFile(path.join(output, screenshot))) } : {}),
  }
  cases.push({
    id,
    label: projectMode ? sample.intent.title
      : `${result.visualPlan.reference.label}${id.endsWith('-fanout') ? ' · 合成高扇出' : ''}`,
    source: projectMode ? 'project-source-imports'
      : id.endsWith('-fanout') ? 'synthetic' : 'fictional-reference',
    scenario: result.visualPlan.scenario,
    readingPattern: result.visualPlan.reference.readingPattern,
    priorities: result.visualPlan.reference.priorities,
    antiPatterns: result.visualPlan.reference.antiPatterns,
    recommendedView: result.visualPlan.recommendedView,
    primaryNodeIds: result.visualPlan.primaryNodeIds,
    concerns: result.visualPlan.review.concerns,
    repairTargets: result.visualPlan.review.repairTargets,
    readyForVisualReview: result.visualPlan.review.readyForVisualReview,
    reviewBlockers: result.visualPlan.review.blockers,
    presentation: result.presentation,
    quality: result.quality.metrics,
    elapsedMs,
    evidence,
    svg: file,
    ...(screenshot ? { screenshot } : {}),
  })
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  version: 2, source: projectMode ? 'scoped-real-TypeScript-imports'
    : extended ? 'fictional-reference-and-synthetic' : 'fictional-reference', rubric: humanChecklist,
  note: 'Browser screenshot capture is visual evidence, not an automatic aesthetic judgment. All human checkboxes are intentionally empty.',
  cases,
}, null, 2) + '\n')
const draftPath = path.join(output, 'review-draft.json')
const existingDraft = await readFile(draftPath, 'utf8').then((value) => JSON.parse(value) as {
  reviews?: Array<{ reviewer?: string; summary?: string; ratings?: Record<string, { score?: number | null }> }>
}, () => null)
// A recapture should invalidate old evidence, not silently erase reviews the
// user has already started. The reviewer can copy the draft to a new path.
const startedReview = existingDraft?.reviews?.some((entry) =>
  Boolean(entry.reviewer?.trim() || entry.summary?.trim()
    || Object.values(entry.ratings ?? {}).some((rating) => rating.score !== null && rating.score !== undefined)))
if (!startedReview) await writeFile(draftPath, JSON.stringify({
  kind: 'diagram-visual-review-draft', version: 1,
  note: 'Unscored by design. Inspect the actual Chrome PNG, fill all six scores (0..5), each with concrete evidence, reviewer identity, summary and actual element-linked issues. Scores are not derived from structural metrics.',
  reviews: cases.map((item) => draftArchitectureVisualReview({
    id: item.id, ...item.evidence, readyForVisualReview: item.readyForVisualReview,
  })),
}, null, 2) + '\n')
else console.warn('Existing edited review-draft.json preserved; old fingerprint may be stale. Copy or recapture before scoring.')
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>架构图视觉审查</title>
<style>body{margin:0;background:#f4f6f8;color:#1d2732;font:14px/1.6 system-ui,sans-serif}main{max-width:1300px;margin:auto;padding:32px}h1{font-size:25px;margin:0 0 6px}p{color:#536474}section{background:white;border:1px solid #dce2e8;border-radius:12px;margin:24px 0;padding:22px}h2{font-size:19px;margin:0 0 5px}.preview{width:100%;height:auto;display:block}.metadata{font-size:12px;color:#536474;margin:10px 0}.questions{margin:12px 0 0;padding-left:20px}a{color:#135a9c}</style>
<main><h1>架构图视觉验收</h1><p>${projectMode ? '这是 Diagram Plugin 核心模块的实际 TypeScript 静态导入子图，不代表完整运行时依赖。' : '以下是虚构系统的真实 Canvas SVG 导出。'}${captureScreenshots ? ' 已生成 Chrome 截图。' : ''} 截图不代表已经完成视觉审美评价，人工检查保持未勾选。</p>
${cases.map((item) => `<section><h2>${item.label}</h2><div class="metadata">${item.readingPattern} · 交叉 ${item.quality.edgeCrossings} · 关系线重叠 ${item.quality.edgeOverlaps} · 适配字号 ${item.presentation.estimatedTitlePxAtFit}px</div><img class="preview" src="${item.screenshot ?? item.svg}" alt="${item.label}"><p><a href="${item.svg}">SVG</a> · <a href="${item.id}.diagram.json">可编辑 Canvas JSON</a></p><strong>人工观察</strong><ul class="questions">${humanChecklist.map((question) => `<li>□ ${question}</li>`).join('')}</ul></section>`).join('')}
</main></html>\n`)
const markdown = ['# 专业架构图视觉验收',
  projectMode ? '案例来自当前仓库实际 TypeScript 静态 import，限定核心模块子图。不能推断完整运行时依赖；自动检查未通过也不应强制通过。人工视觉评价保持未勾选。'
    : '案例来自虚构参考系统及明确标识的合成压力图。结构检测自动完成，以下视觉评价必须由人实际查看后勾选。',
  ...cases.flatMap((item) => [
    `## ${item.label}`,
    `阅读路径：${item.readingPattern}`,
    `![${item.label}](./${item.svg})`,
    `自动几何：交叉 ${item.quality.edgeCrossings} / 重叠 ${item.quality.edgeOverlaps} / 穿节点 ${item.quality.edgeNodeIntersections}`,
    `1200px 适配字号：${item.presentation.estimatedTitlePxAtFit}px；建议初始视图：${item.recommendedView}`,
    '专业构图重点：',
    ...item.priorities.map((s) => `- ${s}`),
    '需要避免：',
    ...item.antiPatterns.map((s) => `- ${s}`),
    '人工检查：',
    ...humanChecklist.map((s) => `- [ ] ${s}`),
    '待修正问题：',
    ...item.repairTargets.map((target) => `- [ ] ${target.concern}：${target.action}（目标：${target.elementIds.join(', ') || '整个视图'}）`),
    '',
  ]),
].join('\n\n')
await writeFile(path.join(output, 'review.md'), markdown + '\n')
console.table(cases.map((item) => ({
  scenario: item.label, mainNodes: item.primaryNodeIds.length,
  crossings: item.quality.edgeCrossings, overlaps: item.quality.edgeOverlaps,
  fitFont: item.presentation.estimatedTitlePxAtFit, ms: item.elapsedMs,
})))
console.log(`Review report: ${path.join(output, 'review.md')}`)
console.log(`Visual gallery: ${path.join(output, 'index.html')}`)
console.log(`Unscored pixel review template: ${path.join(output, 'review-draft.json')}`)
if (cases.some((item) => !item.readyForVisualReview)) {
  console.error('Human visual sign-off blocked:', cases.filter((item) => !item.readyForVisualReview)
    .map((item) => `${item.id}: ${item.reviewBlockers.join(', ')}`).join('; '))
  process.exitCode = 1
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function findChrome(): Promise<string | undefined> {
  const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Try the next installed browser. */ }
  }
  return undefined
}

async function captureDiagramScreenshot(chromePath: string, directory: string, svg: string, png: string): Promise<void> {
  const browserProfile = await mkdtemp(path.join(os.tmpdir(), 'diagram-visual-review-'))
  const htmlPath = path.join(directory, `${path.basename(svg, '.svg')}.capture.html`)
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#eef2f6;padding:24px}main{height:900px;display:flex;align-items:center;justify-content:center;background:white;border:1px solid #dce3eb;border-radius:8px}img{display:block;width:100%;height:100%;object-fit:contain}
  </style><main><img src="./${svg}"></main></html>`
  await writeFile(htmlPath, html)
  try {
    await promisify(execFile)(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
      `--user-data-dir=${browserProfile}`, '--hide-scrollbars', '--window-size=1280,960', '--virtual-time-budget=1500',
      `--screenshot=${path.join(directory, png)}`, pathToFileURL(htmlPath).href], { timeout: 30000, maxBuffer: 2_000_000 })
    await access(path.join(directory, png))
  } finally {
    await rm(htmlPath, { force: true })
    await rm(browserProfile, { recursive: true, force: true })
  }
}
