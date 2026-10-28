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

const workspacePath = root
const mermaidPath = 'docs/diagrams/对话跟随链路.mmd'
const canvasPath = 'docs/diagrams/diagram-plugin-运行时架构.diagram.json'

const cases = [
  { id: 'workspace', surface: 'workspace', width: 1440, height: 900 },
  { id: 'thread-wide', surface: 'thread', width: 1100, height: 900 },
  { id: 'thread-narrow', surface: 'thread', width: 420, height: 900 },
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
    await writeFile(path.join(baselineDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`Panel baselines written: ${cases.length} shape(s) -> ${path.relative(root, baselineDir)}`)
  } else {
    const noisy = Object.entries(manifest)
      .map(([id, entry]) => ({ id, total: entry.toolCalls?.total ?? 0, budget: budgetOverride || (cases.find((item) => item.id === id)?.maxCalls) || 24 }))
      .filter((entry) => entry.total > entry.budget)
    if (noisy.length > 0) {
      for (const entry of noisy) console.log(`Panel call budget exceeded: ${entry.id} made ${entry.total} host calls (budget ${entry.budget})`)
      process.exitCode = 1
    }
    const drift = await compare(manifest)
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

async function compare(current) {
  let previous
  try {
    previous = JSON.parse(await readFile(path.join(baselineDir, 'manifest.json'), 'utf8'))
  } catch {
    console.log('No panel baseline yet; run `node scripts/panel-baseline.mjs --update`.')
    return []
  }
  return Object.keys(current).filter((id) => previous[id]?.sha256 !== current[id].sha256)
}

// Drives one real user action and asserts what the panel did about it. A rendered
// button proves nothing: the click must reach the host and the surface must change.
async function runAction(client, action) {
  const clicked = await evaluate(client, `(() => {
    const target = document.querySelector(${JSON.stringify(action.click)})
    if (!target) return 'missing'
    target.click()
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
  for (const name of action.expectCalls ?? []) {
    if (!state.calls.includes(name)) {
      return { ok: false, reason: `点击「${action.label}」没有触发 ${name}（实际调用：${state.calls.join(', ') || '无'}）`, calls: state.calls }
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
const ACTIVE = ${JSON.stringify(mermaidPath)};
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
