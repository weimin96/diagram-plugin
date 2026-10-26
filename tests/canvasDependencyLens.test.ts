import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasKeyDependencyLens, preferKeyDependencyLens } from '../src/canvasDependencyLens.js'
import { canvasSceneToSvg, serializeCanvasScene, type CanvasScene } from '../src/canvas.js'
import { projectArchitectureCase } from '../scripts/architecture-project-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'

function sample(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas', version: 1, width: 880, height: 600, title: 'Key relations',
    architecture: { theme: 'technical' },
    elements: [
      { id: 'entry', type: 'node', x: 40, y: 50, width: 150, height: 80, text: 'Entry', emphasis: 'primary' },
      { id: 'service', type: 'node', x: 330, y: 50, width: 150, height: 80, text: 'Service', emphasis: 'primary' },
      { id: 'storage', type: 'node', x: 650, y: 50, width: 150, height: 80, text: 'Storage' },
      { id: 'key', type: 'arrow', from: 'entry', to: 'service', emphasis: 'primary' },
      { id: 'contract', type: 'arrow', from: 'service', to: 'storage' },
      { id: 'important-to-storage', type: 'arrow', from: 'entry', to: 'storage', emphasis: 'primary' },
    ],
  }
}

test('key dependency lens only uses existing primary edges or actual edges between primary nodes', () => {
  const source = sample()
  const original = serializeCanvasScene(source)
  const key = canvasKeyDependencyLens(source)
  assert.deepEqual([...key.arrowIds], ['key', 'important-to-storage'])
  assert.deepEqual([...key.nodeIds], ['entry', 'service', 'storage'])
  assert.equal(key.totalArrows, 3)
  assert.equal(serializeCanvasScene(source), original, 'reading mode cannot alter saved document')
  const noEvidence = { ...source, elements: source.elements.map((item) =>
    item.type === 'arrow' ? { ...item, emphasis: 'secondary' as const }
      : item.type === 'node' ? { ...item, emphasis: 'secondary' as const } : item) }
  assert.equal(canvasKeyDependencyLens(noEvidence).arrowIds.size, 0,
    'no key relation is better than inventing one from layout or node degree')
  const orphan = { ...source, elements: source.elements.map((item) =>
    item.id === 'key' ? { ...item, to: 'missing', emphasis: 'primary' as const } : item) }
  assert.deepEqual([...canvasKeyDependencyLens(orphan).arrowIds], ['important-to-storage'],
    'dangling or malformed connections must not appear as critical business paths')
})

test('real project produces source-preserving key dependencies with no hidden or synthesized edges', async () => {
  const generated = composeArchitectureGraph((await projectArchitectureCase()).intent)
  const saved = serializeCanvasScene(generated.scene)
  const key = canvasKeyDependencyLens(generated.scene)
  const arrows = generated.scene.elements.filter((item) => item.type === 'arrow')
  assert.equal(key.totalArrows, 26)
  assert.ok(key.arrowIds.size >= 1)
  assert.ok(key.arrowIds.size < key.totalArrows)
  for (const id of key.arrowIds) {
    const arrow = arrows.find((item) => item.id === id)
    assert.ok(arrow, 'key lens can never invent semantic relationships')
    assert.ok(key.nodeIds.has(arrow.from) && key.nodeIds.has(arrow.to))
  }
  const svg = canvasSceneToSvg(generated.scene)
  assert.match(svg, /<g opacity="0\.48"><title>/,
    'dense SVG exports give secondary routes less visual weight without dropping them')
  assert.match(svg, /<title>architectureComposer → canvas<\/title>/,
    'every de-emphasized relationship retains the real direction and hover source')
  assert.equal(serializeCanvasScene(generated.scene), saved)
  assert.equal(preferKeyDependencyLens(generated.scene), true,
    'dense real import graph defaults to evidence-backed primary reading without dropping any source edge')
})

test('ordinary, unverified, or non-architectural scenes keep complete relation reading by default', () => {
  const source = sample()
  assert.equal(preferKeyDependencyLens(source), false)
  const clone = { ...source, architecture: undefined }
  assert.equal(preferKeyDependencyLens(clone), false)
  const nodes = Array.from({ length: 7 }, (_, i) => ({
    id: `n${i}`, type: 'node' as const, x: i * 100, y: 20, width: 90, height: 45, text: `N${i}`,
  }))
  const arrows = Array.from({ length: 12 }, (_, i) => ({
    id: `edge${i}`, type: 'arrow' as const, from: `n${i % 6}`, to: 'n6',
  }))
  assert.equal(preferKeyDependencyLens({ ...source, elements: [...nodes, ...arrows] }), false,
    'high fan-in alone cannot invent verified key dependencies')
})
