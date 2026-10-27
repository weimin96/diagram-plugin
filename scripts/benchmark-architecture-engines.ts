import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'
import { assessArchitecturePresentation } from '../src/architecturePresentationQuality.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'
import type { CanvasScene } from '../src/canvas.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { projectArchitectureCase, projectArchitectureCases } from './architecture-project-cases.js'
import { fitElkCorridorsWithinOriginalCanvas, layoutWithElk, placeElkWithinOriginalCanvas, type ElkBenchmarkVariant } from './elk-architecture-candidate.js'
import { compareEditableArchitectureSemantics, judgeExternalLayout, measureEditableArchitecture } from './architecture-layout-gate.js'

const args = process.argv.slice(2)
const suiteArg = args.find((arg) => arg.startsWith('--suite='))
const suite = suiteArg?.slice(8) ?? 'core'
if (suite !== 'core' && suite !== 'extended' && suite !== 'stress'
  && suite !== 'project' && suite !== 'project-multi') throw new Error('Unknown suite')
const caseArg = args.find((arg) => arg.startsWith('--case='))?.slice(7)
const output = path.resolve(args.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? (suite === 'project' ? 'test-results/architecture-engines-project'
    : suite === 'project-multi' ? 'test-results/architecture-engines-project-multi'
      : 'test-results/architecture-engines'))
const variants: ElkBenchmarkVariant[] = ['flat', 'compound', 'native', 'native-compound']
const direction = args.find((arg) => arg.startsWith('--direction='))?.slice(12) ?? 'RIGHT'
if (direction !== 'RIGHT' && direction !== 'DOWN') throw new Error('Use --direction=RIGHT|DOWN')
const spacingArg = args.find((arg) => arg.startsWith('--spacing='))?.slice(10)
const spacing = spacingArg === undefined ? undefined : Number(spacingArg)
if (spacing !== undefined && (!Number.isInteger(spacing) || spacing < 8 || spacing > 200)) {
  throw new Error('--spacing must be an integer between 8 and 200')
}
const requireEligible = args.includes('--require-eligible')
const compactBounds = args.includes('--compact-bounds')
const sameCanvas = args.includes('--same-canvas')
const fitCorridors = args.includes('--fit-corridors')
if (fitCorridors && !sameCanvas) throw new Error('--fit-corridors requires --same-canvas')
const jointPorts = args.includes('--joint-ports')
if (jointPorts && !fitCorridors) throw new Error('--joint-ports requires --same-canvas --fit-corridors')
const wrappingArg = args.find((arg) => arg.startsWith('--wrapping='))?.slice(11)
if (wrappingArg !== undefined && !['OFF', 'SINGLE_EDGE', 'MULTI_EDGE'].includes(wrappingArg)) {
  throw new Error('Use --wrapping=OFF|SINGLE_EDGE|MULTI_EDGE')
}
const wrapping = wrappingArg as 'OFF' | 'SINGLE_EDGE' | 'MULTI_EDGE' | undefined
const ratioArg = args.find((arg) => arg.startsWith('--aspect-ratio='))?.slice(15)
const aspectRatio = ratioArg === undefined ? undefined : Number(ratioArg)
if (aspectRatio !== undefined && (!Number.isFinite(aspectRatio) || aspectRatio < 0.2 || aspectRatio > 5)) {
  throw new Error('--aspect-ratio must be 0.2..5')
}
const entries = (suite === 'project' ? [await projectArchitectureCase()]
  : suite === 'project-multi' ? await projectArchitectureCases() : architectureBenchmarkCases(suite))
  .filter((entry) => !caseArg || entry.id === caseArg)
if (!entries.length) throw new Error('No matching benchmark case')
await mkdir(output, { recursive: true })

type Result = { case: string; engine: string; ms: number; nodes: number; edges: number;
  crossings: number; overlaps: number; throughNodes: number; labelCollisions: number;
  width: number; height: number; aspectRatio: number; groupOverlaps: number; totalRouteLength: number;
  crossPartitionRouteLength: number; unrelatedFrameIntrusionLength: number
  fitFont: number; warnings: string[]; eligible?: boolean; rejectionReasons?: string[];
  nonOrthogonalSegments?: number; frameOverlapArea?: number; frameOverflowPx?: number; error?: string;
  faithful?: boolean; semanticViolations?: string[]; perimeterDetours?: number;
  portNormals?: number; routeBends?: number }
const results: Result[] = []
function additionalGeometry(scene: CanvasScene) {
  const measured = assessArchitectureRouteDiagnostics(scene)
  return { width: scene.width, height: scene.height, aspectRatio: Math.round(scene.width / scene.height * 100) / 100,
    groupOverlaps: measured.frameOverlaps, totalRouteLength: measured.totalRouteLength,
    crossPartitionRouteLength: measured.crossPartitionRouteLength,
    unrelatedFrameIntrusionLength: measured.unrelatedFrameIntrusionLength }
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
))
for (const entry of entries) {
  const baselineStart = performance.now()
  const original = composeArchitectureGraph(entry.intent)
  const baseline = measureEditableArchitecture(original.scene)
  const baselineMs = Math.round(performance.now() - baselineStart)
  const measures: Array<{ engine: string; scene: typeof original.scene; ms: number; canvasSizeRejection?: string }> = [
    { engine: 'current', scene: original.scene, ms: baselineMs },
  ]
  const candidates = variants.flatMap((variant) => [
    { variant, joint: false },
    ...(jointPorts && variant === 'native' ? [{ variant, joint: true }] : []),
  ])
  for (const { variant, joint } of candidates) {
    const start = performance.now()
    const engineName = `elk-${variant}${joint ? '-joint' : ''}`
    try {
      const config = {
        direction, ...(spacing === undefined ? {} : { nodeSpacing: spacing, layerSpacing: spacing }),
        compactBounds,
        wrapping, aspectRatio,
      }
      const initial = await layoutWithElk(original.scene, variant, config)
      const scene = joint ? await layoutWithElk(initial, variant, { ...config, portSideMode: 'relative' }) : initial
      const matched = sameCanvas
        ? (fitCorridors ? fitElkCorridorsWithinOriginalCanvas(original.scene, scene)
          : placeElkWithinOriginalCanvas(original.scene, scene)) : undefined
      measures.push({
        engine: engineName,
        scene: matched ?? scene, ms: Math.round(performance.now() - start),
        ...(sameCanvas && !matched ? { canvasSizeRejection:
          `保持原画布 ${original.scene.width}×${original.scene.height}px、边框安全间距和锁定节点位置时无法容纳该候选` } : {}),
      })
    } catch (error) {
      results.push({
        case: entry.id, engine: engineName, nodes: entry.intent.nodes.length,
        edges: entry.intent.relations.length, ms: Math.round(performance.now() - start),
        crossings: -1, overlaps: -1, throughNodes: -1, labelCollisions: -1, fitFont: 0,
        width: 0, height: 0, aspectRatio: 0, groupOverlaps: -1, totalRouteLength: -1,
        crossPartitionRouteLength: -1, unrelatedFrameIntrusionLength: -1,
        warnings: [], error: String(error),
      })
    }
  }
  for (const item of measures) {
    const quality = assessCanvasVisualQuality(item.scene)
    const metrics = quality.metrics
    const presentation = assessArchitecturePresentation(item.scene)
    const measured = measureEditableArchitecture(item.scene)
    const fidelity = compareEditableArchitectureSemantics(original.scene, item.scene)
    const verdict = item.engine === 'current' ? undefined : judgeExternalLayout(baseline, measured)
    results.push({
      case: entry.id, engine: item.engine, nodes: entry.intent.nodes.length,
      edges: entry.intent.relations.length, ms: item.ms, crossings: metrics.edgeCrossings,
      overlaps: metrics.edgeOverlaps, throughNodes: metrics.edgeNodeIntersections,
      labelCollisions: metrics.labelOverlaps + metrics.labelNodeIntersections + metrics.labelOverflows,
      ...additionalGeometry(item.scene),
      fitFont: presentation.estimatedTitlePxAtFit, warnings: [...presentation.warnings],
      faithful: fidelity.faithful, semanticViolations: fidelity.reasons,
      eligible: verdict ? verdict.eligible && fidelity.faithful && !item.canvasSizeRejection : undefined,
      rejectionReasons: [...(verdict?.reasons ?? []), ...fidelity.reasons,
        ...(item.canvasSizeRejection ? [item.canvasSizeRejection] : [])],
      nonOrthogonalSegments: measured.nonOrthogonalSegments,
      frameOverlapArea: measured.frameOverlapArea, frameOverflowPx: measured.frameOverflowPx,
      perimeterDetours: measured.perimeterDetours,
      portNormals: measured.portNormals, routeBends: measured.routeBends,
    })
    await writeFile(path.join(output, `${entry.id}--${item.engine}.diagram.json`), serializeCanvasScene(item.scene))
    await writeFile(path.join(output, `${entry.id}--${item.engine}.svg`), canvasSceneToSvg(item.scene))
  }
}

const eligible = results.filter((item) => item.engine !== 'current' && item.eligible)
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 3, suite, caseCount: entries.length, direction, spacing: spacing ?? null, compactBounds, sameCanvas, fitCorridors, jointPorts,
  wrapping: wrapping ?? null, aspectRatio: aspectRatio ?? null,
  source: suite === 'project' || suite === 'project-multi'
    ? 'Real scoped TypeScript import graph including type-only relations' : 'Reference/synthetic',
  candidateCount: results.filter((item) => item.engine !== 'current').length,
  eligibleCount: eligible.length,
  recommendation: eligible.length ? 'Inspect eligible candidates visually; not approved' : 'Keep current production layout engine',
  note: 'Timing scopes differ: current.ms includes the entire composer with multi-candidate refinement; elk-*.ms includes only experimental relayout on an already composed scene. ELK native imports section geometry; native-compound transforms edge.container-local sections into world coordinates and connects noncentral ports to Canvas side-center anchors via orthogonal bridges. The optional fit-corridors experiment compresses node-free X gutters without shrinking nodes or fonts; every candidate still requires full editable-geometry and semantic gates. Eligibility is not human approval. This is NOT an end-to-end speed comparison. Reference/synthetic cases are not production data.',
  results,
}, null, 2) + '\n')
const groups = entries.map((entry) => ({
  entry,
  results: results.filter((item) => item.case === entry.id),
}))
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>架构图 ELK A/B</title>
<style>body{margin:0;padding:26px;background:#f4f6fa;font:14px system-ui;color:#253041}h1{font-size:24px}h2{font-size:18px;margin:20px 0 10px}.case{border:1px solid #e0e5ec;border-radius:12px;background:white;margin:25px 0;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}.panel{min-width:0;border:1px solid #e0e5ec;border-radius:9px;overflow:hidden}.panel b{display:block;padding:12px}.panel img{display:block;width:100%;height:auto}.panel p{padding:0 12px;color:#526074}small{color:#657080}</style></head>
<body><h1>ELK / 当前布局 A/B</h1><small>同一语义数据、同一 Canvas 渲染和质量检测；ELK 仅实验，不会自动替换正式引擎</small>
${groups.map(({ entry, results }) => `<section class="case"><h2>${escapeHtml(entry.id)}</h2><small>${escapeHtml(entry.description)}</small><div class="grid">
${results.map((r) => `<div class="panel"><b>${escapeHtml(r.engine)}</b>${r.error ? `<p>${escapeHtml(r.error)}</p>` : `<img loading="lazy" src="./${escapeHtml(r.case)}--${escapeHtml(r.engine)}.svg">`}
<p>${r.ms}ms · 交叉 ${r.crossings} · 重叠 ${r.overlaps} · 穿节点 ${r.throughNodes} · 非正交 ${r.nonOrthogonalSegments ?? '—'} · 分区冲突 ${r.groupOverlaps}（${r.frameOverlapArea ?? '—'}px²）· 分区越界 ${r.frameOverflowPx ?? '—'}px · 画布 ${r.width}×${r.height} · 跨区线长 ${r.crossPartitionRouteLength}px · 无关分区穿越 ${r.unrelatedFrameIntrusionLength}px · 字体 ${r.fitFont}px</p>${r.engine !== 'current' && !r.error ? `<p>${r.eligible ? '仅通过候选几何门禁，待人工视觉审查' : `拒绝替换：${escapeHtml(r.rejectionReasons?.join('；') || '候选不合格')}`}</p>` : ''}</div>`).join('')}</div></section>`).join('')}
</body></html>`)
console.table(results.map(({ case: id, engine, ms, crossings, overlaps, throughNodes, groupOverlaps, aspectRatio, eligible, error }) =>
  ({ id, engine, ms, crossings, overlaps, throughNodes, groupOverlaps, aspectRatio, eligible, error: error?.slice(0, 60) ?? '' })))
console.log(`A/B result: ${path.join(output, 'index.html')}`)
console.log(`External layouts eligible for further visual review: ${eligible.length} / ${results.filter((item) => item.engine !== 'current').length}`)
if (results.some((item) => item.error)) process.exitCode = 1
if (requireEligible && !eligible.length) {
  console.error('No eligible ELK candidate: current production layout remains unchanged.')
  process.exitCode = 1
}
