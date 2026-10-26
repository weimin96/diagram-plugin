import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(path.join(os.tmpdir(), 'diagram-plugin-visual-'))
const sourceDir = readSourceDirArg(process.argv.slice(2))
const qualityBenchmark = process.argv.includes('--quality-benchmark')
const reportFile = process.argv.find((arg) => arg.startsWith('--report-file='))?.slice('--report-file='.length)

try {
  const chrome = await findChrome()
  if (!chrome) {
    throw new Error('视觉检查未执行：未找到 Chrome/Chromium。')
  } else {
    const externalCases = sourceDir ? await loadExternalCases(sourceDir) : undefined
    await runVisualSmoke(chrome, externalCases, qualityBenchmark)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}

async function runVisualSmoke(chrome, externalCases, qualityBenchmark) {
  const publicDir = path.join(temp, 'public')
  const entry = path.join(temp, 'visual-smoke.ts')
  const port = 18765 + Math.floor(Math.random() * 1000)
  await mkdir(publicDir, { recursive: true })
  await writeFile(entry, browserEntry(externalCases), 'utf8')
  await build({
    entryPoints: [entry],
    outfile: path.join(publicDir, 'test.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    nodePaths: [path.join(root, 'node_modules')],
    logLevel: 'silent',
  })
  await writeFile(
    path.join(publicDir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/test.js"></script></body></html>',
    'utf8',
  )

  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', publicDir], { stdio: 'ignore' })
  try {
    await delay(350)
    const dom = await captureDom(chrome, `http://127.0.0.1:${port}/`)
    const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/)
    if (!match) throw new Error('Visual smoke browser did not return a result payload.')
    const result = JSON.parse(decodeHtml(match[1]))
    const failed = result.filter((item) => !item.ok)
    const invalidDimensions = result.filter((item) => item.ok && (!(item.width > 0) || !(item.height > 0)))
    const invalidReports = result.filter((item) => item.ok
      && (item.qualityReport?.type !== item.type
        || item.qualityReport?.version !== 1
        || item.qualityReport?.engine !== 'mermaid'
        || item.qualityReport?.evidence !== 'browser'
        || item.qualityReport?.geometry === 'not-measured'
        || item.qualityReport?.visualReview !== 'not-assessed'
        || item.qualityReport?.humanApproval !== 'not-approved'))
    const oversized = result.filter((item) => item.ok && isOversized(item))
    const splitAdvisories = oversized.filter((item) => item.quality?.splitRecommended)
    const hardOversized = qualityBenchmark ? oversized.filter((item) => !item.quality?.splitRecommended) : oversized
    const geometryFailures = qualityBenchmark
      ? result.filter((item) => item.ok && ((item.geometry?.contentOverflow ?? 0) > 0 || (item.geometry?.nodeOverlaps ?? 0) > 0))
      : []
    for (const mode of ['light', 'dark']) {
      const rows = result.filter((item) => item.mode === mode)
      console.log(`${mode}: ${rows.filter((item) => item.ok).length}/${rows.length} rendered`)
    }
    if (failed.length) {
      throw new Error(`Visual smoke render failures:\n${failed.map((item) => `${item.mode}/${item.type}: ${item.error}`).join('\n')}`)
    }
    if (invalidDimensions.length) {
      throw new Error(`Visual smoke invalid dimensions:\n${invalidDimensions.map((item) => `${item.mode}/${item.name ?? item.type}: ${item.width}x${item.height}`).join('\n')}`)
    }
    if (invalidReports.length) {
      throw new Error(`Shared quality report missing or overstating approval: ${invalidReports.map((item) => item.mode + '/' + item.name).join(', ')}`)
    }
    if (splitAdvisories.length) {
      const unique = splitAdvisories.filter((item, index, rows) => rows.findIndex((other) => other.name === item.name) === index)
      for (const item of unique) {
        console.log(`split recommended: ${item.name} (${item.type}) ${item.width}x${item.height} · ${item.quality.reasons.join('；')}`)
      }
    }
    if (qualityBenchmark) {
      const lightRows = result.filter((item) => item.mode === 'light' && item.ok)
      for (const item of lightRows) {
        console.log(`quality: ${item.name} · ${item.quality.density} · ${item.width}x${item.height} · overflow=${item.geometry.contentOverflow} · nodeOverlap=${item.geometry.nodeOverlaps} · labelOverlap=${item.geometry.labelOverlaps} · textOverlap=${item.geometry.textOverlaps}`)
      }
    }
    if (geometryFailures.length) {
      throw new Error(`Visual smoke geometry failures:\n${geometryFailures.map((item) => `${item.mode}/${item.name ?? item.type}: overflow=${item.geometry?.contentOverflow ?? 0}, nodeOverlap=${item.geometry?.nodeOverlaps ?? 0}${item.geometry?.overflowSamples?.length ? ` [${item.geometry.overflowSamples.join(' | ')}]` : ''}`).join('\n')}`)
    }
    if (hardOversized.length) {
      throw new Error(`Visual smoke oversized diagrams:\n${hardOversized.map((item) => `${item.mode}/${item.name ?? item.type}: ${item.width}x${item.height}`).join('\n')}`)
    }
    if (reportFile) {
      const file = path.resolve(root, reportFile)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify({
        schemaVersion: 1,
        kind: 'mermaid-browser-quality',
        cases: result.map(({ mode, name, type, qualityReport }) => ({
          mode, name, type, quality: qualityReport,
        })),
        // These are machine observations only, not a Luna review or approval.
        reviewedByHuman: false,
      }, null, 2) + '\n')
      console.log(`Browser quality report: ${file}`)
    }
    console.log(`Diagram Plugin visual smoke passed: ${result.length} browser renders${externalCases ? ' from external cases' : ''}.`)
  } finally {
    server.kill('SIGTERM')
  }
}

function readSourceDirArg(args) {
  const index = args.indexOf('--source-dir')
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value) throw new Error('--source-dir requires a directory path.')
  return path.resolve(value)
}

async function loadExternalCases(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const cases = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.m(?:md|ermaid)$/i.test(entry.name)) continue
    const stem = entry.name.replace(/\.m(?:md|ermaid)$/i, '')
    const [type, suffix] = stem.split('__', 2)
    cases.push({ type, name: suffix ? `${type}/${suffix}` : type, source: await readFile(path.join(dir, entry.name), 'utf8') })
  }
  if (!cases.length) throw new Error(`No .mmd/.mermaid visual cases found in ${dir}`)
  return cases.sort((a, b) => a.type.localeCompare(b.type))
}

function isOversized(item) {
  const limits = item.type === 'requirement' || item.type === 'er'
    ? { width: 2000, height: 1400 }
    : item.type === 'gantt' || item.type === 'timeline'
      ? { width: 2200, height: 1400 }
      : { width: 1800, height: 1400 }
  return item.width > limits.width || item.height > limits.height
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  return undefined
}

function captureDom(chrome, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=12000',
      '--dump-dom',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Chrome exited ${code}: ${stderr.slice(-1200)}`))
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function decodeHtml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function browserEntry(externalCases) {
  const templates = path.join(root, 'src/templates.ts')
  const types = path.join(root, 'src/types.ts')
  const grammar = path.join(root, 'src/mermaidVisualGrammar.ts')
  const quality = path.join(root, 'src/mermaidQuality.ts')
  return `
import mermaid from 'mermaid'
import { fitMermaidSvgToContent } from ${JSON.stringify(path.join(root, 'src/mermaidSvg.ts'))}
import { summarizeMermaidQuality } from ${JSON.stringify(path.join(root, 'src/diagramQuality.ts'))}
import { rectContains, countOverlappingRects } from ${JSON.stringify(path.join(root, 'src/diagramGeometry.ts'))}
import { createTemplate } from ${JSON.stringify(templates)}
import { mermaidDiagramTypes } from ${JSON.stringify(types)}
import { mermaidVisualConfig, normalizeMermaidSourceForRender } from ${JSON.stringify(grammar)}
import { assessMermaidVisualQuality } from ${JSON.stringify(quality)}

const palettes = {
  light: { background:'#ffffff', surface:'#fafafa', raised:'#f4f4f5', muted:'#eeeeef', text:'#18181b', secondaryText:'#6b7280', border:'#d4d4d8', strongBorder:'#a1a1aa', accent:'#2563eb', success:'#16803a', warning:'#b45309', danger:'#c9362b' },
  dark: { background:'#18181b', surface:'#202024', raised:'#27272a', muted:'#303036', text:'#f4f4f5', secondaryText:'#a1a1aa', border:'#3f3f46', strongBorder:'#52525b', accent:'#60a5fa', success:'#4ade80', warning:'#f59e0b', danger:'#f87171' },
}
const output = []
const externalCases = ${JSON.stringify(externalCases ?? null)}
for (const mode of ['light', 'dark']) {
  const cases = externalCases || mermaidDiagramTypes.map(({ type }) => ({ type, name: type, source: createTemplate(type, '测试图表') }))
  for (const { type, name = type, source } of cases) {
    try {
      const renderSource = normalizeMermaidSourceForRender(type, source)
      const config = mermaidVisualConfig(type, palettes[mode], renderSource)
      mermaid.initialize({ ...config, fontFamily: config.fontFamily ?? 'Arial, sans-serif' })
      const { svg: renderedSvg } = await mermaid.render('smoke-' + mode + '-' + type + '-' + Math.random().toString(36).slice(2), renderSource)
      const svg = fitMermaidSvgToContent(renderedSvg, config.themeVariables?.background)
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const root = doc.documentElement
      const viewBox = (root.getAttribute('viewBox') || '').split(/\\s+/).map(Number)
      const width = viewBox.length === 4 ? viewBox[2] : Number.parseFloat(root.getAttribute('width') || '0')
      const height = viewBox.length === 4 ? viewBox[3] : Number.parseFloat(root.getAttribute('height') || '0')
      const geometry = inspectRenderedSvg(svg, type)
      const quality = assessMermaidVisualQuality(type, source)
      const qualityReport = summarizeMermaidQuality(type, quality, { width, height, ...geometry })
      output.push({ mode, type, name, ok: true, width: Math.round(width), height: Math.round(height), quality, qualityReport, geometry })
    } catch (error) {
      output.push({ mode, type, name, ok: false, error: error instanceof Error ? error.message : String(error), quality: assessMermaidVisualQuality(type, source) })
    }
    document.body.replaceChildren()
  }
}
function inspectRenderedSvg(svg, type) {
  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.visibility = 'hidden'
  host.innerHTML = svg
  document.body.appendChild(host)
  const svgEl = host.querySelector('svg')
  if (!svgEl) {
    host.remove()
    return { contentOverflow: 0, nodeOverlaps: 0, labelOverlaps: 0 }
  }
  const bounds = safeRect(svgEl)
  const contentEntries = [...svgEl.querySelectorAll('text, foreignObject')]
    .map((element) => ({
      box: safeRect(element),
      tag: element.tagName,
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    }))
    .filter((entry) => entry.box && entry.box.width > 0 && entry.box.height > 0 && entry.text.length > 0)
  const overflowEntries = bounds ? contentEntries.filter((entry) => !rectContains(bounds, entry.box, 3)) : []
  const contentOverflow = overflowEntries.length
  const nodeSelector = type === 'flowchart' || type === 'state' || type === 'class' ? 'g.node' : ''
  const nodes = nodeSelector ? [...svgEl.querySelectorAll(nodeSelector)].map(safeRect).filter(Boolean) : []
  const labels = [...svgEl.querySelectorAll('g.edgeLabel')].map(safeRect).filter(Boolean)
  // Mermaid Sankey intentionally paints the same text twice at the exact
  // coordinates for contrast. Count distinct visual labels, not SVG layers.
  const seenText = new Set()
  const textBoxes = [...svgEl.querySelectorAll('text')].flatMap((element) => {
    const label = (element.textContent || '').trim()
    const box = safeRect(element)
    if (!label || !box) return []
    const key = label + ':' + [box.x, box.y, box.width, box.height]
      .map((value) => Math.round(value * 10) / 10).join(',')
    if (seenText.has(key)) return []
    seenText.add(key)
    return [box]
  })
  const result = {
    contentOverflow,
    nodeOverlaps: countOverlappingRects(nodes, 4),
    labelOverlaps: countOverlappingRects(labels, 8),
    textOverlaps: countOverlappingRects(textBoxes, 2),
    overflowSamples: overflowEntries.slice(0, 10).map((entry) => entry.tag + ':' + entry.text),
  }
  host.remove()
  return result
}
function safeRect(element) {
  try {
    const box = element.getBoundingClientRect()
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return undefined
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  } catch {
    return undefined
  }
}
const pre = document.createElement('pre')
pre.id = 'result'
pre.textContent = JSON.stringify(output)
document.body.appendChild(pre)
`
}
