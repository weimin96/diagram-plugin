import assert from 'node:assert/strict'
import test from 'node:test'
import { availablePortRatios, portSpacingPenalty, proposeIngressPortSlots, reservedPorts } from '../src/architecturePortPlanning.js'
import { canvasArrowBoxRoute, type CanvasArrow, type CanvasNode, type CanvasScene } from '../src/canvas.js'

const node: CanvasNode = {
  id: 'source', type: 'node', x: 100, y: 100, width: 180, height: 80, text: 'Source',
}

test('port planner reads existing authored boundary reservations without treating selected edges as occupied', () => {
  const arrows: CanvasArrow[] = [
    { id: 'existing', type: 'arrow', from: 'source', to: 'a', fromAnchor: 'right', toAnchor: 'left' },
    { id: 'native', type: 'arrow', from: 'b', to: 'source', toAnchor: 'right', toPortRatio: 0.75 },
    { id: 'selected', type: 'arrow', from: 'source', to: 'c', fromAnchor: 'right', fromPortRatio: 0.25 },
    { id: 'automatic', type: 'arrow', from: 'source', to: 'd', fromAnchor: 'auto' },
  ]
  const reserved = reservedPorts(arrows, new Set(['selected']))
  assert.deepEqual(reserved.get('source\u0000right'), [0.5, 0.75])
  assert.equal(reserved.has('source\u0000auto'), false)
  const positions = availablePortRatios(node, 'right', reserved)
  assert.equal(positions[0], 0.5)
  assert.ok(positions.length <= 3)
  assert.ok(positions.slice(1).every((value) => value > 0 && value < 1))
  assert.ok(portSpacingPenalty(node, 'right', positions[1], reserved)
    < portSpacingPenalty(node, 'right', 0.5, reserved))
})

test('port planner does not invent slots for no reservation, rotated boxes or unsupported positions', () => {
  const empty = reservedPorts([], new Set<string>())
  assert.deepEqual(availablePortRatios(node, 'top', empty), [0.5])
  assert.equal(portSpacingPenalty(node, 'top', 0.5, empty), 0)
  const r = reservedPorts([{
    id: 'existing', type: 'arrow', from: 'source', to: 'b',
    fromAnchor: 'right', fromPortRatio: 0.5,
  }], new Set<string>())
  assert.deepEqual(availablePortRatios({ ...node, rotation: 90 }, 'right', r), [0.5])
  assert.deepEqual(availablePortRatios({ ...node, height: 10 }, 'right', r)[0], 0.5)
})

test('congested ingress proposals keep exact graph semantics, orthogonal terminals and authored geometry', () => {
  const target: CanvasNode = { ...node, id: 'sink', x: 420, y: 250, width: 180, height: 80, text: 'Sink' }
  const upper: CanvasNode = { ...node, id: 'upper', x: 90, y: 20 }
  const lower: CanvasNode = { ...node, id: 'lower', x: 90, y: 350 }
  const middle: CanvasNode = { ...node, id: 'middle', x: 90, y: 170 }
  const arrows: CanvasArrow[] = [
    { id: 'left-a', type: 'arrow', from: 'upper', to: 'sink', routing: 'orthogonal',
      fromAnchor: 'bottom', toAnchor: 'left',
      points: [{ x: 180, y: 170 }, { x: 140, y: 170 }, { x: 140, y: 290 }] },
    { id: 'left-b', type: 'arrow', from: 'lower', to: 'sink', routing: 'orthogonal',
      fromAnchor: 'top', toAnchor: 'left',
      points: [{ x: 180, y: 290 }] },
    { id: 'left-c', type: 'arrow', from: 'middle', to: 'sink', routing: 'orthogonal',
      fromAnchor: 'bottom', toAnchor: 'left',
      points: [{ x: 180, y: 290 }] },
  ]
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Real ports',
    width: 700, height: 540, architecture: { theme: 'technical' },
    elements: [upper, target, lower, middle, ...arrows],
  }
  const original = JSON.stringify(scene)
  const candidates = proposeIngressPortSlots(scene)
  assert.ok(candidates.length > 0)
  const joint = candidates.find((candidate) => candidate.elements.filter((item) =>
    item.type === 'arrow' && item.toPortRatio !== undefined && item.toPortRatio !== 0.5).length >= 2)
  assert.ok(joint, 'one side must be able to exchange occupied ports in a joint proposal')
  const jointRatios = joint.elements.filter((item): item is CanvasArrow =>
    item.type === 'arrow').map((item) => item.toPortRatio ?? 0.5)
  assert.equal(new Set(jointRatios).size, arrows.length, 'joint allocation must have distinct real ports')
  const pair: CanvasScene = { ...scene, elements: [upper, target, lower, arrows[0], arrows[1]] }
  assert.ok(proposeIngressPortSlots(pair).some((candidate) => {
    const endpoints = candidate.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
    return endpoints.length === 2 && endpoints.every((item) => item.toPortRatio !== undefined)
      && Math.abs(endpoints[0].toPortRatio! - endpoints[1].toPortRatio!) * target.height >= 14
  }), 'two incoming edges sharing a port also need a coordinated candidate')
  for (const candidate of candidates) {
    assert.deepEqual(candidate.elements.filter((item) => item.type === 'node'), [upper, target, lower, middle])
    assert.deepEqual(candidate.elements.filter((item) => item.type === 'arrow')
      .map((item) => [item.id, item.from, item.to]),
    arrows.map((item) => [item.id, item.from, item.to]))
    for (const arrow of candidate.elements) {
      if (arrow.type !== 'arrow') continue
      const source = candidate.elements.find((item) => item.id === arrow.from) as CanvasNode
      const path = canvasArrowBoxRoute(source, target, arrow)
      assert.ok(path.slice(1).every((p, i) => p.x === path[i].x || p.y === path[i].y),
        'terminal allocation must never insert a diagonal or change the true endpoint')
    }
  }
  assert.equal(JSON.stringify(scene), original, 'candidate generation must never mutate the saved scene')
})
