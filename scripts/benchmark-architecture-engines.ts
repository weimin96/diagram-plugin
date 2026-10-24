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
import { layoutWithElk, type ElkBenchmarkVariant } from './elk-architecture-candidate.js'

const args = process.argv.slice(2)
const suiteArg = args.find((arg) => arg.startsWith('--suite='))
const suite = suiteArg?.slice(8) ?? 'core'
if (suite !== 'core' && suite !== 'extended' && suite !== 'stress') throw new Error('Unknown suite')
const caseArg = args.find((arg) => arg.startsWith('--case='))?.slice(7)
const output = path.resolve(args.find((arg) => arg.startsWith('--out='))?.slice(6) ?? 'test-results/architecture-engines')
const variants: ElkBenchmarkVariant[] = ['flat', 'compound', 'native']
const entries = architectureBenchmarkCases(suite).filter((entry) => !caseArg || entry.id === caseArg)
if (!entries.length) throw new Error('No matching benchmark case')
await mkdir(output, { recursive: true })

type Result = { case: string; engine: string; ms: number; nodes: number; edges: number;
  crossings: number; overlaps: number; throughNodes: number; labelCollisions: number;
  width: number; height: number; aspectRatio: number; groupOverlaps: number; totalRouteLength: number;
  crossPartitionRouteLength: number; unrelatedFrameIntrusionLength: number
  fitFont: number; warnings: string[]; error?: string }
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
  const baselineMs = Math.round(performance.now() - baselineStart)
  const measures: Array<{ engine: string; scene: typeof original.scene; ms: number }> = [
    { engine: 'current', scene: original.scene, ms: baselineMs },
  ]
  for (const variant of variants) {
    const start = performance.now()
    try {
      const scene = await layoutWithElk(original.scene, variant)
      measures.push({ engine: `elk-${variant}`, scene, ms: Math.round(performance.now() - start) })
    } catch (error) {
      results.push({
        case: entry.id, engine: `elk-${variant}`, nodes: entry.intent.nodes.length,
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
    results.push({
      case: entry.id, engine: item.engine, nodes: entry.intent.nodes.length,
      edges: entry.intent.relations.length, ms: item.ms, crossings: metrics.edgeCrossings,
      overlaps: metrics.edgeOverlaps, throughNodes: metrics.edgeNodeIntersections,
      labelCollisions: metrics.labelOverlaps + metrics.labelNodeIntersections + metrics.labelOverflows,
      ...additionalGeometry(item.scene),
      fitFont: presentation.estimatedTitlePxAtFit, warnings: [...presentation.warnings],
    })
    await writeFile(path.join(output, `${entry.id}--${item.engine}.diagram.json`), serializeCanvasScene(item.scene))
    await writeFile(path.join(output, `${entry.id}--${item.engine}.svg`), canvasSceneToSvg(item.scene))
  }
}

await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 1, suite, caseCount: entries.length,
  note: 'Timing scopes differ: current.ms includes the entire composer with multi-candidate refinement; elk-*.ms includes only experimental relayout on an already composed scene. ELK native also imports ELK sections as editable Canvas waypoints, rather than using canonical rerouting. This is NOT an end-to-end speed comparison. Synthetic cases are not production data.',
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
<p>${r.ms}ms · 交叉 ${r.crossings} · 重叠 ${r.overlaps} · 穿节点 ${r.throughNodes} · 分区冲突 ${r.groupOverlaps} · 画布 ${r.width}×${r.height} · 跨区线长 ${r.crossPartitionRouteLength}px · 无关分区穿越 ${r.unrelatedFrameIntrusionLength}px · 字体 ${r.fitFont}px</p></div>`).join('')}</div></section>`).join('')}
</body></html>`)
console.table(results.map(({ case: id, engine, ms, crossings, overlaps, throughNodes, groupOverlaps, aspectRatio, error }) =>
  ({ id, engine, ms, crossings, overlaps, throughNodes, groupOverlaps, aspectRatio, error: error?.slice(0, 60) ?? '' })))
console.log(`A/B result: ${path.join(output, 'index.html')}`)
if (results.some((item) => item.error)) process.exitCode = 1
