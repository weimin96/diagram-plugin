import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureCases } from './fixtures/architecture/cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasArrowBoxRoute, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { layoutWithElk } from '../scripts/elk-architecture-candidate.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'
import { measureEditableArchitecture } from '../scripts/architecture-layout-gate.js'

test('ELK 实验候选不修改原图，节点/关系/语义分区与历史序列化保持完整', async () => {
  const input = composeArchitectureGraph(architectureCases.find((item) => item.id === 'data-platform')!.intent).scene
  const original = serializeCanvasScene(input)
  for (const variant of ['flat', 'compound', 'native', 'native-compound'] as const) {
    const result = await layoutWithElk(input, variant)
    assert.deepEqual(result.elements.map((element) => element.id), input.elements.map((element) => element.id))
    assert.deepEqual(result.elements.filter((element) => element.type === 'node')
      .map(({ id, groupId, icon, stencil }) => ({ id, groupId, icon, stencil })),
    input.elements.filter((element) => element.type === 'node')
      .map(({ id, groupId, icon, stencil }) => ({ id, groupId, icon, stencil })))
    assert.deepEqual(result.elements.filter((element) => element.type === 'arrow')
      .map(({ id, from, to }) => ({ id, from, to })),
    input.elements.filter((element) => element.type === 'arrow')
      .map(({ id, from, to }) => ({ id, from, to })))
    assert.deepEqual(result.groups, input.groups)
    for (const element of result.elements) {
      if (element.type !== 'node') continue
      assert.ok(Number.isFinite(element.x) && Number.isFinite(element.y))
      assert.ok(element.x >= 0 && element.x + element.width <= result.width, element.id)
      assert.ok(element.y >= 0 && element.y + element.height <= result.height, element.id)
    }
    assert.ok(result.width > 0 && result.height > 0)
    assert.ok(assessCanvasVisualQuality(result).metrics.nodeOverlaps === 0)
    assert.equal(parseCanvasScene(serializeCanvasScene(result)).elements.length, input.elements.length)
  }
  assert.equal(serializeCanvasScene(input), original)
})

test('ELK 原生路径保留可编辑折点、端点和 SVG/JSON 兼容', async () => {
  const scene = composeArchitectureGraph(architectureCases.find((item) => item.id === 'data-platform')!.intent).scene
  const result = await layoutWithElk(scene, 'native')
  const arrows = result.elements.filter((item) => item.type === 'arrow')
  assert.equal(arrows.length, scene.elements.filter((item) => item.type === 'arrow').length)
  assert.ok(arrows.every((arrow) => arrow.routing === 'orthogonal'))
  assert.ok(arrows.every((arrow) => ['top', 'right', 'bottom', 'left'].includes(arrow.fromAnchor ?? '')))
  const boxes = new Map(result.elements.filter((item) => item.type === 'node').map((node) => [node.id, node]))
  for (const arrow of arrows) {
    const route = canvasArrowBoxRoute(boxes.get(arrow.from)!, boxes.get(arrow.to)!, arrow)
    assert.ok(route.slice(1).every((point, index) =>
      point.x === route[index].x || point.y === route[index].y), arrow.id)
  }
  assert.equal(parseCanvasScene(serializeCanvasScene(result)).elements.length, result.elements.length)
})

test('ELK 实验对无效依赖直接失败，不创建悬空连线', async () => {
  const input = composeArchitectureGraph(architectureCases[0].intent).scene
  const firstArrow = input.elements.find((item) => item.type === 'arrow')!
  const broken = { ...input, elements: input.elements.map((item) =>
    item.id === firstArrow.id
      ? { ...item, from: 'not-found' } : item) }
  await assert.rejects(layoutWithElk(broken, 'flat'), /Invalid relation endpoint/)
})

test('ELK compound 原生边线使用自身容器坐标，不能退化为穿节点的根坐标', async () => {
  const examples = architectureBenchmarkCases('extended')
    .filter((example) => ['microservices-fanout', 'data-platform'].includes(example.id))
  for (const example of examples) {
    const input = composeArchitectureGraph(example.intent).scene
    const untouched = serializeCanvasScene(input)
    const output = await layoutWithElk(input, 'native-compound')
    const measures = measureEditableArchitecture(output)
    assert.equal(measures.quality.nodeOverlaps, 0, example.id)
    assert.equal(measures.quality.edgeNodeIntersections, 0, example.id)
    assert.equal(measures.nonOrthogonalSegments, 0, example.id)
    assert.equal(measures.frames, 0, example.id)
    assert.deepEqual(output.elements.filter((item) => item.type === 'arrow').map(({ id, from, to }) => ({ id, from, to })),
      input.elements.filter((item) => item.type === 'arrow').map(({ id, from, to }) => ({ id, from, to })))
    assert.equal(parseCanvasScene(serializeCanvasScene(output)).elements.length, input.elements.length)
    assert.equal(serializeCanvasScene(input), untouched)
  }
})

test('ELK 原生候选遇到锁定节点时显式拒绝而非错位布线', async () => {
  const input = composeArchitectureGraph(architectureCases[0].intent).scene
  const locked = { ...input, elements: input.elements.map((item) =>
    item.type === 'node' ? { ...item, locked: true } : item) }
  await assert.rejects(layoutWithElk(locked, 'native-compound'), /locked Canvas node/)
})
