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
