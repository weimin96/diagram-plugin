import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { architecturePartitionFlow } from '../src/architecturePartitionFlow.js'
import { canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { projectArchitectureCase } from './architecture-project-cases.js'

const outputFlag = process.argv.indexOf('--out')
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) throw new Error('--out expects a destination directory')
const suiteFlag = process.argv.find((arg) => arg.startsWith('--suite='))
const suiteName = suiteFlag?.slice('--suite='.length) ?? 'core'
if (!['core', 'extended', 'stress', 'project'].includes(suiteName)) throw new Error('Unknown benchmark suite')
const suite = suiteName as 'core' | 'extended' | 'stress' | 'project'
const requireReviewReady = process.argv.includes('--require-review-ready')
const output = path.resolve(outputFlag < 0
  ? `test-results/architecture-benchmark${suite === 'core' ? '' : '-' + suite}`
  : process.argv[outputFlag + 1])
await mkdir(output, { recursive: true })

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
))

const results = []
const examples = suite === 'project' ? [await projectArchitectureCase()] : architectureBenchmarkCases(suite)
for (const example of examples) {
  const started = performance.now()
  const composed = composeArchitectureGraph(example.intent)
  const partitionFlow = architecturePartitionFlow(composed.scene)
  const routeDiagnostics = composed.routeDiagnostics
  const elapsedMs = Math.round(performance.now() - started)
  const svg = canvasSceneToSvg(composed.scene)
  await writeFile(path.join(output, `${example.id}.diagram.json`), serializeCanvasScene(composed.scene))
  await writeFile(path.join(output, `${example.id}.svg`), svg)
  results.push({
    id: example.id,
    title: example.intent.title,
    description: example.description,
    source: example.source,
    nodes: example.intent.nodes.length,
    relations: example.intent.relations.length,
    composition: composed.summary.composition,
    density: composed.evaluation.density,
    structuralScore: composed.evaluation.structuralScore,
    inputOrderStrategy: composed.inputOrderStrategy,
    layoutOrderingStrategy: composed.layoutOrderingStrategy,
    presentation: composed.presentation,
    visualPlan: composed.visualPlan,
    partitionFlow: {
      stages: partitionFlow.steps.map((step) => step.id),
      crossPartitionRelations: partitionFlow.crossPartitionRelations,
      internalRelations: partitionFlow.internalRelations,
    },
    routeDiagnostics,
    reroutedEdges: composed.reroutedEdges,
    aspectRatio: composed.evaluation.aspectRatio,
    metrics: composed.quality.metrics,
    issues: composed.quality.issues.map(({ code, severity, message }) => ({ code, severity, message })),
    elapsedMs,
  })
}

const blockedReviewCases = results.filter((result) => !result.visualPlan.review.readyForVisualReview)
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 2,
  suite,
  source: suite === 'project'
    ? 'Diagram Plugin source imports; scoped module subgraph, not fictional and not complete runtime dependencies'
    : 'deterministic fictional reference and synthetic graphs',
  reviewReadiness: {
    status: blockedReviewCases.length ? 'blocked' : 'awaiting-human-review',
    blockedCases: blockedReviewCases.map((result) => result.id),
    blockersByCase: Object.fromEntries(blockedReviewCases.map((result) => [result.id, result.visualPlan.review.blockers])),
    note: 'Eligibility for visual review is not human approval or delivery certification.',
  },
  results,
}, null, 2) + '\n')
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architecture Generation Benchmark</title>
<style>
* {box-sizing:border-box} body{margin:0;background:#f3f5f8;color:#18212b;font-family:system-ui,-apple-system,sans-serif}
main{max-width:1480px;margin:0 auto;padding:24px 32px 48px}h1{font-size:25px;margin:0 0 6px}p{color:#637181;margin:0}
section{margin-top:22px;padding:20px;background:white;border:1px solid #e2e8f0;border-radius:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:14px}
h2{font-size:18px;margin:0 0 4px}small{color:#637181}.stats{display:flex;gap:12px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.stats span{background:#f1f5f9;border-radius:6px;padding:6px 9px;font-size:12px}
img{display:block;width:100%;height:auto;background:#f8fafc;border:1px solid #e4e9ee;border-radius:8px}
.issues{margin:12px 0 0;color:#765322;font-size:12px}
</style></head><body><main><h1>系统架构图生成基准</h1>
<p>${suite === 'project' ? '来源为 Diagram Plugin 真实 TypeScript 静态导入关系的选定模块子图，不代表全工程运行依赖。' : '以下均为虚构参考系统。'} 结构评分上限 90，仅用于对比布局、碰撞和连线；人工视觉质量仍需审查。</p>
${results.map((result) => `<section><header><div><h2>${escapeHtml(result.title)}</h2>
<small>${escapeHtml(result.description)}</small></div><div class="stats">
<span>${result.composition}</span><span>${result.density}</span>
<span>输入顺序：${result.inputOrderStrategy}</span>
<span>布局排序：${result.layoutOrderingStrategy}</span>
<span>${escapeHtml(result.visualPlan.reference.label)} · ${result.visualPlan.recommendedView === 'overview' ? '先看总览' : '直接查看详情'}</span>
<span>${result.nodes} 节点 / ${result.relations} 关系</span>
<span>${result.structuralScore} / 90</span>
<span>${result.visualPlan.review.readyForVisualReview ? '待人工视觉审查' : '阻断视觉审查'}</span>
<span>适配字号约 ${result.presentation.estimatedTitlePxAtFit}px</span>
<span>交叉 ${result.metrics.edgeCrossings} · 重叠 ${result.metrics.edgeOverlaps} · 穿节点 ${result.metrics.edgeNodeIntersections}</span>
<span>跨分区 ${result.partitionFlow.crossPartitionRelations}</span>
<span>跨区线长 ${result.routeDiagnostics.crossPartitionRouteLength}px · 逆向 ${result.routeDiagnostics.backwardCrossPartitionRelations} · 分区冲突 ${result.routeDiagnostics.frameOverlaps}</span>
</div></header><img src="./${result.id}.svg" loading="lazy" alt="${escapeHtml(result.title)}">
${result.issues.length || result.presentation.warnings.length ? `<p class="issues">${[...result.issues.map(({ code }) => code), ...result.presentation.warnings].map(escapeHtml).join(' · ')}</p>` : ''}</section>`).join('\n')}
</main></body></html>`)

console.table(results.map(({ id, nodes, relations, structuralScore, metrics, reroutedEdges, elapsedMs }) => ({
  id, nodes, relations, score: structuralScore, crossings: metrics.edgeCrossings,
  overlaps: metrics.edgeOverlaps, throughNodes: metrics.edgeNodeIntersections,
  reroutes: reroutedEdges, elapsedMs,
})))
console.log(`Visual benchmark: ${path.join(output, 'index.html')}`)
console.log(`Visual review eligibility: ${blockedReviewCases.length ? `blocked (${blockedReviewCases.map((result) => result.id).join(', ')})` : 'all cases awaiting human review'}`)
if (results.some(({ metrics }) => metrics.nodeOverlaps || metrics.edgeNodeIntersections)) {
  process.exitCode = 1
  console.error('Architecture benchmark failed: at least one scenario has node overlaps or edges passing through nodes.')
}
if (requireReviewReady && blockedReviewCases.length) {
  process.exitCode = 1
  console.error('Architecture visual-review gate failed:', blockedReviewCases
    .map((item) => `${item.id}: ${item.visualPlan.review.blockers.join(', ')}`).join('; '))
}
