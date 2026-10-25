import assert from 'node:assert/strict'
import test from 'node:test'
import { d2OrthogonalPath, d2RelationAliases, d2SvgEdgePaths, d2SvgNodePositions, d2SvgToEditableCanvas, d2SvgToNativeBendCanvas } from '../scripts/d2-canvas-candidate.js'
import { canvasArrowBoxRoute, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
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

test('D2 原生 SVG 折线映射保留语义关系和多折点，遇到曲线显式拒绝', () => {
  const [edge] = d2RelationAliases(scene)
  assert.equal(edge.canvasId, 'wire')
  assert.equal(edge.alias, '(g0.n0 -> n1)[0]')
  const nativePath = 'M 580 300 L 700 300 S 710 300 710 310 L 710 90 S 710 80 720 80 L 800 80'
  // One native relation group, with D2 0.9's escaped arrow in the base64 class.
  const connection = `<g class="${Buffer.from(edge.alias.replace('->', '-&gt;')).toString('base64')}"><path d="${nativePath}" class="connection stroke-B1" /></g>`
  const source = svg.replace('</svg>', `${connection}</svg>`)
  assert.deepEqual(d2SvgEdgePaths(source, [edge.alias]).get(edge.alias), d2OrthogonalPath(nativePath))
  const before = serializeCanvasScene(scene)
  const candidate = d2SvgToNativeBendCanvas(scene, source)
  const actual = candidate.elements.find((item) => item.id === 'wire')
  assert.ok(actual?.type === 'arrow' && actual.points && actual.points.length > 4)
  assert.equal(actual.label, '读写')
  assert.equal(actual.from, 'api')
  assert.equal(actual.to, 'db')
  assert.equal(actual.bundleKey, undefined)
  const nodes = new Map(candidate.elements.filter((item) => item.type === 'node').map((item) => [item.id, item]))
  const route = canvasArrowBoxRoute(nodes.get(actual.from)!, nodes.get(actual.to)!, actual)
  assert.ok(route.slice(1).every((point, index) =>
    point.x === route[index].x || point.y === route[index].y), 'Canvas port bridge must remain orthogonal')
  assert.equal(parseCanvasScene(serializeCanvasScene(candidate)).elements.length, scene.elements.length)
  assert.equal(serializeCanvasScene(scene), before)
  assert.throws(() => d2SvgEdgePaths(source + connection, [edge.alias]), /不存在或重复/)
  assert.throws(() => d2SvgEdgePaths(source.replace('connection stroke-B1', 'stroke-B1'), [edge.alias]), /路径缺失/)
  assert.throws(() => d2OrthogonalPath('M 10 0 C 30 0 30 20 50 20'), /不支持的命令/)
  assert.throws(() => d2OrthogonalPath('M 10 0 L 40 30'), /不是正交/)
  assert.throws(() => d2OrthogonalPath('M 10 0 L 10 0'), /退化为空路径/)
  assert.throws(() => d2OrthogonalPath('M 10 0 L 20 0 invalid'), /不识别的内容/)
})

test('同组与重复关系使用确定性 D2 别名，防止错误映射箭头', () => {
  const duplicate: CanvasScene = {
    ...scene,
    elements: [
      ...scene.elements,
      { id: 'second', type: 'arrow', from: 'api', to: 'db' },
      { id: 'third', type: 'arrow', from: 'api', to: 'api' },
    ],
  }
  assert.deepEqual(d2RelationAliases(duplicate).map((item) => item.alias),
    ['(g0.n0 -> n1)[0]', '(g0.n0 -> n1)[1]', 'g0.(n0 -> n0)[0]'])
})

test('D2 原生边界端口无须绕回节点中点，Canvas JSON/SVG 保留不同端口', () => {
  const [edge] = d2RelationAliases(scene)
  const native = 'M 400 290 L 300 290 L 300 90'
  const connection = `<g class="${Buffer.from(edge.alias.replace('->', '-&gt;')).toString('base64')}"><path d="${native}" class="connection stroke-B1" /></g>`
  const output = d2SvgToNativeBendCanvas(scene, svg.replace('</svg>', `${connection}</svg>`))
  const from = output.elements.find((item) => item.id === 'api')
  const to = output.elements.find((item) => item.id === 'db')
  const arrow = output.elements.find((item) => item.id === 'wire')
  assert.ok(from?.type === 'node' && to?.type === 'node' && arrow?.type === 'arrow')
  assert.deepEqual([arrow.fromAnchor, arrow.toAnchor], ['left', 'right'])
  assert.deepEqual([arrow.fromPortRatio, arrow.toPortRatio], [0.375, 0.5])
  const coords = canvasArrowBoxRoute(from, to, arrow)
  assert.deepEqual(coords, [{ x: 376, y: 410 }, { x: 276, y: 410 }, { x: 276, y: 210 }])
  assert.deepEqual(canvasArrowBoxRoute(from, to, parseCanvasScene(serializeCanvasScene(output))
    .elements.find((item) => item.id === 'wire') as typeof arrow), coords)
})
