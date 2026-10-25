import assert from 'node:assert/strict'
import test from 'node:test'
import {
  routeArchitectureArrowIds,
  routeArchitectureEdges,
  routeArchitectureEdgesIncremental,
} from '../src/architectureRouting.js'
import {
  routeArchitectureArrowIds as legacyRouteArrowIds,
  routeArchitectureEdges as legacyRouteEdges,
} from '../src/architectureDesign.js'
import { canvasArrowBoxRoute, serializeCanvasScene, type CanvasArrow, type CanvasScene } from '../src/canvas.js'

function graph(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas', version: 1, title: 'Routing contract',
    width: 1150, height: 780,
    architecture: { theme: 'technical' },
    elements: [
      { id: 'web', type: 'node', x: 100, y: 120, width: 180, height: 80, text: 'Web', locked: true },
      { id: 'api', type: 'node', x: 500, y: 120, width: 180, height: 80, text: 'API' },
      { id: 'db', type: 'node', x: 880, y: 120, width: 180, height: 80, text: 'DB' },
      { id: 'a', type: 'arrow', from: 'web', to: 'api', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'left', fromPortRatio: 0.25, toPortRatio: 0.75 },
      { id: 'b', type: 'arrow', from: 'api', to: 'db', routing: 'orthogonal', label: 'Query' },
    ],
  }
}

test('architecture routing is a single reusable domain API, old re-exports stay equivalent', () => {
  const source = graph()
  const before = serializeCanvasScene(source)
  const routed = routeArchitectureEdges(source)
  assert.deepEqual(routed, legacyRouteEdges(source))
  assert.deepEqual(routeArchitectureArrowIds(source, ['b']), legacyRouteArrowIds(source, ['b']))
  assert.equal(serializeCanvasScene(source), before, 'routing cannot mutate its input')
  assert.deepEqual(routed.elements.filter((item) => item.type !== 'arrow'),
    source.elements.filter((item) => item.type !== 'arrow'), 'routing cannot move/retone/resize nodes')
  const edges = routed.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  for (const edge of edges) {
    const from = routed.elements.find((item) => item.id === edge.from)
    const to = routed.elements.find((item) => item.id === edge.to)
    assert.ok(from?.type === 'node' && to?.type === 'node')
    const route = canvasArrowBoxRoute(from, to, edge)
    assert.ok(route.slice(1).every((point, index) => point.x === route[index].x || point.y === route[index].y))
    assert.equal(edge.fromPortRatio, undefined, 'rerouting releases stale native port ratios')
    assert.equal(edge.toPortRatio, undefined)
  }
})

test('incremental reroute only changes incident edge geometry, preserving unrelated native ports', () => {
  const source = graph()
  const updated = routeArchitectureEdgesIncremental(source, ['db'])
  const native = updated.elements.find((item) => item.id === 'a')
  assert.ok(native?.type === 'arrow')
  assert.deepEqual([native.fromPortRatio, native.toPortRatio], [0.25, 0.75])
  const rerouted = updated.elements.find((item) => item.id === 'b')
  assert.ok(rerouted?.type === 'arrow')
  assert.equal(rerouted.routing, 'orthogonal')
  assert.deepEqual(updated.elements.filter((item) => item.type !== 'arrow'),
    source.elements.filter((item) => item.type !== 'arrow'))
})

test('incremental routing detects a moved obstacle against an authored noncentral port', () => {
  const original: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Native-port clearance',
    width: 1250, height: 600,
    architecture: { theme: 'technical' },
    elements: [
      { id: 'from', type: 'node', x: 100, y: 100, width: 180, height: 80, text: 'Source' },
      { id: 'to', type: 'node', x: 800, y: 100, width: 180, height: 80, text: 'Target' },
      { id: 'moved', type: 'node', x: 410, y: 95, width: 100, height: 12, text: 'Moved obstacle' },
      { id: 'wire', type: 'arrow', from: 'from', to: 'to', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'left', fromPortRatio: 0.25, toPortRatio: 0.25 },
    ],
  }
  const originalArrow = original.elements.find((item) => item.id === 'wire')
  assert.ok(originalArrow?.type === 'arrow')
  assert.equal(canvasArrowBoxRoute(original.elements[0] as Extract<CanvasScene['elements'][number], { type: 'node' }>,
    original.elements[1] as Extract<CanvasScene['elements'][number], { type: 'node' }>, originalArrow)[0].y, 120)
  const updated = routeArchitectureEdgesIncremental(original, ['moved'])
  const arrow = updated.elements.find((item) => item.id === 'wire')
  assert.ok(arrow?.type === 'arrow')
  assert.notDeepEqual(arrow, originalArrow, 'obstacle intersects only the actual y=120 port, not the old y=140 center')
  assert.equal(arrow.fromPortRatio, undefined)
  assert.equal(arrow.toPortRatio, undefined)
})
