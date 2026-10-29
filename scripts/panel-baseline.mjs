import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Panel pixel baselines.
 *
 * The panel chrome (thread header, toolbar, tab strip, panes) has no automated
 * visual gate: `visual:smoke` and `visual:regression` only render diagrams, not
 * the panel that hosts them. This script mounts the shipped `package/dist/app.js`
 * against a stub host, screenshots the three real chrome shapes, and stores them
 * as baselines so a refactor cannot silently move the panel around.
 *
 * Usage:
 *   node scripts/panel-baseline.mjs --update   # write baselines
 *   node scripts/panel-baseline.mjs            # compare, report drift
 *   node scripts/panel-baseline.mjs --strict   # exit non-zero on drift
 *
 * Baselines are byte hashes, so they drift with Chrome and font versions; a
 * mismatch means "look at it", which is why only --strict fails the build.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselineDir = path.join(root, 'tests/fixtures/panel-baseline')
const resultDir = path.join(root, 'test-results/panel-baseline')
const update = process.argv.includes('--update')
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
const budgetOverride = Number(process.argv.find((arg) => arg.startsWith('--budget='))?.slice('--budget='.length)) || 0
const strict = process.argv.includes('--strict')

// Pixel comparison uses 8x8 block averages: Chrome re-rasterises text with faint
// antialiasing differences between runs, so exact hashes would flag every run and
// train reviewers to ignore the gate. Block averages drop that noise while a moved
// or recoloured control still registers. sha256 stays in the manifest as evidence.
const PIXEL_BLOCK = 8
const BLOCK_DELTA = 12
const MAX_CHANGED_BLOCKS = 6

// Exact hashes are too brittle for a pixel gate: Chrome re-rasterises text with
// faint antialiasing differences between runs, which would make every run drift
// and train reviewers to ignore it. Compare 8x8 block averages instead —
// sub-pixel text noise disappears, a moved or recoloured control does not.
// sha256 stays in the manifest as an audit trail.


const workspacePath = root
const mermaidPath = 'docs/diagrams/对话跟随链路.mmd'
const canvasPath = 'docs/diagrams/diagram-plugin-运行时架构.diagram.json'

const cases = [
  { id: 'workspace', surface: 'workspace', width: 1440, height: 900 },
  { id: 'thread-wide', surface: 'thread', width: 1100, height: 900 },
  { id: 'thread-narrow', surface: 'thread', width: 420, height: 900 },
  // The canvas editor is the largest component in the repo and had no pixel
  // coverage at all; this pins its panel rendering.
  {
    id: 'thread-canvas',
    surface: 'thread',
    width: 1100,
    height: 900,
    settleMs: 1600,
    action: {
      label: '切换到画布文档',
      click: '.thread-diagram-tab:nth-child(2) .thread-diagram-tab-main',
      expectPresent: ['.freeform-svg'],
      expectCalls: ['diagram.get'],
    },
  },
  // Undo must be wired to the same history the toolbar renders. Tidy the
  // architecture routing (one real commit), then undo and expect the source
  // text to be byte-identical to what it was before.
  {
    id: 'canvas-undo',
    surface: 'thread',
    width: 1100,
    height: 900,
    settleMs: 1600,
    action: {
      label: '整理连线后撤销',
      prepare: `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const source = () => [...document.querySelectorAll('[data-element-id]')]
          .map((element) => element.getAttribute('data-element-id') + ':' + element.getAttribute('transform'))
          .join('|')
        const canvasTab = document.querySelector('.thread-diagram-tab:nth-child(2) .thread-diagram-tab-main')
        if (!canvasTab) return 'missing canvas tab'
        canvasTab.click()
        for (let attempt = 0; attempt < 60 && !document.querySelector('.freeform-svg'); attempt += 1) await wait(50)
        if (!document.querySelector('.freeform-svg')) return 'canvas editor did not open'
        const button = (text) => [...document.querySelectorAll('.freeform-floating-toolbar button, [role="menu"] button, .freeform-toolbar-menu button')]
          .find((item) => (item.textContent || '').trim() === text)
        window.__orig = source()
        const trigger = [...document.querySelectorAll('.freeform-floating-toolbar button')]
          .find((item) => (item.textContent || '').trim().startsWith('布局'))
        if (!trigger) return 'missing layout trigger'
        trigger.click()
        for (let attempt = 0; attempt < 40 && !button('重新整理'); attempt += 1) await wait(50)
        const tidy = button('重新整理')
        if (!tidy) return 'missing tidy button'
        tidy.click()
        for (let attempt = 0; attempt < 60 && source() === window.__orig; attempt += 1) await wait(50)
        if (source() === window.__orig) return 'tidy did not change the source'
        window.__tidied = source()
        return 'ok'
      })()`,
      click: 'button[aria-label="撤销"]',
      expectEval: [
        { expression: `[...document.querySelectorAll('[data-element-id]')].map((element) => element.getAttribute('data-element-id') + ':' + element.getAttribute('transform')).join('|') === window.__orig`, expected: true },
        { expression: `document.querySelector('button[aria-label="重做"]').disabled`, expected: false },
      ],
    },
  },
  // Selection through the layer panel: a real click must select exactly one
  // node and open the inspector. The panel lists every node, so this avoids
  // clicking architecture geometry that may sit outside the visible preview.
  {
    id: 'canvas-layer-select',
    surface: 'thread',
    width: 1100,
    height: 900,
    settleMs: 1600,
    action: {
      label: '从层级面板选择节点',
      prepare: `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const canvasTab = document.querySelector('.thread-diagram-tab:nth-child(2) .thread-diagram-tab-main')
        if (!canvasTab) return 'missing canvas tab'
        canvasTab.click()
        for (let attempt = 0; attempt < 60 && !document.querySelector('.freeform-svg'); attempt += 1) await wait(50)
        if (!document.querySelector('.freeform-svg')) return 'canvas editor did not open'
        const layers = [...document.querySelectorAll('.freeform-floating-toolbar button')]
          .find((item) => (item.textContent || '').trim() === '层级')
        if (!layers) return 'missing layers button'
        layers.click()
        for (let attempt = 0; attempt < 40 && !document.querySelector('.freeform-layer-panel'); attempt += 1) await wait(50)
        return document.querySelector('.freeform-layer-panel') ? 'ok' : 'layers panel did not open'
      })()`,
      click: '.freeform-layer-panel section:last-of-type button',
      expectEval: [
        { expression: `document.querySelectorAll('.freeform-box.is-selected').length`, expected: 1 },
        { expression: `Boolean(document.querySelector('.freeform-inspector'))`, expected: true },
      ],
    },
  },
  // A fresh AI proposal opens its review surface; this pins that dialog at panel width.
  { id: 'thread-proposal-review', surface: 'thread', width: 420, height: 900, proposal: true, settleMs: 2600 },
  // Interaction cases: a click must reach the host and move the surface. Pixels alone
  // cannot tell a working button from a button wired to nothing.
  {
    id: 'proposal-reject',
    surface: 'thread',
    width: 420,
    height: 900,
    proposal: true,
    settleMs: 2600,
    action: {
      label: '拒绝',
      click: '.change-review-actions button',
      expectGone: ['.change-review-panel'],
      expectCalls: ['diagram.dismissProposal'],
    },
  },
  {
    id: 'proposal-accept',
    surface: 'thread',
    width: 420,
    height: 900,
    proposal: true,
    settleMs: 2600,
    action: {
      label: '全部接受',
      click: '.change-review-actions .primary-button',
      expectGone: ['.change-review-panel'],
      expectCalls: ['diagram.applyProposal'],
      expectText: [{ selector: '.save-state', text: '已保存' }],
    },
  },
]

function selected() {
  return only ? cases.filter((testCase) => testCase.id === only) : cases
}

const chrome = await findChrome()
if (!chrome) throw new Error('面板基线未执行：未找到 Chrome/Chromium。')

const mermaidSource = await readFile(path.join(root, mermaidPath), 'utf8')
const canvasSource = await readFile(path.join(root, canvasPath), 'utf8')
const modifiedAt = '2026-10-28T10:00:00.000Z'

const diagrams = [
  { path: mermaidPath, name: '对话跟随链路', type: 'flowchart', modifiedAt },
  { path: canvasPath, name: 'diagram-plugin 运行时架构', type: 'canvas', modifiedAt, canvasWorkbench: 'architecture' },
  { path: 'docs/diagrams/插件能力地图.mmd', name: '插件能力地图', type: 'mindmap', modifiedAt },
]

const sources = new Map([
  [mermaidPath, mermaidSource],
  [canvasPath, canvasSource],
])

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/app.js' || url.pathname === '/app.css') {
    const file = path.join(root, 'package/dist', url.pathname.slice(1))
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'content-type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' })
      response.end(body)
    } catch {
      response.writeHead(404).end('missing build output; run pnpm build first')
    }
    return
  }
  const surface = url.searchParams.get('surface') === 'workspace' ? 'workspace' : 'thread'
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(harnessHtml(surface, { proposal: url.searchParams.get('proposal') === '1' }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

try {
  await mkdir(resultDir, { recursive: true })
  if (update) await mkdir(baselineDir, { recursive: true })
  const manifest = {}
  const failures = []
  const drift = []
  const boxes = process.argv.includes('--boxes')
  const dumpDom = process.argv.includes('--dump-dom')
  for (const testCase of selected()) {
    const file = path.join(resultDir, `${testCase.id}.png`)
    const url = `http://127.0.0.1:${port}/?surface=${testCase.surface}${testCase.proposal ? '&proposal=1' : ''}`
    await withPage(url, testCase, async (client) => {
      if (boxes) {
        console.log(`\n${testCase.id} (${testCase.width}x${testCase.height}):\n${await evaluate(client, boxProbe())}`)
        return
      }
      if (dumpDom) {
        const dom = await evaluate(client, 'document.documentElement.outerHTML')
        await writeFile(path.join(resultDir, `${testCase.id}.html`), dom)
        console.log(`${testCase.id}: ${dom.length} bytes of DOM`)
        return
      }
      let actionResult
      if (testCase.action) {
        actionResult = await runAction(client, testCase.action)
        if (actionResult.ok) {
          console.log(`${testCase.id}: ${testCase.action.label} → ok (${(actionResult.calls || []).length} host calls)`)
        } else {
          console.log(`${testCase.id}: ${testCase.action.label} → FAILED — ${actionResult.reason}`)
          failures.push(`${testCase.id}: ${actionResult.reason}`)
        }
      }
      // Poll storms are invisible in pixels, so count host calls instead: a stable panel
      // talks to the host a handful of times, a re-render loop talks hundreds of times.
      const calls = await evaluate(client, 'JSON.stringify(window.__calls || [])')
      const byTool = {}
      for (const entry of JSON.parse(calls)) {
        const name = entry.split(':')[1] || entry
        byTool[name] = (byTool[name] || 0) + 1
      }
      const totalCalls = Object.values(byTool).reduce((sum, count) => sum + count, 0)
      const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const bytes = Buffer.from(shot.result.data, 'base64')
      await writeFile(file, bytes)
      manifest[testCase.id] = {
        surface: testCase.surface,
        width: testCase.width,
        height: testCase.height,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        toolCalls: { total: totalCalls, byTool },
        ...(testCase.action ? { action: { label: testCase.action.label, ok: Boolean(actionResult?.ok) } } : {}),
      }
      if (!update) {
        const reason = await compareOne(client, testCase.id, manifest[testCase.id])
        if (reason) drift.push(reason)
      }
    })
  }
  await writeFile(path.join(resultDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (failures.length > 0) {
    console.log(`Panel interactions failed: ${failures.length}`)
    process.exitCode = 1
  }
  if (update) {
    for (const testCase of selected()) {
      const from = path.join(resultDir, `${testCase.id}.png`)
      await writeFile(path.join(baselineDir, `${testCase.id}.png`), await readFile(from))
    }
    // --only updates one shape; keep the other stored entries instead of dropping them.
    let stored = {}
    try {
      stored = JSON.parse(await readFile(path.join(baselineDir, 'manifest.json'), 'utf8'))
    } catch {}
    await writeFile(path.join(baselineDir, 'manifest.json'), `${JSON.stringify({ ...stored, ...manifest }, null, 2)}\n`)
    console.log(`Panel baselines written: ${cases.length} shape(s) -> ${path.relative(root, baselineDir)}`)
  } else {
    const noisy = Object.entries(manifest)
      .map(([id, entry]) => ({ id, total: entry.toolCalls?.total ?? 0, budget: budgetOverride || (cases.find((item) => item.id === id)?.maxCalls) || 24 }))
      .filter((entry) => entry.total > entry.budget)
    if (noisy.length > 0) {
      for (const entry of noisy) console.log(`Panel call budget exceeded: ${entry.id} made ${entry.total} host calls (budget ${entry.budget})`)
      process.exitCode = 1
    }
    if (drift.length === 0) {
      console.log(`Panel baselines match (${cases.length} shapes).`)
      const callSummary = Object.entries(manifest).map(([id, entry]) => id + '=' + (entry.toolCalls?.total ?? 0)).join(' ')
      console.log('Panel host calls: ' + callSummary)
    } else {
      console.log(`Panel baseline drift: ${drift.join(', ')}`)
      console.log(`Fresh screenshots: ${path.relative(root, resultDir)}`)
      if (strict) process.exitCode = 1
    }
  }
} finally {
  server.close()
}

// Exact hashes are too brittle for a pixel gate: Chrome re-rasterises text with
// faint antialiasing differences between runs, which turned every run into
// "drift" and would train reviewers to ignore it. Compare 8x8 block averages
// instead — sub-pixel text noise disappears, a moved or recoloured control does
// not. sha256 stays in the manifest as an audit trail.

async function compareOne(client, id, entry) {
  let previous
  try {
    previous = JSON.parse(await readFile(path.join(baselineDir, 'manifest.json'), 'utf8'))
  } catch {
    console.log('No panel baseline yet; run `node scripts/panel-baseline.mjs --update`.')
    return undefined
  }
  if (!previous[id]) return `${id}(new)`
  const baseline = await readFile(path.join(baselineDir, `${id}.png`))
  const fresh = await readFile(path.join(resultDir, `${id}.png`))
  const result = await evaluate(client, `(async () => {
    const decode = async (base64) => {
      const blob = await (await fetch('data:image/png;base64,' + base64)).blob()
      return await createImageBitmap(blob)
    }
    const a = await decode(${JSON.stringify(baseline.toString('base64'))})
    const b = await decode(${JSON.stringify(fresh.toString('base64'))})
    if (a.width !== b.width || a.height !== b.height) {
      return { sizeMismatch: true, a: [a.width, a.height], b: [b.width, b.height] }
    }
    const canvas = new OffscreenCanvas(a.width, a.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const pixels = (bitmap) => {
      context.clearRect(0, 0, a.width, a.height)
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, a.width, a.height).data
    }
    const left = pixels(a)
    const right = pixels(b)
    const size = ${PIXEL_BLOCK}
    let changed = 0
    let worst = 0
    for (let by = 0; by < a.height; by += size) {
      for (let bx = 0; bx < a.width; bx += size) {
        let sum = 0
        let count = 0
        for (let y = by; y < Math.min(by + size, a.height); y += 1) {
          for (let x = bx; x < Math.min(bx + size, a.width); x += 1) {
            const i = (y * a.width + x) * 4
            sum += Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2])
            count += 3
          }
        }
        const delta = sum / Math.max(1, count)
        if (delta > ${BLOCK_DELTA}) changed += 1
        if (delta > worst) worst = delta
      }
    }
    return { sizeMismatch: false, changed, worst: Math.round(worst) }
  })()`)
  if (result.sizeMismatch) return `${id}(size ${result.a.join('x')} -> ${result.b.join('x')})`
  return result.changed > MAX_CHANGED_BLOCKS ? `${id}(${result.changed} blocks, worst ${result.worst})` : undefined
}

// Drives one real user action and asserts what the panel did about it. A rendered
// button proves nothing: the click must reach the host and the surface must change.
async function runAction(client, action) {
  if (action.prepare) {
    const prepared = await evaluate(client, action.prepare)
    if (prepared !== 'ok') return { ok: false, reason: `「${action.label}」的准备步骤失败：${prepared}` }
  }
  const clicked = await evaluate(client, `(() => {
    const target = document.querySelector(${JSON.stringify(action.click)})
    if (!target) return 'missing'
    // SVG <g> has no click(); dispatch a bubbling MouseEvent so React's
    // synthetic handler still sees a real user-shaped event.
    if (typeof target.click === 'function') target.click()
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return 'clicked'
  })()`)
  if (clicked !== 'clicked') {
    return { ok: false, reason: `找不到可点击的「${action.label}」控件 (${action.click})` }
  }
  const goneList = JSON.stringify(action.expectGone ?? [])
  const settled = await evaluate(client, `new Promise((resolve) => {
    const gone = ${goneList}
    const deadline = Date.now() + 5000
    const check = () => {
      if (gone.every((selector) => !document.querySelector(selector))) return resolve('ok')
      if (Date.now() > deadline) return resolve('timeout')
      setTimeout(check, 60)
    }
    check()
  })`)
  const wantedText = JSON.stringify(action.expectText ?? [])
  const state = JSON.parse(await evaluate(client, `JSON.stringify({
    calls: (window.__calls || []).map((entry) => String(entry).split(':')[1] || ''),
    texts: ${wantedText}.map((item) => {
      const node = document.querySelector(item.selector)
      return node ? node.textContent.trim() : null
    }),
  })`))
  if (settled !== 'ok') {
    return { ok: false, reason: `点击「${action.label}」后 5 秒内界面没有离开 ${(action.expectGone ?? []).join(', ')}（实际调用：${state.calls.join(', ') || '无'}）`, calls: state.calls }
  }
  for (const selector of action.expectPresent ?? []) {
    const present = await evaluate(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
    if (!present) {
      return { ok: false, reason: `点击「${action.label}」后没有出现 ${selector}（实际调用：${state.calls.join(', ') || '无'}）`, calls: state.calls }
    }
  }
  for (const name of action.expectCalls ?? []) {
    if (!state.calls.includes(name)) {
      return { ok: false, reason: `点击「${action.label}」没有触发 ${name}（实际调用：${state.calls.join(', ') || '无'}）`, calls: state.calls }
    }
  }
  for (const check of action.expectEval ?? []) {
    const actual = await evaluate(client, check.expression)
    if (JSON.stringify(actual) !== JSON.stringify(check.expected)) {
      return { ok: false, reason: `「${action.label}」后 ${check.expression} 是 ${JSON.stringify(actual)}，期望 ${JSON.stringify(check.expected)}`, calls: state.calls }
    }
  }
  for (const [index, item] of (action.expectText ?? []).entries()) {
    if (state.texts[index] !== item.text) {
      return { ok: false, reason: `点击「${action.label}」后 ${item.selector} 文本是 ${JSON.stringify(state.texts[index])}，期望 ${JSON.stringify(item.text)}`, calls: state.calls }
    }
  }
  return { ok: true, calls: state.calls }
}

async function freePort() {
  return await new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function waitForTargets(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      if (list.some((entry) => entry.type === 'page')) return list
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('DevTools endpoint did not start')
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (resolve) { pending.delete(message.id); resolve(message) }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  return {
    socket,
    send: (method, params = {}) => new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    }),
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  return response.result?.result?.value
}

/**
 * Chrome clamps the window to a platform minimum width, so `--window-size` alone
 * cannot produce a 420px viewport: the layout stays ~500px wide and the
 * screenshot is a crop of it. Drive the viewport through CDP instead, so the
 * captured pixels are the layout the panel actually gets.
 */
async function withPage(url, testCase, run) {
  const port = await freePort()
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    // Grayscale antialiasing keeps glyph edges stable between runs; LCD subpixel
    // text varies with window position and made every text block look changed.
    '--disable-lcd-text',
    '--force-color-profile=srgb',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(resultDir, `.chrome-${testCase.id}`)}`,
    `--remote-debugging-port=${port}`,
    url,
  ], { stdio: 'ignore' })
  try {
    const targets = await waitForTargets(port)
    const page = targets.find((entry) => entry.type === 'page' && entry.url.includes('surface='))
      ?? targets.find((entry) => entry.type === 'page')
    const client = await connect(page.webSocketDebuggerUrl)
    try {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: testCase.width,
        height: testCase.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await client.send('Page.enable')
      await evaluate(client, `new Promise((resolve) => {
        const ready = () => Boolean(document.querySelector('.thread-companion-head, .editor-toolbar'))
        const wait = () => {
          if (ready() && document.fonts.status === 'loaded') { setTimeout(resolve, ${testCase.settleMs ?? 900}); return }
          setTimeout(wait, 100)
        }
        wait()
      })`)
      return await run(client)
    } finally {
      client.socket.close()
    }
  } finally {
    child.kill()
  }
}

function boxProbe() {
  return `(() => {
  const lines = []
  const box = (label, element) => {
    if (!element) { lines.push(label + ': missing'); return }
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    lines.push(label + ': x=' + Math.round(rect.x) + ' y=' + Math.round(rect.y) + ' w=' + Math.round(rect.width) + ' h=' + Math.round(rect.height) + ' display=' + style.display)
  }
  const head = document.querySelector('.thread-companion-head')
  box('head', head)
  if (head) lines.push('head display=' + getComputedStyle(head).display + ' wrap=' + getComputedStyle(head).flexWrap)
  box('menu', document.querySelector('.thread-diagram-menu'))
  box('tabs', document.querySelector('.thread-diagram-tabs'))
  const actions = document.querySelector('.thread-document-actions')
  box('actions', actions)
  if (actions) Array.from(actions.children).forEach((child, index) => box('child' + index + ' ' + (child.getAttribute('aria-label') || (child.className || '').split(' ')[0] || child.tagName), child))
  box('toolbar', document.querySelector('.editor-toolbar'))
  lines.push('calls=' + ((window.__calls || []).join(',')))
  lines.push('banners=' + Array.from(document.querySelectorAll('.feedback-banner,.feedback-overflow')).map((el) => el.getAttribute('data-feedback')).join(','))
  lines.push('doc scrollWidth=' + document.documentElement.scrollWidth + ' clientWidth=' + document.documentElement.clientWidth)
  return lines.join(String.fromCharCode(10))
})()`
}

function harnessHtml(surface, testCase = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>Diagram panel baseline</title>
<link rel="stylesheet" href="/app.css">
<style>html,body{margin:0;height:100%;background:#fff}#root{height:100%}</style>
</head><body>
<div id="root" data-diagram-host="deepseek" data-diagram-surface="${surface}"></div>
<script>
const WORKSPACE = ${JSON.stringify(workspacePath)};
const DIAGRAMS = ${JSON.stringify(diagrams)};
const SOURCES = new Map(${JSON.stringify([...sources])});
const ACTIVE = ${JSON.stringify(testCase.active === 'canvas' ? canvasPath : mermaidPath)};
const MODIFIED = ${JSON.stringify(modifiedAt)};
const MODIFIED_ADVANCED = ${JSON.stringify(new Date(Date.parse(modifiedAt) + 1000).toISOString())};
let proposalLive = true;
const PROPOSAL = ${JSON.stringify(testCase.proposal ? {
  revision: 'proposal-7',
  path: mermaidPath,
  reason: '把入口收敛成单一对话入口，并补上异常路径',
  baseModifiedAt: modifiedAt,
  updatedAt: modifiedAt,
  scopeElementIds: ['T', 'V', 'Q'],
  newElementIds: ['V2'],
} : null)};

function snapshot() {
  return {
    kind: 'workspace',
    surface: ${JSON.stringify(surface)},
    workspacePath: WORKSPACE,
    recentWorkspaces: [WORKSPACE],
    diagrams: DIAGRAMS,
    activeDiagramPath: ACTIVE,
    threadDiagramPaths: DIAGRAMS.map((diagram) => diagram.path),
  };
}

const SNAPSHOT = snapshot();
let threadStateCalls = 0;

function answer(method, params) {
  if (method === 'openFile' || method === 'message') return {};
  if (method !== 'tool') return {};
  const name = params?.name;
  if (name === 'diagram.thread' || name === 'diagram.workspace' || name === 'diagram.list') {
    return { structuredContent: SNAPSHOT };
  }
  if (name === 'diagram.get') {
    const target = DIAGRAMS.find((diagram) => diagram.path === params.arguments?.path) ?? DIAGRAMS[0];
    return { structuredContent: { kind: 'diagram', diagram: { ...target, source: SOURCES.get(target.path) ?? '' } } };
  }
  if (name === 'diagram.proposal' && PROPOSAL && proposalLive) {
    return { structuredContent: {
      kind: 'diagram-proposal-source',
      workspacePath: WORKSPACE,
      proposal: PROPOSAL,
      before: { kind: 'diagram', path: PROPOSAL.path, type: 'mermaid', source: SOURCES.get(PROPOSAL.path) ?? '' },
      candidateSource: SOURCES.get(PROPOSAL.path) ?? '',
    } };
  }
  if (name === 'diagram.threadState') {
    return { structuredContent: {
      kind: 'diagram-thread-state',
      diagramPaths: DIAGRAMS.map((diagram) => diagram.path),
      activeDiagramPath: ACTIVE,
      updatedAt: threadStateCalls++ === 0 ? MODIFIED : MODIFIED_ADVANCED,
      activity: null,
      ...(PROPOSAL && proposalLive ? { proposal: PROPOSAL } : {}),
    } };
  }
  if (name === 'diagram.revision') {
    return { structuredContent: { kind: 'diagram-revision', revision: { path: params.arguments?.path, modifiedAt: MODIFIED } } };
  }
  if (name === 'diagram.patchHistory' || name === 'diagram.patchHistoryChain') {
    return { structuredContent: { kind: 'diagram-patch-history', path: params.arguments?.path, entries: [] } };
  }
  if (name === 'diagram.dismissProposal') {
    // The real server drops the proposal once it is answered; keeping it alive would
    // make the follow poll resurrect the review surface forever.
    proposalLive = false;
    return { structuredContent: { kind: 'diagram-proposal-dismissed' } };
  }
  if (name === 'diagram.applyProposal' && PROPOSAL) {
    proposalLive = false;
    return { structuredContent: {
      kind: 'diagram',
      workspacePath: WORKSPACE,
      diagram: {
        ...DIAGRAMS.find((diagram) => diagram.path === PROPOSAL.path),
        modifiedAt: MODIFIED_ADVANCED,
        source: SOURCES.get(PROPOSAL.path) ?? '',
      },
      proposalApply: { rebased: false, historyEntryId: 'baseline-1', historyRecorded: true },
    } };
  }
  return { structuredContent: {} };
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'diagram.ready') return;
  const channel = new MessageChannel();
  channel.port1.onmessage = ({ data }) => {
    window.__calls = window.__calls || [];
    window.__calls.push(String(data.method) + ':' + String(data.params?.name || ''));
    try {
      channel.port1.postMessage({ id: data.id, result: answer(data.method, data.params) });
    } catch (error) {
      channel.port1.postMessage({ id: data.id, error: String(error) });
    }
  };
  event.source.postMessage({
    type: 'diagram.connect',
    context: { theme: 'light', workspacePath: WORKSPACE, styles: { variables: {} } },
  }, '*', [channel.port2]);
});
</script>
<script src="/app.js"></script>
</body></html>`
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
    } catch {
      // try the next candidate
    }
  }
  return undefined
}
