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
import { d2SvgToEditableCanvas, d2SvgToNativeBendCanvas } from './d2-canvas-candidate.js'

const args = process.argv.slice(2)
const caseFilter = args.find((arg) => arg.startsWith('--case='))?.slice(7)
const output = path.resolve(args.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? 'test-results/architecture-d2-review')
const render = args.includes('--render')
const existingSvgDirectory = args.find((arg) => arg.startsWith('--reuse-svg-dir='))?.slice('--reuse-svg-dir='.length)
if (render && existingSvgDirectory) throw new Error('--render 与 --reuse-svg-dir 不能同时使用')
const hasSvg = render || Boolean(existingSvgDirectory)
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
  // Replays are useful when D2 is not installed, but only for exactly the
  // matching semantic fixture. A stale SVG is not evidence for this input.
  if (existingSvgDirectory) {
    const savedSource = await readFile(path.join(existingSvgDirectory, `${sample.id}.d2`), 'utf8')
    if (savedSource !== fixture.source) throw new Error(`D2 对照输入已变化，不能复用旧 SVG：${sample.id}`)
  }
  await writeFile(path.join(output, `${sample.id}.d2`), fixture.source)
  await writeFile(path.join(output, `${sample.id}--current.svg`), canvasSceneToSvg(result.scene))
  const measure = measureEditableArchitecture
  const baseline = measure(result.scene)
  const engines: Array<{ name: string; svg?: string; editableSvg?: string; ms?: number;
    fidelity?: string; unsupported?: string;
    editableMetrics?: ReturnType<typeof measure>; decision?: ReturnType<typeof judgeExternalLayout>; error?: string }> = [
    { name: 'current', svg: `${sample.id}--current.svg`, editableSvg: `${sample.id}--current.svg`, ms: currentMs,
      editableMetrics: measure(result.scene) },
  ]
  for (const name of ['tala', 'elk', 'dagre'] as const) {
    if (!hasSvg) { engines.push({ name, error: '未运行：需显式 --render 或 --reuse-svg-dir=已有匹配样例目录' }); continue }
    const startedEngine = performance.now()
    const svg = `${sample.id}--${name}.svg`
    try {
      if (existingSvgDirectory) {
        await writeFile(path.join(output, svg), await readFile(path.join(existingSvgDirectory, svg), 'utf8'))
      } else {
        await promisify(execFile)(bin, [`--layout=${name}`, path.join(output, `${sample.id}.d2`), path.join(output, svg)],
          { timeout: 120_000, maxBuffer: 1_000_000 })
      }
      const sourceSvg = await readFile(path.join(output, svg), 'utf8')
      const native = d2SvgToEditableCanvas(result.scene, sourceSvg)
      const editableSvg = `${sample.id}--${name}--canvas.svg`
      await writeFile(path.join(output, editableSvg), canvasSceneToSvg(native))
      await writeFile(path.join(output, `${sample.id}--${name}--canvas.diagram.json`), serializeCanvasScene(native))
      const editableMetrics = measure(native)
      engines.push({ name: `${name}-placement-only`, svg, editableSvg, editableMetrics, fidelity: '仅导入节点坐标，Canvas 重新布线',
        decision: judgeExternalLayout(baseline, editableMetrics),
        ms: Math.round(performance.now() - startedEngine) })
      const nativeStarted = performance.now()
      try {
        const imported = d2SvgToNativeBendCanvas(result.scene, sourceSvg)
        const nativeSvg = `${sample.id}--${name}--native-bends--canvas.svg`
        await writeFile(path.join(output, nativeSvg), canvasSceneToSvg(imported))
        await writeFile(path.join(output, `${sample.id}--${name}--native-bends.diagram.json`), serializeCanvasScene(imported))
        const nativeMetrics = measure(imported)
        engines.push({ name: `${name}-native-bends`, svg, editableSvg: nativeSvg,
          fidelity: 'D2 原生正交折点（圆角转直角）；端口吸附至 Canvas 四侧锚点，标签重新排放',
          editableMetrics: nativeMetrics, decision: judgeExternalLayout(baseline, nativeMetrics),
          ms: Math.round(performance.now() - nativeStarted) })
      } catch (error) {
        engines.push({ name: `${name}-native-bends`, svg,
          unsupported: error instanceof Error ? error.message : String(error) })
      }
    } catch (error) {
      engines.push({ name, error: String(error).slice(0, 500), ms: Math.round(performance.now() - startedEngine) })
    }
  }
  report.push({ id: sample.id, nodeCount: fixture.nodes.length, relationCount: fixture.relations.length,
    currentQuality: result.quality.metrics, engines })
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 3, comparisonType: 'editable-canvas-layout-geometry',
  sourceMode: existingSvgDirectory ? 'matching-saved-d2-svg-replay' : render ? 'fresh-d2-cli' : 'fixtures-only',
  limitations: 'The placement-only candidate uses D2 node positions plus Canvas routing. The native-bends candidate preserves D2 orthogonal bends, but smooth corners are squared, endpoint offsets snap to four Canvas side anchors, and labels are laid out by Canvas. Unsupported Bezier paths are rejected, never silently rerouted. Timings differ: current includes composition/refinement; fresh placement-only includes CLI/render/import; replay placement-only includes existing SVG read/import but no D2 execution; native bends measures additional import only. None are comparable as end-to-end generation speed. Neither variant proves production fitness or exact D2-native rendering. No default engine switch.',
  cases: report,
}, null, 2) + '\n')
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>架构布局引擎对照</title>
<style>body{font:14px/1.55 system-ui;margin:0;padding:24px;background:#f5f7fa;color:#17212e}main{max-width:1600px;margin:auto}h1{font-size:24px}h2{font-size:18px}.cases{margin:24px 0;padding:16px;background:white;border:1px solid #dce2e9;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}.panel{border:1px solid #dce2e9;border-radius:9px;overflow:hidden}.panel h3{padding:10px;margin:0;font-size:14px;background:#f2f5f8}.panel img{width:100%;height:auto;display:block}.panel p{padding:12px;color:#536277}.note{color:#536277}</style>
<main><h1>架构图布局引擎实验</h1><p class="note">输入来源：${existingSvgDirectory ? '既有 D2 SVG 重放（已逐字核对 .d2，不是本轮新渲染）' : render ? '本轮 D2 CLI 运行' : '仅生成语义输入'}。全部候选使用相同语义数据与 Canvas 渲染。位置方案会重新布线；原生折点方案保留 D2 正交折点，但 Canvas 锚点/标签仍是近似。曲线不兼容时明确拒绝，绝不静默回退。原生 D2 SVG 单独标注，不代表最终 Canvas 效果。各阶段耗时口径不同。</p>
${report.map((sample) => `<section class="cases"><h2>${escapeHtml(sample.id)} · ${sample.nodeCount} 节点 / ${sample.relationCount} 关系</h2><div class="grid">${sample.engines.map((engine) => `<div class="panel"><h3>${escapeHtml(engine.name)}${engine.ms !== undefined ? ` · ${engine.ms}ms` : ''}</h3>${engine.editableSvg ? `<img src="${escapeHtml(engine.editableSvg)}" alt="${escapeHtml(engine.name)} Canvas"><p>可编辑 Canvas · 交叉 ${engine.editableMetrics?.quality.edgeCrossings}，重叠 ${engine.editableMetrics?.quality.edgeOverlaps}，穿节点 ${engine.editableMetrics?.quality.edgeNodeIntersections}，非正交 ${engine.editableMetrics?.nonOrthogonalSegments}，分区碰撞 ${engine.editableMetrics?.frames}，适配字号 ${engine.editableMetrics?.fitPx}px</p>${engine.decision ? `<p>${engine.decision.eligible ? '可进入进一步人工视觉审查' : `拒绝采用：${escapeHtml(engine.decision.reasons.join('；'))}`}</p>` : ''}` : `<p>${escapeHtml(engine.error ?? engine.unsupported ?? '未运行')}</p>`}${engine.fidelity ? `<p>${escapeHtml(engine.fidelity)}</p>` : ''}${engine.svg && engine.svg !== engine.editableSvg ? `<img src="${escapeHtml(engine.svg)}" alt="${escapeHtml(engine.name)} D2 SVG"><p>D2 原生渲染，仅供参考</p>` : ''}</div>`).join('')}</div></section>`).join('')}
</main></html>`)
console.table(report.flatMap((sample) => sample.engines.map((engine) =>
  ({ sample: sample.id, engine: engine.name, eligible: engine.decision?.eligible, elapsedMs: engine.ms, crossings: engine.editableMetrics?.quality.edgeCrossings,
    overlaps: engine.editableMetrics?.quality.edgeOverlaps, through: engine.editableMetrics?.quality.edgeNodeIntersections,
    status: engine.error ? 'not-run/error' : engine.unsupported ? 'unsupported-path' : 'editable' }))))
console.log(`D2 layout review: ${path.join(output, 'index.html')}`)
if (hasSvg && report.some((sample) => sample.engines.some((engine) => engine.error))) process.exitCode = 1
