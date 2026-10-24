import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'
import { judgeExternalLayout, measureEditableArchitecture } from './architecture-layout-gate.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { architectureSceneToD2 } from './d2-architecture-fixture.js'
import { d2SvgToEditableCanvas } from './d2-canvas-candidate.js'

const args = process.argv.slice(2)
const caseFilter = args.find((arg) => arg.startsWith('--case='))?.slice(7)
const output = path.resolve(args.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? 'test-results/architecture-d2-review')
const render = args.includes('--render')
const bin = process.env.D2_BIN ?? 'd2'
const cases = architectureBenchmarkCases('extended')
  .filter((sample) => caseFilter ? sample.id === caseFilter
    : ['business-platform', 'microservices', 'data-platform', 'microservices-fanout', 'data-platform-fanout'].includes(sample.id))
if (!cases.length) throw new Error('没有匹配的架构图基准样例')
await mkdir(output, { recursive: true })
if (render) {
  try { await promisify(execFile)(bin, ['--version'], { timeout: 10_000 }) }
  catch { throw new Error('D2 0.9.0+ 未安装或不可执行；请先安装并运行 d2 layout 确认支持 TALA。') }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
const report = []
for (const sample of cases) {
  const started = performance.now()
  const result = composeArchitectureGraph(sample.intent)
  const currentMs = Math.round(performance.now() - started)
  const fixture = architectureSceneToD2(result.scene)
  await writeFile(path.join(output, `${sample.id}.d2`), fixture.source)
  await writeFile(path.join(output, `${sample.id}--current.svg`), canvasSceneToSvg(result.scene))
  const measure = measureEditableArchitecture
  const baseline = measure(result.scene)
  const engines: Array<{ name: string; svg?: string; editableSvg?: string; ms?: number;
    editableMetrics?: ReturnType<typeof measure>; decision?: ReturnType<typeof judgeExternalLayout>; error?: string }> = [
    { name: 'current', svg: `${sample.id}--current.svg`, editableSvg: `${sample.id}--current.svg`, ms: currentMs,
      editableMetrics: measure(result.scene) },
  ]
  for (const name of ['tala', 'elk', 'dagre'] as const) {
    if (!render) { engines.push({ name, error: '未运行：需显式 --render 与本地 D2 0.9.0+' }); continue }
    const startedEngine = performance.now()
    const svg = `${sample.id}--${name}.svg`
    try {
      await promisify(execFile)(bin, [`--layout=${name}`, path.join(output, `${sample.id}.d2`), path.join(output, svg)],
        { timeout: 120_000, maxBuffer: 1_000_000 })
      const native = d2SvgToEditableCanvas(result.scene, await readFile(path.join(output, svg), 'utf8'))
      const editableSvg = `${sample.id}--${name}--canvas.svg`
      await writeFile(path.join(output, editableSvg), canvasSceneToSvg(native))
      await writeFile(path.join(output, `${sample.id}--${name}--canvas.diagram.json`), serializeCanvasScene(native))
      const editableMetrics = measure(native)
      engines.push({ name, svg, editableSvg, editableMetrics, decision: judgeExternalLayout(baseline, editableMetrics),
        ms: Math.round(performance.now() - startedEngine) })
    } catch (error) {
      engines.push({ name, error: String(error).slice(0, 500), ms: Math.round(performance.now() - startedEngine) })
    }
  }
  report.push({ id: sample.id, nodeCount: fixture.nodes.length, relationCount: fixture.relations.length,
    currentQuality: result.quality.metrics, engines })
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 2, comparisonType: 'editable-canvas-layout-geometry',
  limitations: 'D2 source diagrams show the foreign renderer. Imported Canvas diagrams use only D2 node placement and reroute with native Canvas orthogonal routing; they do not preserve D2 bends/ports or prove production fitness. Timings are not comparable: current includes composition/refinement; D2 includes CLI startup/render/re-import. No default engine switch.',
  cases: report,
}, null, 2) + '\n')
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>架构布局引擎对照</title>
<style>body{font:14px/1.55 system-ui;margin:0;padding:24px;background:#f5f7fa;color:#17212e}main{max-width:1600px;margin:auto}h1{font-size:24px}h2{font-size:18px}.cases{margin:24px 0;padding:16px;background:white;border:1px solid #dce2e9;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}.panel{border:1px solid #dce2e9;border-radius:9px;overflow:hidden}.panel h3{padding:10px;margin:0;font-size:14px;background:#f2f5f8}.panel img{width:100%;height:auto;display:block}.panel p{padding:12px;color:#536277}.note{color:#536277}</style>
<main><h1>架构图布局引擎实验</h1><p class="note">各引擎的可编辑 Canvas 对照图使用相同节点尺寸、卡片样式和 Canvas 正交布线器。D2 原生渲染仅作布局参考，不能冒充 Canvas 的最终效果。执行耗时范围不同，不能直接比较性能。</p>
${report.map((sample) => `<section class="cases"><h2>${escapeHtml(sample.id)} · ${sample.nodeCount} 节点 / ${sample.relationCount} 关系</h2><div class="grid">${sample.engines.map((engine) => `<div class="panel"><h3>${escapeHtml(engine.name)}${engine.ms !== undefined ? ` · ${engine.ms}ms` : ''}</h3>${engine.editableSvg ? `<img src="${escapeHtml(engine.editableSvg)}" alt="${escapeHtml(engine.name)} Canvas"><p>可编辑 Canvas · 交叉 ${engine.editableMetrics?.quality.edgeCrossings}，重叠 ${engine.editableMetrics?.quality.edgeOverlaps}，穿节点 ${engine.editableMetrics?.quality.edgeNodeIntersections}，分区碰撞 ${engine.editableMetrics?.frames}，适配字号 ${engine.editableMetrics?.fitPx}px</p>${engine.decision ? `<p>${engine.decision.eligible ? '可进入进一步人工视觉审查' : `拒绝采用：${escapeHtml(engine.decision.reasons.join('；'))}`}</p>` : ''}` : `<p>${escapeHtml(engine.error ?? '未运行')}</p>`}${engine.svg && engine.svg !== engine.editableSvg ? `<img src="${escapeHtml(engine.svg)}" alt="${escapeHtml(engine.name)} D2 SVG"><p>D2 原生渲染，仅供参考</p>` : ''}</div>`).join('')}</div></section>`).join('')}
</main></html>`)
console.table(report.flatMap((sample) => sample.engines.map((engine) =>
  ({ sample: sample.id, engine: engine.name, eligible: engine.decision?.eligible, elapsedMs: engine.ms, crossings: engine.editableMetrics?.quality.edgeCrossings,
    overlaps: engine.editableMetrics?.quality.edgeOverlaps, through: engine.editableMetrics?.quality.edgeNodeIntersections,
    status: engine.error ? 'not-run/error' : 'editable' }))))
console.log(`D2 layout review: ${path.join(output, 'index.html')}`)
if (render && report.some((sample) => sample.engines.some((engine) => engine.error))) process.exitCode = 1
