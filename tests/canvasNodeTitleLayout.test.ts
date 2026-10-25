import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasArchitecturePlainTitleLines } from '../src/canvasNodeTitleLayout.js'
import { canvasSceneToSvg, serializeCanvasScene, type CanvasScene } from '../src/canvas.js'
import { projectArchitectureCase } from '../scripts/architecture-project-cases.js'

test('long real source-module names wrap at camel boundaries without shrinking or deleting characters', async () => {
  const sample = await projectArchitectureCase()
  for (const node of sample.intent.nodes) {
    const lines = canvasArchitecturePlainTitleLines(node.text, 188, 80, 'monospace')
    assert.equal(lines.join(''), node.text, `must retain every character of ${node.text}`)
    assert.ok(lines.length <= 3, `80px high cards allow three full-size lines: ${node.text}`)
    assert.ok(lines.every((line) => line.length * 15 * 0.61 <= 188 - 24),
      `all rendered lines must remain inside the card: ${node.text}`)
  }
  assert.deepEqual(canvasArchitecturePlainTitleLines('architecturePresentationQuality', 188, 80, 'monospace'),
    ['architecture', 'Presentation', 'Quality'])
  assert.deepEqual(canvasArchitecturePlainTitleLines('canvasQuality', 188, 80, 'monospace'), ['canvasQuality'])
})

test('architecture SVG and Canvas editor share semantic title layout without rewriting saved node text', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Module names', width: 800, height: 450,
    architecture: { theme: 'technical', view: 'detail', density: 'compact' },
    elements: [
      { id: 'long', type: 'node', text: 'architecturePresentationQuality', x: 100, y: 100, width: 188, height: 80 },
      { id: 'short', type: 'node', text: 'canvasQuality', x: 440, y: 100, width: 188, height: 80 },
      { id: 'edge', type: 'arrow', from: 'long', to: 'short' },
    ],
  }
  const before = serializeCanvasScene(source)
  const svg = canvasSceneToSvg(source)
  assert.match(svg, /font-size="15" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"[^>]*>architecture<\/text>/)
  assert.match(svg, />Presentation<\/text>/)
  assert.match(svg, />Quality<\/text>/)
  assert.doesNotMatch(svg, />architecturePresentationQuality<\/text>/,
    'the title must be visibly wrapped rather than overflowing the physical node')
  assert.equal(serializeCanvasScene(source), before, 'visual wrapping cannot alter persisted node labels or geometry')

  const plain = canvasSceneToSvg({ ...source, architecture: undefined })
  assert.match(plain, />architecturePresentationQuality<\/text>/,
    'ordinary user-edited Canvas nodes must not unexpectedly inherit automatic architecture wrapping')
})

test('architecture export distinguishes verified primary nodes without overwriting authored colors', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Emphasis', width: 750, height: 300,
    architecture: { theme: 'technical', view: 'detail', density: 'compact' },
    elements: [
      { id: 'main', type: 'node', text: 'Primary', x: 20, y: 70, width: 160, height: 80, emphasis: 'primary' },
      { id: 'peer', type: 'node', text: 'Secondary', x: 230, y: 70, width: 160, height: 80, emphasis: 'secondary' },
      { id: 'custom', type: 'node', text: 'Custom', x: 440, y: 70, width: 160, height: 80,
        emphasis: 'primary', fillColor: '#223344' },
    ],
  }
  const original = serializeCanvasScene(scene)
  const svg = canvasSceneToSvg(scene)
  assert.equal((svg.match(/fill-opacity="0.05" pointer-events="none"/g) ?? []).length, 1,
    'only the primary unstyled architecture node gets a subtle visual tint')
  assert.equal((svg.match(/font-weight="700"/g) ?? []).length, 2,
    'primary node typography is visually distinct without changing the saved labels')
  assert.match(svg, /fill="#223344"/, 'custom background remains authoritative')
  assert.equal(serializeCanvasScene(scene), original)
})

test('exported architecture SVG exposes the real relation endpoints on hover without adding visible labels', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Real relations', width: 700, height: 300,
    architecture: { theme: 'technical', view: 'detail' },
    elements: [
      { id: 'api', type: 'node', text: 'API', x: 40, y: 90, width: 160, height: 80 },
      { id: 'store', type: 'node', text: 'Store', x: 420, y: 90, width: 160, height: 80 },
      { id: 'dep', type: 'arrow', from: 'api', to: 'store', label: 'sync & audit' },
    ],
  }
  const before = serializeCanvasScene(source)
  const svg = canvasSceneToSvg(source)
  assert.match(svg, /<title>api → store · sync &amp; audit<\/title>/)
  assert.equal(serializeCanvasScene(source), before, 'tooltips cannot change relation semantics')
  assert.doesNotMatch(canvasSceneToSvg({ ...source, architecture: undefined }), /<title>api → store/,
    'normal user-authored freeform canvases retain their existing export behavior')
})
