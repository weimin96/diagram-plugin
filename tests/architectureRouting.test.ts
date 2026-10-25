import assert from 'node:assert/strict'
import test from 'node:test'
import {
  routeArchitectureArrowIds,
  routeArchitectureEdges,
  routeArchitectureEdgesIncremental,
  restoreArchitectureMovedSourceTrunk,
} from '../src/architectureRouting.js'
import {
  routeArchitectureArrowIds as legacyRouteArrowIds,
  routeArchitectureEdges as legacyRouteEdges,
} from '../src/architectureDesign.js'
import { canvasArrowBoxRoute, canvasBundleTrunks, parseCanvasScene, serializeCanvasScene, type CanvasArrow, type CanvasScene } from '../src/canvas.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { projectArchitectureCase } from '../scripts/architecture-project-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'

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

test('moved endpoint recovers a previously real source stem without inventing a bundle', async () => {
  const reference = composeArchitectureGraph((await projectArchitectureCase()).intent).scene
  const nodes = reference.elements.filter((item) => item.type === 'node')
  const left = nodes.find((item) => item.id === 'architecturePartitionFlow')!
  const right = nodes.find((item) => item.id === 'canvasQuality')!
  const changed = new Set([left.id, right.id])
  const reordered = {
    ...reference, elements: reference.elements.map((item) =>
      item.id === left.id ? { ...item, x: right.x, y: right.y }
        : item.id === right.id ? { ...item, x: left.x, y: left.y } : item),
  }
  const candidate = routeArchitectureEdgesIncremental(reordered, changed)
  const saved = serializeCanvasScene(candidate)
  const trunksBefore = canvasBundleTrunks(reference).length
  assert.equal(canvasBundleTrunks(candidate).length, trunksBefore - 1)
  const repaired = restoreArchitectureMovedSourceTrunk(candidate, reference, changed)
  assert.ok(repaired, 'a proven original trunk with an unchanged source can be reused after its target moves')
  assert.equal(canvasBundleTrunks(repaired).length, trunksBefore)
  const candidateQuality = assessCanvasVisualQuality(candidate).metrics
  const repairedQuality = assessCanvasVisualQuality(repaired).metrics
  assert.ok(repairedQuality.edgeCrossings <= candidateQuality.edgeCrossings)
  assert.ok(repairedQuality.edgeOverlaps <= candidateQuality.edgeOverlaps)
  assert.equal(repairedQuality.edgeNodeIntersections, 0)
  assert.equal(serializeCanvasScene(candidate), saved, 'candidate generation cannot mutate earlier alternatives')
  assert.equal(restoreArchitectureMovedSourceTrunk(candidate, { ...reference,
    elements: reference.elements.map((item) => item.type === 'arrow' ? { ...item, bundleKey: undefined } : item),
  }, changed), undefined, 'never invent a source trunk when there is no verified baseline')
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

function congestedPorts(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas', version: 1, title: 'Independent fanout ports',
    width: 1180, height: 660, architecture: { theme: 'technical' },
    groups: [{ id: 'g', label: 'Shared region' }],
    elements: [
      { id: 'source', type: 'node', x: 80, y: 230, width: 180, height: 96, text: 'Source', groupId: 'g', icon: 'service' },
      { id: 'target-a', type: 'node', x: 750, y: 180, width: 180, height: 80, text: 'Target A', groupId: 'g' },
      { id: 'target-b', type: 'node', x: 750, y: 300, width: 180, height: 80, text: 'Target B', groupId: 'g' },
      { id: 'wire-a', type: 'arrow', from: 'source', to: 'target-a', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'left', points: [{ x: 400, y: 278 }, { x: 400, y: 220 }] },
      { id: 'wire-b', type: 'arrow', from: 'source', to: 'target-b', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'left', points: [{ x: 400, y: 278 }, { x: 400, y: 340 }] },
    ],
  }
}

test('single-edge corridor repair assigns a distinct real port without moving nodes or rewriting other edges', () => {
  const source = congestedPorts()
  const before = serializeCanvasScene(source)
  const centerOnly = routeArchitectureArrowIds(source, ['wire-b'])
  const planned = routeArchitectureArrowIds(source, ['wire-b'], true)
  const originalArrow = source.elements.find((item) => item.id === 'wire-a')
  const selected = planned.elements.find((item) => item.id === 'wire-b')
  assert.ok(originalArrow?.type === 'arrow' && selected?.type === 'arrow')
  assert.equal(selected.fromAnchor, 'right')
  assert.ok(selected.fromPortRatio !== undefined && Math.abs(selected.fromPortRatio - 0.5) >= 0.1)
  assert.deepEqual(planned.elements.find((item) => item.id === 'wire-a'), originalArrow)
  assert.deepEqual(planned.elements.filter((item) => item.type === 'node'),
    source.elements.filter((item) => item.type === 'node'))
  assert.equal(serializeCanvasScene(source), before)
  const restored = parseCanvasScene(serializeCanvasScene(planned))
  const reopened = restored.elements.find((item) => item.id === 'wire-b')
  assert.ok(reopened?.type === 'arrow')
  assert.equal(reopened.fromPortRatio, selected.fromPortRatio)
  const sourceNode = source.elements[0]
  const targetNode = source.elements[2]
  assert.ok(sourceNode.type === 'node' && targetNode.type === 'node')
  const path = canvasArrowBoxRoute(sourceNode, targetNode, selected)
  assert.ok(path.slice(1).every((point, i) => point.x === path[i].x || point.y === path[i].y))
  assert.ok(assessCanvasVisualQuality(planned).metrics.edgeNodeIntersections
    <= assessCanvasVisualQuality(centerOnly).metrics.edgeNodeIntersections)
})

test('multi-edge repair retains center-port search and does not modify shared bus ports', () => {
  const source = congestedPorts()
  const multi = routeArchitectureArrowIds(source, ['wire-a', 'wire-b'], true)
  assert.ok(multi.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
    .every((item) => item.fromPortRatio === undefined && item.toPortRatio === undefined))
  const bus: CanvasScene = {
    ...source,
    elements: source.elements.map((item) => item.id === 'wire-b' && item.type === 'arrow'
      ? { ...item, bundleKey: 'group:source-to-targets' } : item),
  }
  const rerouted = routeArchitectureArrowIds(bus, ['wire-b'], true)
  const arrow = rerouted.elements.find((item) => item.id === 'wire-b')
  assert.ok(arrow?.type === 'arrow')
  assert.equal(arrow.fromPortRatio, undefined)
  assert.equal(arrow.toPortRatio, undefined)
})
