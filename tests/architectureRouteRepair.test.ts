import assert from 'node:assert/strict'
import test from 'node:test'
import { bypassArchitectureBlockingNode, nudgeArchitectureCorridors, nudgeSharedSourceBranch } from '../src/architectureRouteRepair.js'
import { canvasArrowBoxRoute, serializeCanvasScene, type CanvasArrow, type CanvasNode, type CanvasScene } from '../src/canvas.js'

const source: CanvasNode = { id: 'source', type: 'node', text: 'API', x: 100, y: 100, width: 100, height: 80 }
const target: CanvasNode = { id: 'target', type: 'node', text: 'DB', x: 600, y: 350, width: 100, height: 80 }
const scene = (arrow: CanvasArrow, elements: CanvasScene['elements'] = []): CanvasScene => ({
  type: 'diagram-plugin-canvas', version: 1, title: 'Repair', width: 950, height: 700,
  elements: [source, target, ...elements, arrow],
})

test('corridor shifts only create orthogonal editable alternatives without changing graph semantics', () => {
  const arrow: CanvasArrow = { id: 'edge', type: 'arrow', from: source.id, to: target.id,
    fromAnchor: 'right', toAnchor: 'left', routing: 'orthogonal',
    points: [{ x: 400, y: 140 }, { x: 400, y: 390 }] }
  const original = scene(arrow)
  const before = serializeCanvasScene(original)
  const alternatives = nudgeArchitectureCorridors(original, arrow.id)
  assert.ok(alternatives.length > 0 && alternatives.length <= 16)
  for (const candidate of alternatives) {
    assert.deepEqual(candidate.elements.filter((item) => item.type === 'node'), [source, target])
    const updated = candidate.elements.find((item) => item.id === arrow.id)
    assert.ok(updated?.type === 'arrow')
    assert.deepEqual([updated.from, updated.to, updated.fromAnchor, updated.toAnchor],
      [arrow.from, arrow.to, arrow.fromAnchor, arrow.toAnchor])
    const path = canvasArrowBoxRoute(source, target, updated)
    assert.ok(path.slice(1).every((point, index) => point.x === path[index].x || point.y === path[index].y))
  }
  assert.deepEqual(nudgeArchitectureCorridors(scene({ ...arrow, bundleKey: 'group:bus' }), arrow.id), [])
  assert.equal(serializeCanvasScene(original), before)
})

test('blocking-node bypass retains ports and only changes affected arrow, refusing bundled edges', () => {
  const blocker: CanvasNode = { id: 'blocker', type: 'node', text: 'Blocker', x: 400, y: 115, width: 80, height: 65 }
  const arrow: CanvasArrow = { id: 'edge', type: 'arrow', from: source.id, to: target.id,
    fromAnchor: 'right', toAnchor: 'top', routing: 'orthogonal',
    points: [{ x: 650, y: 140 }] }
  const original = scene(arrow, [blocker])
  const candidates = bypassArchitectureBlockingNode(original, arrow.id, blocker.id)
  assert.ok(candidates.length > 0)
  for (const candidate of candidates) {
    const edge = candidate.elements.at(-1)
    assert.ok(edge?.type === 'arrow')
    assert.deepEqual(candidate.elements.slice(0, -1), original.elements.slice(0, -1))
    assert.deepEqual(canvasArrowBoxRoute(source, target, edge).at(0), { x: 200, y: 140 })
    assert.deepEqual(canvasArrowBoxRoute(source, target, edge).at(-1), { x: 650, y: 350 })
  }
  assert.deepEqual(bypassArchitectureBlockingNode(scene({ ...arrow, bundleKey: 'from:bus' }, [blocker]), arrow.id, blocker.id), [])
})

test('shared-source branch repair keeps the bundle membership and node geometry', () => {
  const from: CanvasNode = { ...source, x: 100, y: 80 }
  const first: CanvasNode = { ...target, x: 120, y: 480 }
  const second: CanvasNode = { ...target, id: 'second', x: 250, y: 480 }
  const a: CanvasArrow = { id: 'a', type: 'arrow', from: from.id, to: first.id,
    fromAnchor: 'bottom', toAnchor: 'top', routing: 'orthogonal', bundleKey: 'from:source',
    points: [{ x: 150, y: 260 }, { x: 170, y: 260 }] }
  const b: CanvasArrow = { ...a, id: 'b', to: second.id,
    points: [{ x: 150, y: 260 }, { x: 300, y: 260 }] }
  const original: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Shared corridor', width: 950, height: 700,
    elements: [from, first, second, a, b],
  }
  const repaired = nudgeSharedSourceBranch(original, a.id)
  assert.ok(repaired.length > 0)
  for (const candidate of repaired) {
    assert.deepEqual(candidate.elements.slice(0, 3), original.elements.slice(0, 3))
    assert.deepEqual(candidate.elements.find((item) => item.id === 'b'), b)
    const edge = candidate.elements.find((item) => item.id === 'a')
    assert.ok(edge?.type === 'arrow')
    assert.equal(edge.bundleKey, 'from:source')
    assert.deepEqual(canvasArrowBoxRoute(from, first, edge).at(0), { x: 150, y: 160 })
  }
})
