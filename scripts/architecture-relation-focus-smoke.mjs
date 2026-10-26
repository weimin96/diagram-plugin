/** Real Chrome smoke test for the React Canvas relationship lens.
 * No mocks for pointer events or the CanvasEditor; no external server.
 */
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const options = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
const chrome = (await Promise.all(options.map((candidate) =>
  access(candidate).then(() => candidate, () => undefined)))).find(Boolean)
if (!chrome) throw new Error('Relationship-focus integration test needs real Chrome/Chromium')
const temp = await mkdtemp(path.join(os.tmpdir(), 'diagram-relationship-lens-'))
let server
try {
  const scene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Relationship lens', width: 900, height: 550,
    architecture: { theme: 'technical', view: 'detail', density: 'compact' },
    groups: [{ id: 'arch-application', label: '核心应用', kind: 'boundary' }],
    elements: [
      { type: 'node', id: 'moduleA', text: 'Module A', x: 80, y: 190, width: 180, height: 80, emphasis: 'primary', groupId: 'arch-application' },
      { type: 'node', id: 'moduleB', text: 'Module B', x: 440, y: 90, width: 180, height: 80, emphasis: 'primary', groupId: 'arch-application' },
      { type: 'node', id: 'moduleC', text: 'Module C', x: 440, y: 310, width: 180, height: 80, groupId: 'arch-application' },
      { type: 'arrow', id: 'edgeA', from: 'moduleA', to: 'moduleB', routing: 'orthogonal', emphasis: 'primary' },
      { type: 'arrow', id: 'edgeB', from: 'moduleA', to: 'moduleC', routing: 'orthogonal' },
    ],
  }
  const denseScene = {
    ...scene, title: 'Dense relations', elements: [
      ...Array.from({ length: 7 }, (_, i) => ({
        type: 'node', id: 'dense-' + i, text: 'Module ' + i,
        x: 60 + i % 3 * 230, y: 70 + Math.floor(i / 3) * 150,
        width: 170, height: 80, emphasis: i === 0 || i === 6 ? 'primary' : 'secondary',
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        type: 'arrow', id: 'dense-edge-' + i, from: 'dense-' + (i % 6), to: 'dense-6',
        routing: 'orthogonal', emphasis: i === 0 ? 'primary' : 'secondary',
      })),
    ],
  }
  const publicDir = path.join(temp, 'public')
  await mkdir(publicDir)
  const entry = path.join(temp, 'entry.tsx')
  await writeFile(entry, `import React from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasEditor } from '${path.join(root, 'src/CanvasEditor.tsx')}'
const onChange = () => {}
createRoot(document.getElementById('root')!).render(<CanvasEditor
  source={${JSON.stringify(JSON.stringify(scene))}} onChange={onChange} />)
createRoot(document.getElementById('root-dense')!).render(<CanvasEditor
  source={${JSON.stringify(JSON.stringify(denseScene))}} onChange={onChange} />)
setTimeout(() => {
  const arrow = document.querySelector('[data-element-id="edgeA"].freeform-arrow')
  if (!arrow) { document.getElementById('result').textContent = JSON.stringify({error:'arrow missing'}); return }
  arrow.dispatchEvent(new PointerEvent('pointerover', {bubbles: true}))
  setTimeout(() => {
    const editor = document.querySelector('.freeform-editor')
    const result = {
      hoverFocus: editor?.classList.contains('has-relation-lens'),
      source: document.querySelector('[data-element-id="moduleA"]')?.classList.contains('is-relation-source'),
      target: document.querySelector('[data-element-id="moduleB"]')?.classList.contains('is-relation-target'),
      unrelated: document.querySelector('[data-element-id="edgeB"]')?.classList.contains('is-relation-dimmed'),
      dimOpacity: getComputedStyle(document.querySelector('[data-element-id="edgeB"]')).opacity,
      names: document.querySelector('.freeform-relation-lens')?.textContent,
    }
    arrow.dispatchEvent(new PointerEvent('pointerout', {bubbles: true}))
    setTimeout(() => {
      result.clearOnLeave = !editor?.classList.contains('has-relation-lens')
      arrow.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 1}))
      setTimeout(() => {
        result.selectionPersists = editor?.classList.contains('has-relation-lens')
        const layoutButton = [...document.querySelectorAll('button')].find((button) =>
          button.title?.includes('详情视图') && button.textContent?.includes('布局'))
        layoutButton?.click()
        setTimeout(() => {
          const keyButton = [...document.querySelectorAll('button')].find((button) =>
            button.textContent?.trim() === '关键')
          keyButton?.click()
          setTimeout(() => {
            result.keyMode = editor?.classList.contains('has-key-dependency-lens')
            result.keyCount = document.querySelector('[aria-label="关键依赖阅读模式"]')?.textContent
            result.keyArrow = document.querySelector('[data-element-id="edgeA"]')?.classList.contains('is-key-dependency')
            result.keyDimmed = document.querySelector('[data-element-id="edgeB"]')?.classList.contains('is-key-dimmed')
            result.keyDimOpacity = getComputedStyle(document.querySelector('[data-element-id="edgeB"]')).opacity
            const secondary = document.querySelector('[data-element-id="edgeB"].freeform-arrow')
            secondary?.dispatchEvent(new PointerEvent('pointerover', {bubbles: true}))
            setTimeout(() => {
              result.focusOverridesKey = editor?.classList.contains('has-relation-lens')
                && !editor?.classList.contains('has-key-dependency-lens')
              secondary?.dispatchEvent(new PointerEvent('pointerout', {bubbles: true}))
              setTimeout(() => {
                result.keyResumes = editor?.classList.contains('has-key-dependency-lens')
                const allButton = [...document.querySelectorAll('button')].find((button) =>
                  button.textContent?.trim() === '全部' && button.closest('.freeform-compact-control-row'))
                allButton?.click()
                setTimeout(() => {
                  result.keyReset = !editor?.classList.contains('has-key-dependency-lens')
                  result.allEdgesRetained = document.querySelectorAll('#root .freeform-arrow[data-element-id]').length === 2
                  const node = document.querySelector('[data-element-id="moduleA"].freeform-box')
                  node?.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 6, button: 0, clientX: 110, clientY: 220}))
                  node?.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 6, button: 0, clientX: 110, clientY: 220}))
                  setTimeout(() => {
                    const navigator = document.querySelector('[aria-label="节点真实依赖"]')
                    const relationButtons = [...(navigator?.querySelectorAll('.freeform-node-relation') ?? [])]
                    result.nodeRelationCounts = navigator?.textContent?.includes('入 0 / 出 2')
                    result.nodeRelationNames = relationButtons.map((button) => button.textContent?.trim())
                    relationButtons.find((button) => button.textContent?.includes('Module C'))?.click()
                    setTimeout(() => {
                      result.navigatorSelectsExactEdge = document.querySelector('[data-element-id="edgeB"].freeform-arrow')?.classList.contains('is-selected')
                        && document.querySelector('[data-element-id="edgeA"].freeform-arrow')?.classList.contains('is-relation-dimmed')
                      result.navigatorPreservesEdges = document.querySelectorAll('#root .freeform-arrow[data-element-id]').length === 2
                      const denseEditor = document.querySelector('#root-dense .freeform-editor')
                      result.denseDefaultKeyLens = denseEditor?.classList.contains('has-key-dependency-lens')
                      result.denseRetainsEdges = document.querySelectorAll('#root-dense .freeform-arrow[data-element-id]').length === 12
                      const denseLayoutButton = [...document.querySelectorAll('#root-dense button')].find((button) =>
                        button.title?.includes('详情视图') && button.textContent?.includes('布局'))
                      result.denseLayoutButton = Boolean(denseLayoutButton)
                      denseLayoutButton?.click()
                      setTimeout(() => {
                        const all = [...document.querySelectorAll('[aria-label="架构设置"] button')].reverse().find((button) =>
                          button.textContent?.trim() === '全部' && button.closest('.freeform-compact-control-row'))
                        result.denseAllButton = Boolean(all)
                        all?.click()
                        setTimeout(() => {
                          result.denseCanReturnToAll = !denseEditor?.classList.contains('has-key-dependency-lens')
                            && document.querySelectorAll('#root-dense .freeform-arrow[data-element-id]').length === 12
                          const search = document.querySelector('[aria-label="搜索真实依赖"]')
                          result.denseRelationSearch = Boolean(search)
                          if (search) {
                            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Module 5')
                            search.dispatchEvent(new Event('input', { bubbles: true }))
                          }
                          setTimeout(() => {
                            const matches = [...document.querySelectorAll('.freeform-relation-explorer-list button')]
                            result.denseRelationMatches = matches.length === 2
                              && matches.every((button) => button.textContent?.includes('Module 5'))
                            const previousViewBox = document.querySelector('#root-dense .freeform-svg')?.getAttribute('viewBox')
                            matches[0]?.click()
                            setTimeout(() => {
                              result.denseGlobalExactEdge = denseEditor?.classList.contains('has-relation-lens')
                                && ['dense-edge-5', 'dense-edge-11'].some((id) =>
                                  document.querySelector('#root-dense [data-element-id="' + id + '"].freeform-arrow')?.classList.contains('is-selected'))
                              result.denseGlobalPreservesEdges = document.querySelectorAll('#root-dense .freeform-arrow[data-element-id]').length === 12
                              result.denseGlobalMovesViewport = document.querySelector('#root-dense .freeform-svg')?.getAttribute('viewBox') !== previousViewBox
                              const hub = document.querySelector('#root-dense [data-element-id="dense-6"].freeform-box')
                              hub?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, button: 0, clientX: 140, clientY: 490 }))
                              hub?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, button: 0, clientX: 140, clientY: 490 }))
                              setTimeout(() => {
                                const walkthrough = document.querySelector('#root-dense [aria-label="节点依赖逐条阅读"]')
                                result.hubReadingOffer = walkthrough?.textContent?.includes('入 12 / 出 0')
                                const beforeGuidedView = document.querySelector('#root-dense .freeform-svg')?.getAttribute('viewBox')
                                walkthrough?.querySelector('button')?.click()
                                setTimeout(() => {
                                  result.guidedCamera = document.querySelector('#root-dense .freeform-svg')?.getAttribute('viewBox') !== beforeGuidedView
                                  const first = [...document.querySelectorAll('#root-dense .freeform-arrow.is-relation-focused')].map((node) => node.getAttribute('data-element-id'))
                                  result.guidedFirst = first.length === 1 && first[0]?.startsWith('dense-edge-')
                                    && walkthrough?.textContent?.includes('1/12')
                                  walkthrough?.querySelector('[aria-label="下一条依赖"]')?.click()
                                  setTimeout(() => {
                                    const next = [...document.querySelectorAll('#root-dense .freeform-arrow.is-relation-focused')].map((node) => node.getAttribute('data-element-id'))
                                    result.guidedAdvances = next.length === 1 && next[0] !== first[0]
                                      && walkthrough?.textContent?.includes('2/12')
                                    result.guidedRetainsAll = document.querySelectorAll('#root-dense .freeform-arrow[data-element-id]').length === 12
                                    walkthrough?.querySelector('[aria-label="退出逐条阅读"]')?.click()
                                    setTimeout(() => {
                                      result.guidedExit = !document.querySelector('#root-dense .freeform-arrow.is-relation-focused')
                                        && Boolean(document.querySelector('#root-dense [aria-label="节点依赖逐条阅读"]'))
                                      document.getElementById('result').textContent = JSON.stringify(result)
                                    }, 90)
                                  }, 90)
                                }, 90)
                              }, 90)
                            }, 100)
                          }, 100)
                        }, 100)
                      }, 100)
                    }, 100)
                  }, 100)
                }, 110)
              }, 110)
            }, 110)
          }, 110)
        }, 110)
      }, 100)
    }, 100)
  }, 120)
}, 400)`)
  await build({ entryPoints: [entry], outfile: path.join(publicDir, 'test.js'),
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.join(root, 'src') }, nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' })
  await writeFile(path.join(publicDir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">' +
    '<style>.freeform-surface{width:1080px;height:720px}.freeform-svg{width:100%;height:100%}</style>' +
    '<div id="root"></div><div id="root-dense"></div><pre id="result">pending</pre><script type="module" src="/test.js"></script>')
  await writeFile(path.join(publicDir, 'styles.css'), await readFile(path.join(root, 'src/styles.css'), 'utf8'))
  const port = 18000 + Math.floor(Math.random() * 12000)
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', publicDir],
    { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const { stdout } = await promisify(execFile)(chrome, ['--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(temp, 'chrome')}`, '--virtual-time-budget=7000', '--dump-dom',
    `http://127.0.0.1:${port}/`], { timeout: 30000, maxBuffer: 10_000_000 })
  const encoded = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1]
  if (!encoded) throw new Error('Chrome relationship-lens smoke produced no test result')
  const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'))
  console.log('CHROME_RELATIONSHIP_LENS', JSON.stringify(result))
  if (!result.hoverFocus || !result.source || !result.target || !result.unrelated
    || !result.names?.includes('Module A→Module B')
    || Number(result.dimOpacity) > .2 || !result.clearOnLeave || !result.selectionPersists
    || !result.keyMode || !result.keyArrow || !result.keyDimmed
    || !result.keyCount?.includes('1/2') || Number(result.keyDimOpacity) > .2
    || !result.focusOverridesKey || !result.keyResumes || !result.keyReset || !result.allEdgesRetained
    || !result.nodeRelationCounts || result.nodeRelationNames?.length !== 2
    || !result.navigatorSelectsExactEdge || !result.navigatorPreservesEdges
    || !result.denseDefaultKeyLens || !result.denseRetainsEdges || !result.denseCanReturnToAll
    || !result.denseRelationSearch || !result.denseRelationMatches || !result.denseGlobalExactEdge
    || !result.denseGlobalPreservesEdges || !result.denseGlobalMovesViewport
    || !result.hubReadingOffer || !result.guidedFirst || !result.guidedAdvances || !result.guidedCamera
    || !result.guidedRetainsAll || !result.guidedExit) {
    throw new Error('The real React Canvas relationship lens failed visual/state interaction checks')
  }
} finally {
  server?.kill()
  await rm(temp, { force: true, recursive: true })
}
