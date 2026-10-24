import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasSceneToSvg } from '../src/canvas.js'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { architectureSceneToD2 } from './d2-architecture-fixture.js'

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
  const engines: Array<{ name: string; svg?: string; ms?: number; error?: string }> = [
    { name: 'current', svg: `${sample.id}--current.svg`, ms: currentMs },
  ]
  for (const name of ['tala', 'elk', 'dagre'] as const) {
    if (!render) { engines.push({ name, error: '未运行：需显式 --render 与本地 D2 0.9.0+' }); continue }
    const startedEngine = performance.now()
    const svg = `${sample.id}--${name}.svg`
    try {
      await promisify(execFile)(bin, [`--layout=${name}`, path.join(output, `${sample.id}.d2`), path.join(output, svg)],
        { timeout: 120_000, maxBuffer: 1_000_000 })
      engines.push({ name, svg, ms: Math.round(performance.now() - startedEngine) })
    } catch (error) {
      engines.push({ name, error: String(error).slice(0, 500), ms: Math.round(performance.now() - startedEngine) })
    }
  }
  report.push({ id: sample.id, nodeCount: fixture.nodes.length, relationCount: fixture.relations.length,
    currentQuality: result.quality.metrics, engines })
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({
  version: 1, comparisonType: 'visual-only',
  limitations: 'D2 SVG uses its own font, node styling and sizing. Timings are not comparable: current includes composition/refinement; D2 measures CLI startup/layout/render. Do not use this as a Canvas geometry score or production engine decision.',
  cases: report,
}, null, 2) + '\n')
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>架构布局引擎对照</title>
<style>body{font:14px/1.55 system-ui;margin:0;padding:24px;background:#f5f7fa;color:#17212e}main{max-width:1600px;margin:auto}h1{font-size:24px}h2{font-size:18px}.cases{margin:24px 0;padding:16px;background:white;border:1px solid #dce2e9;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}.panel{border:1px solid #dce2e9;border-radius:9px;overflow:hidden}.panel h3{padding:10px;margin:0;font-size:14px;background:#f2f5f8}.panel img{width:100%;height:auto;display:block}.panel p{padding:12px;color:#536277}.note{color:#536277}</style>
<main><h1>架构图布局引擎实验</h1><p class="note">同一节点与有向关系，但 D2 使用自己的节点尺寸、字体和渲染器；只能进行人工布局对照，不能据此宣称结构评分或性能优胜。未运行的引擎不会显示虚假结果。</p>
${report.map((sample) => `<section class="cases"><h2>${escapeHtml(sample.id)} · ${sample.nodeCount} 节点 / ${sample.relationCount} 关系</h2><div class="grid">${sample.engines.map((engine) => `<div class="panel"><h3>${escapeHtml(engine.name)}${engine.ms !== undefined ? ` · ${engine.ms}ms` : ''}</h3>${engine.svg ? `<img src="${escapeHtml(engine.svg)}" alt="${escapeHtml(engine.name)}">` : `<p>${escapeHtml(engine.error ?? '未运行')}</p>`}</div>`).join('')}</div></section>`).join('')}
</main></html>`)
console.table(report.flatMap((sample) => sample.engines.map((engine) =>
  ({ sample: sample.id, engine: engine.name, elapsedMs: engine.ms, status: engine.error ? 'not-run/error' : 'rendered' }))))
console.log(`D2 layout review: ${path.join(output, 'index.html')}`)
if (render && report.some((sample) => sample.engines.some((engine) => engine.error))) process.exitCode = 1
