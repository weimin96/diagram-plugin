import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureCases } from './fixtures/architecture/cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasArrowBoxRoute, canvasGroupFrames, parseCanvasScene, serializeCanvasScene, type CanvasNode } from '../src/canvas.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { compactElkSceneBounds, layoutWithElk, placeElkWithinOriginalCanvas } from '../scripts/elk-architecture-candidate.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'
import { compareEditableArchitectureSemantics, measureEditableArchitecture } from '../scripts/architecture-layout-gate.js'

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
  assert.ok(arrows.some((arrow) => arrow.fromPortRatio !== undefined || arrow.toPortRatio !== undefined))
  assert.equal(parseCanvasScene(serializeCanvasScene(result)).elements.length, result.elements.length)
  const compact = compactElkSceneBounds(result)
  const compactAgain = compactElkSceneBounds(compact)
  assert.deepEqual(compactAgain, compact, 'bounds normalization must be idempotent')
  assert.ok(compact.width <= result.width && compact.height <= result.height)
  for (const frame of canvasGroupFrames(compact)) {
    assert.ok(frame.x >= 0 && frame.y >= 0, 'never clip an architecture frame title/header')
    assert.ok(frame.x + frame.width <= compact.width && frame.y + frame.height <= compact.height,
      'preserve entire authored/automatic group boundary')
  }
  assert.ok(compact.elements.every((item, index) => item.id === result.elements[index].id))
  const sourceBox = new Map(result.elements.filter((item) => item.type === 'node').map((item) => [item.id, item]))
  const compactBox = new Map(compact.elements.filter((item) => item.type === 'node').map((item) => [item.id, item]))
  for (const arrow of arrows) {
    const shifted = compact.elements.find((item) => item.id === arrow.id)
    assert.ok(shifted?.type === 'arrow')
    const before = canvasArrowBoxRoute(sourceBox.get(arrow.from)!, sourceBox.get(arrow.to)!, arrow)
    const after = canvasArrowBoxRoute(compactBox.get(shifted.from)!, compactBox.get(shifted.to)!, shifted)
    assert.equal(before.length, after.length)
    for (let i = 1; i < before.length; i++) {
      assert.deepEqual({ x: after[i].x - after[0].x, y: after[i].y - after[0].y },
        { x: before[i].x - before[0].x, y: before[i].y - before[0].y }, arrow.id)
    }
  }
  assert.deepEqual(measureEditableArchitecture(compact).quality, measureEditableArchitecture(result).quality)
  assert.equal(parseCanvasScene(serializeCanvasScene(compact)).elements.length, compact.elements.length)
  const sameSize = { ...scene, width: compact.width + 100, height: compact.height + 80 }
  const repositioned = placeElkWithinOriginalCanvas(sameSize, compact)
  assert.ok(repositioned, 'a candidate smaller than the source canvas must fit by translation')
  assert.equal(repositioned.width, sameSize.width)
  assert.equal(repositioned.height, sameSize.height)
  assert.deepEqual(measureEditableArchitecture(repositioned).quality, measureEditableArchitecture(compact).quality)
  assert.equal(placeElkWithinOriginalCanvas({ ...sameSize, width: compact.width - 1 }, compact), null,
    'never squeeze coordinates to pass exact-size validation')
  assert.equal(parseCanvasScene(serializeCanvasScene(repositioned)).elements.length, compact.elements.length)
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
  const laidOut = await layoutWithElk(input, 'native', { compactBounds: true })
  const primary = laidOut.elements.find((item): item is CanvasNode => item.type === 'node')!
  const pinnedInput = {
    ...input, width: laidOut.width + 100, height: laidOut.height + 100,
    elements: input.elements.map((item) => item.id === primary.id && item.type === 'node'
      ? { ...item, x: primary.x + 40, y: primary.y + 40, locked: true } : item),
  }
  const rigid = await layoutWithElk(pinnedInput, 'native', { rigidLockedPlacement: true })
  assert.equal(rigid.width, pinnedInput.width)
  assert.equal(rigid.height, pinnedInput.height)
  assert.equal(compareEditableArchitectureSemantics(pinnedInput, rigid).faithful, true,
    'the matched result must retain the pinned source graph and its lock contract')
  assert.deepEqual(rigid.elements.find((item) => item.id === primary.id),
    { ...primary, x: primary.x + 40, y: primary.y + 40, locked: true },
    'one pinned node is preserved exactly when rigid scene translation is feasible')
  assert.equal(parseCanvasScene(serializeCanvasScene(rigid)).elements.length, pinnedInput.elements.length)
  const other = laidOut.elements.find((item): item is CanvasNode => item.type === 'node' && item.id !== primary.id)!
  const inconsistentLocks = {
    ...pinnedInput,
    elements: pinnedInput.elements.map((item) => item.id === other.id && item.type === 'node'
      ? { ...item, x: other.x + 45, y: other.y + 40, locked: true } : item),
  }
  await assert.rejects(layoutWithElk(inconsistentLocks, 'native', { rigidLockedPlacement: true }),
    /cannot preserve original Canvas size and all locked nodes/,
    'two incompatible pins must fail, not silently move one of them')
  await assert.rejects(layoutWithElk(pinnedInput, 'flat', { rigidLockedPlacement: true }),
    /requires native ELK edge geometry/, 'partial rerouting must never be mistaken for rigid native geometry')
})
