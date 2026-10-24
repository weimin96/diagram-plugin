import assert from 'node:assert/strict'
import test from 'node:test'
import { d2SvgNodePositions, d2SvgToEditableCanvas } from '../scripts/d2-canvas-candidate.js'
import type { CanvasScene } from '../src/canvas.js'

const scene: CanvasScene = {
  type: 'diagram-plugin-canvas', version: 1, title: 'D2 converted candidate',
  width: 1100, height: 600, architecture: { theme: 'enterprise', view: 'detail' },
  groups: [{ id: 'g', label: 'Region', kind: 'boundary' }],
  elements: [
    { id: 'api', type: 'node', x: 130, y: 180, width: 180, height: 80, text: 'API', icon: 'api', groupId: 'g' },
    { id: 'db', type: 'node', x: 600, y: 180, width: 180, height: 80, text: 'DB', icon: 'database' },
    { id: 'wire', type: 'arrow', from: 'api', to: 'db', routing: 'orthogonal', label: '读写', points: [{ x: 430, y: 220 }] },
  ],
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg">
<g id="g0.n0"><g class="shape" ><rect x="400.0" y="260" width="180" height="80" /></g></g>
<g id="n1"><g class="shape" ><rect x="120.0" y="50" width="180" height="80" /></g></g>
</svg>`

test('D2 SVG layout creates a fully editable Canvas candidate with original relation identities', () => {
  assert.deepEqual([...d2SvgNodePositions(svg, ['g0.n0', 'n1'])], [
    ['g0.n0', { x: 400, y: 260 }], ['n1', { x: 120, y: 50 }],
  ])
  const before = JSON.stringify(scene)
  const output = d2SvgToEditableCanvas(scene, svg)
  assert.deepEqual(output.elements.filter((item) => item.type === 'node').map((node) => node.id), ['api', 'db'])
  assert.deepEqual(output.elements.filter((item) => item.type === 'node').map((node) => [node.x, node.y]), [[376, 380], [96, 170]])
  const relation = output.elements.find((item) => item.id === 'wire')
  assert.ok(relation && relation.type === 'arrow')
  assert.equal(relation.from, 'api')
  assert.equal(relation.to, 'db')
  assert.equal(relation.label, '读写')
  assert.equal(JSON.stringify(scene), before)
  assert.deepEqual(d2SvgToEditableCanvas(scene, svg), output)
})

test('D2 0.9 SVG base64 classes are parsed using the same coordinates as legacy IDs', () => {
  const modern = svg.replace('id="g0.n0"', 'class="ZzAubjA="').replace('id="n1"', 'class="bjE="')
  assert.deepEqual(d2SvgNodePositions(modern, ['g0.n0', 'n1']), d2SvgNodePositions(svg, ['g0.n0', 'n1']))
  assert.deepEqual(d2SvgToEditableCanvas(scene, modern), d2SvgToEditableCanvas(scene, svg))
})

test('D2 geometry rejects missing duplicate corrupt or unrecognized node shapes', () => {
  assert.throws(() => d2SvgToEditableCanvas(scene, svg.replace('id="n1"', 'id="missing"')), /不存在或重复/)
  assert.throws(() => d2SvgNodePositions(svg + '<g id="n1"></g>', ['n1']), /不存在或重复/)
  assert.throws(() => d2SvgNodePositions(svg.replace('width="180"', 'width="-3"'), ['g0.n0']), /几何无效/)
  assert.throws(() => d2SvgNodePositions('<g id="n1"><path d="M0 0"/></g>', ['n1']), /不受支持/)
  assert.throws(() => d2SvgNodePositions(svg, ['a.invalid.alias']), /非法/)
  assert.throws(() => d2SvgToEditableCanvas({ ...scene,
    elements: scene.elements.map((item) => item.id === 'api' ? { ...item, locked: true } : item),
  }, svg), /未锁定/)
})
