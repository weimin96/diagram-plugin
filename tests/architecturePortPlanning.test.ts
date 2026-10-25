import assert from 'node:assert/strict'
import test from 'node:test'
import { availablePortRatios, portSpacingPenalty, reservedPorts } from '../src/architecturePortPlanning.js'
import type { CanvasArrow, CanvasNode } from '../src/canvas.js'

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
