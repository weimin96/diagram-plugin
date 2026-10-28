import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { architecturePartitionFlow } from '../src/architecturePartitionFlow.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'
import { canvasBundleTrunks, canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { projectArchitectureCase, projectArchitectureCases } from './architecture-project-cases.js'
import { externalArchitectureSourceCases, parseExternalRepoArgs } from './architecture-external-source-cases.js'
import { loadArchitectureReviewedTasks } from './architecture-reviewed-tasks.js'
import { proposePartitionEnvelopeLayout } from './partition-envelope-candidate.js'
import { compareEditableArchitectureSemantics, judgeExternalLayout, measureEditableArchitecture } from './architecture-layout-gate.js'
import { measureArchitectureLayoutDemand } from './architecture-layout-demand.js'
import { attributeArchitectureCorridorConflicts } from './architecture-corridor-conflicts.js'

const outputFlag = process.argv.indexOf('--out')
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) throw new Error('--out expects a destination directory')
const suiteFlag = process.argv.find((arg) => arg.startsWith('--suite='))
const suiteName = suiteFlag?.slice('--suite='.length) ?? 'core'
if (!['core', 'extended', 'stress', 'project', 'project-multi', 'external', 'reviewed'].includes(suiteName)) throw new Error('Unknown benchmark suite')
const suite = suiteName as 'core' | 'extended' | 'stress' | 'project' | 'project-multi' | 'external' | 'reviewed'
const repositories = parseExternalRepoArgs(process.argv.slice(2))
const taskFile = process.argv.find((arg) => arg.startsWith('--tasks='))?.slice('--tasks='.length)
const reviewFile = process.argv.find((arg) => arg.startsWith('--review-ledger='))?.slice('--review-ledger='.length)
if (((suite === 'external' || suite === 'reviewed') !== (repositories.length > 0))
  || (suite === 'reviewed') !== !!taskFile || (reviewFile && suite !== 'reviewed')) {
  throw new Error('External/reviewed suites require explicit --repo=label:/absolute/path; reviewed also requires --tasks=/absolute/path')
}
const requireReviewReady = process.argv.includes('--require-review-ready')
const partitionEnvelopeExperiment = process.argv.includes('--partition-envelopes')
const referenceSideSpanArg = process.argv.find((arg) => arg.startsWith('--reference-side-span='))?.slice('--reference-side-span='.length)
// An explicit what-if reference only: no node sizes have been assigned yet.
const referenceSideSpanPx = referenceSideSpanArg === undefined ? 80 : Number(referenceSideSpanArg)
if (!Number.isFinite(referenceSideSpanPx) || referenceSideSpanPx <= 0 || referenceSideSpanPx > 1000) {
  throw new Error('--reference-side-span must be a positive number <= 1000')
}
const output = path.resolve(outputFlag < 0
  ? `test-results/architecture-benchmark${suite === 'core' ? '' : '-' + suite}`
  : process.argv[outputFlag + 1])
await mkdir(output, { recursive: true })

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
))

const results = []
const partitionCandidates: Array<{
  id: string; axis: 'horizontal' | 'vertical' | 'least-growth'; eligible: boolean;
  reasons: string[]; originalFrameArea: number; candidateFrameArea: number;
  originalRouteLength: number; candidateRouteLength: number;
  originalCanvas: [number, number]; candidateCanvas: [number, number];
}> = []
const examples = suite === 'project' ? [await projectArchitectureCase()]
  : suite === 'project-multi' ? await projectArchitectureCases()
    : suite === 'external' ? (await Promise.all(repositories.map((repo) =>
      externalArchitectureSourceCases(repo.label, repo.root)))).flat()
      : suite === 'reviewed' ? (await loadArchitectureReviewedTasks(taskFile!,
        new Map(repositories.map((repo) => [repo.label, repo.root])), reviewFile)).cases.map((item) => ({
        id: item.id, source: 'project' as const, description: item.purpose,
        intent: item.intent,
        provenance: { repository: item.repository, reviewAttested: item.reviewAttested,
          readingGoal: item.readingGoal, taskManifestSha256: item.evidenceDigest },
      }))
      : architectureBenchmarkCases(suite)
if ((suite === 'external' || suite === 'reviewed') && !examples.length) {
  throw new Error('No verifiable architecture tasks were found in explicitly supplied inputs')
}
for (const example of examples) {
  const demand = measureArchitectureLayoutDemand(example.intent, referenceSideSpanPx)
  const started = performance.now()
  const composed = composeArchitectureGraph(example.intent)
  const corridorConflicts = attributeArchitectureCorridorConflicts(
    example.intent, composed.scene, demand, composed.quality.issues)
  const partitionFlow = architecturePartitionFlow(composed.scene)
  const routeDiagnostics = composed.routeDiagnostics
  if (partitionEnvelopeExperiment && routeDiagnostics.frameOverlapArea > 0) {
    const baseline = measureEditableArchitecture(composed.scene)
    for (const axis of ['horizontal', 'vertical', 'least-growth'] as const) {
      const candidate = proposePartitionEnvelopeLayout(composed.scene, axis)
      if (!candidate) continue
      const measured = measureEditableArchitecture(candidate)
      const verdict = judgeExternalLayout(baseline, measured)
      const fidelity = compareEditableArchitectureSemantics(composed.scene, candidate)
      const exactCanvas = candidate.width === composed.scene.width && candidate.height === composed.scene.height
      const candidateRoutes = assessArchitectureRouteDiagnostics(candidate)
      const reasons = [...verdict.reasons, ...fidelity.reasons,
        ...(!exactCanvas ? ['原始 Canvas 尺寸改变'] : []),
        ...(candidateRoutes.ingressPortConflicts > routeDiagnostics.ingressPortConflicts
          || candidateRoutes.sidePortCapacityDeficits.length > routeDiagnostics.sidePortCapacityDeficits.length
          ? ['端口容量或冲突退化'] : []),
        ...(canvasBundleTrunks(candidate).length < canvasBundleTrunks(composed.scene).length
          ? ['真实共享主干减少'] : [])]
      const eligible = reasons.length === 0
      partitionCandidates.push({ id: example.id, axis, eligible, reasons,
        originalFrameArea: baseline.frameOverlapArea, candidateFrameArea: measured.frameOverlapArea,
        originalRouteLength: baseline.routeLength, candidateRouteLength: measured.routeLength,
        originalCanvas: [composed.scene.width, composed.scene.height],
        candidateCanvas: [candidate.width, candidate.height],
      })
      if (eligible) {
        await writeFile(path.join(output, `${example.id}--partition-${axis}.diagram.json`), serializeCanvasScene(candidate))
        await writeFile(path.join(output, `${example.id}--partition-${axis}.svg`), canvasSceneToSvg(candidate))
      }
    }
  }
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
    prelayoutDemand: {
      ...demand,
      /** Deficit is a what-if one-side fan-in/fan-out demand; it is NOT the
       * actual post-layout allocated ports or geometry collision count. */
      scenario: 'incoming-on-left/outgoing-on-right; hypothetical per-side span, no bundling',
    },
    corridorConflicts,
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
if (partitionEnvelopeExperiment) {
  await writeFile(path.join(output, 'partition-envelopes.json'), JSON.stringify({
    version: 1, suite, kind: 'isolated-generated-architecture-geometry-experiment',
    note: 'Unapproved generated-layout proposals. Requires full geometry, exact original Canvas, editable semantics and independent human visual review before adoption. Never modifies Composer output or saved documents.',
    candidateCount: partitionCandidates.length,
    eligibleCount: partitionCandidates.filter((candidate) => candidate.eligible).length,
    results: partitionCandidates,
  }, null, 2) + '\n')
  console.log(`Isolated partition-envelope proposals: ${partitionCandidates.filter((candidate) => candidate.eligible).length}/${partitionCandidates.length}; no production adoption`)
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 2,
  suite,
  prelayoutDemandReference: {
    assumedSideSpanPx: referenceSideSpanPx,
    note: 'Demand is computed from REAL declared relationships before layout. The 80px default is a hypothetical reference, not an actual assigned node height; no routing side, node resizing, or visual approval is inferred.',
  },
  ...(suite === 'external' || suite === 'reviewed' ? { inputProvenance: examples.map((entry) => ({
    id: entry.id, ...('provenance' in entry ? entry.provenance : {}),
    note: suite === 'reviewed'
      ? 'A separate review attestation is NOT a rendering or visual approval. Each architectural claim must trace to a source hash and line span.'
      : 'Git revision may be dirty; each source digest identifies the actual bytes analyzed. AST static imports do not imply user-validated system architecture.',
  })) } : {}),
  source: suite === 'reviewed' ? 'Explicit evidence-backed architecture task manifest; review attestation reported separately from visual approval'
    : suite === 'external' ? 'Explicit external Git-tracked TypeScript static-import subgraphs; source-verified, not service dependencies or user-approved architecture'
    : suite === 'project' || suite === 'project-multi'
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
<p>${suite === 'reviewed' ? '来自显式任务清单，节点、关系、分区和主链路均需要可核对的来源；人工审阅记录与视觉批准是不同的门禁。'
  : suite === 'external' ? '来源为显式指定的其他本地 Git 仓库所跟踪 TypeScript 文件的静态 import 子图，不代表全工程运行依赖或已确认的业务架构。'
  : suite === 'project' || suite === 'project-multi' ? '来源为 Diagram Plugin 真实 TypeScript 静态导入关系的选定模块子图，不代表全工程运行依赖。'
    : '以下均为虚构参考系统。'} 结构评分上限 90，仅用于对比布局、碰撞和连线；人工视觉质量仍需审查。</p>
${results.map((result) => `<section><header><div><h2>${escapeHtml(result.title)}</h2>
<small>${escapeHtml(result.description)}</small></div><div class="stats">
<span>${result.composition}</span><span>${result.density}</span>
<span>输入顺序：${result.inputOrderStrategy}</span>
<span>布局排序：${result.layoutOrderingStrategy}</span>
<span>${escapeHtml(result.visualPlan.reference.label)} · ${result.visualPlan.recommendedView === 'overview' ? '先看总览' : '直接查看详情'}</span>
<span>${result.nodes} 节点 / ${result.relations} 关系</span>
<span>布局前单侧端口容量假设 ${result.prelayoutDemand.assumedSingleSidePortCapacity} · 超容量节点 ${result.prelayoutDemand.overCapacityNodes.length} · 逻辑跨层切面压力峰值 ${result.prelayoutDemand.maxLogicalFrontierRelations} 条真实关系 · 未知分区节点 ${result.prelayoutDemand.nodesWithoutVerifiedPartition}</span>
<span>已布线路线的切面冲突关联（非物理通道数量）：${result.corridorConflicts.mostConflictAffected.map((item) => `层 ${item.afterLayer} · 关系 ${item.realRelations} · 交叉 ${item.touchingCrossings} · 重叠 ${item.touchingOverlaps}`).join(' / ') || '无可关联切面'}</span>
<span>${result.structuralScore} / 90</span>
<span>${result.visualPlan.review.readyForVisualReview ? '待人工视觉审查' : '阻断视觉审查'}</span>
<span>适配字号约 ${result.presentation.estimatedTitlePxAtFit}px</span>
<span>交叉 ${result.metrics.edgeCrossings} · 重叠 ${result.metrics.edgeOverlaps} · 穿节点 ${result.metrics.edgeNodeIntersections}</span>
<span>独立入边端口拥塞 ${result.routeDiagnostics.ingressPortConflicts}</span>
<span>端口法向缺陷 ${result.routeDiagnostics.terminalNormalViolations}</span>
<span>正交转折 ${result.routeDiagnostics.totalRouteBends}</span>
<span>外围绕行 ${result.routeDiagnostics.perimeterDetours} · 总线长 ${result.routeDiagnostics.totalRouteLength}px</span>
<span>跨分区 ${result.partitionFlow.crossPartitionRelations}</span>
<span>跨区线长 ${result.routeDiagnostics.crossPartitionRouteLength}px · 逆向 ${result.routeDiagnostics.backwardCrossPartitionRelations} · 分区冲突 ${result.routeDiagnostics.frameOverlaps}</span>
</div></header><img src="./${result.id}.svg" loading="lazy" alt="${escapeHtml(result.title)}">
${result.issues.length || result.presentation.warnings.length ? `<p class="issues">${[...result.issues.map(({ code }) => code), ...result.presentation.warnings].map(escapeHtml).join(' · ')}</p>` : ''}</section>`).join('\n')}
</main></body></html>`)

console.table(results.map(({ id, nodes, relations, structuralScore, metrics, routeDiagnostics, reroutedEdges, elapsedMs }) => ({
  id, nodes, relations, score: structuralScore, crossings: metrics.edgeCrossings,
  overlaps: metrics.edgeOverlaps, ingressPorts: routeDiagnostics.ingressPortConflicts,
  portNormals: routeDiagnostics.terminalNormalViolations,
  bends: routeDiagnostics.totalRouteBends,
  throughNodes: metrics.edgeNodeIntersections,
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
