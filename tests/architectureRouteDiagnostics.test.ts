import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasScene } from '../src/canvas.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'

test('跨区指标独立于图表存储与原始节点关系，重复计算确定', () => {
  const graph = composeArchitectureGraph(architectureBenchmarkCases('extended')
    .find((item) => item.id === 'data-platform-fanout')!.intent).scene
  const before = JSON.stringify(graph)
  const result = assessArchitectureRouteDiagnostics(graph)
  assert.ok(result.crossPartitionRelations > 0)
  assert.ok(result.totalRouteLength >= result.crossPartitionRouteLength)
  assert.ok(result.crossPartitionRouteLength > 0)
  assert.ok(result.frameOverlaps >= 0 && result.unrelatedFrameIntrusionLength >= 0)
  assert.ok(result.backwardCrossPartitionRelations <= result.crossPartitionRelations)
  assert.deepEqual(assessArchitectureRouteDiagnostics(graph), result)
  assert.ok(result.worstFrameIntrusions.every((item) => item.length > 0))
  assert.ok(result.worstFrameOverlaps.every((item) => item.area > 0))
  assert.ok(result.worstFrameOverlaps.every((item) => item.intrudingNodeIds.length <= 4))
  assert.equal(JSON.stringify(graph), before)
})

test('只将无关分区的几何交叠作为错误，不将父子包含误报', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '分区碰撞', width: 900, height: 600,
    groups: [
      { id: 'root', label: 'root' },
      { id: 'child', label: 'child', parentId: 'root' },
      { id: 'other', label: 'other' },
    ],
    elements: [
      { id: 'a', type: 'node', text: 'A', groupId: 'child', x: 150, y: 150, width: 120, height: 80 },
      { id: 'b', type: 'node', text: 'B', groupId: 'other', x: 275, y: 170, width: 120, height: 80 },
    ],
  }
  const collided = assessArchitectureRouteDiagnostics(scene)
  assert.equal(collided.frameOverlaps, 1)
  assert.ok(collided.frameOverlapArea > 0)
  assert.deepEqual(collided.worstFrameOverlaps.map(({ firstGroupId, secondGroupId, area }) =>
    [firstGroupId, secondGroupId, area]), [['root', 'other', collided.frameOverlapArea]])
  assert.deepEqual(collided.worstFrameOverlaps[0].intrudingNodeIds, ['b'])
  const other = scene.elements[1]
  if (other.type !== 'node') throw new Error('Expected a node')
  scene.elements[1] = { ...other, x: 650 }
  const separated = assessArchitectureRouteDiagnostics(scene)
  assert.equal(separated.frameOverlaps, 0)
  assert.equal(separated.frameOverlapArea, 0)
  assert.deepEqual(separated.worstFrameOverlaps, [])
})

test('路由长度及逆向依赖的分区诊断与路径一致', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '逆向关系', width: 800, height: 450,
    groups: [{ id: 'left', label: 'A' }, { id: 'right', label: 'B' }],
    elements: [
      { id: 'left-node', type: 'node', text: 'A', groupId: 'left', x: 60, y: 100, width: 100, height: 60 },
      { id: 'right-node', type: 'node', text: 'B', groupId: 'right', x: 440, y: 100, width: 100, height: 60 },
      { id: 'one', type: 'arrow', from: 'right-node', to: 'left-node', routing: 'orthogonal',
        fromAnchor: 'left', toAnchor: 'right', points: [{ x: 300, y: 130 }] },
    ],
  }
  const result = assessArchitectureRouteDiagnostics(scene)
  assert.equal(result.totalRouteLength, 280)
  assert.equal(result.crossPartitionRouteLength, 280)
  assert.equal(result.crossPartitionDirectDistance, 380)
  assert.equal(result.crossPartitionRelations, 1)
  assert.equal(result.backwardCrossPartitionRelations, 1)
  assert.equal(result.frameOverlaps, 0)
  assert.equal(result.unrelatedFrameIntrusionLength, 0)
  assert.deepEqual(result.worstFrameIntrusions, [])
})

test('独立入边的实际端口容量可计量，共享主干不误报', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '端口容量', width: 900, height: 600,
    elements: [
      { id: 'source-a', type: 'node', text: 'A', x: 60, y: 80, width: 120, height: 80 },
      { id: 'source-b', type: 'node', text: 'B', x: 60, y: 220, width: 120, height: 80 },
      { id: 'source-c', type: 'node', text: 'C', x: 60, y: 360, width: 120, height: 80 },
      { id: 'target', type: 'node', text: 'Sink', x: 480, y: 220, width: 200, height: 80 },
      { id: 'a', type: 'arrow', from: 'source-a', to: 'target', toAnchor: 'left', toPortRatio: 0.5 },
      { id: 'b', type: 'arrow', from: 'source-b', to: 'target', toAnchor: 'left', toPortRatio: 0.55 },
      { id: 'c', type: 'arrow', from: 'source-c', to: 'target', toAnchor: 'left', toPortRatio: 0.85 },
    ],
  }
  assert.equal(assessArchitectureRouteDiagnostics(scene).ingressPortConflicts, 1)
  const moved: CanvasScene = { ...scene, elements: scene.elements.map((item) =>
    item.id === 'b' && item.type === 'arrow' ? { ...item, toPortRatio: 0.15 } : item) }
  assert.equal(assessArchitectureRouteDiagnostics(moved).ingressPortConflicts, 0)
  const shared: CanvasScene = { ...scene, elements: scene.elements.map((item) =>
    (item.id === 'a' || item.id === 'b') && item.type === 'arrow'
      ? { ...item, bundleKey: 'verified-source-trunk' } : item) }
  assert.equal(assessArchitectureRouteDiagnostics(shared).ingressPortConflicts, 0)
  const overCapacity: CanvasScene = { ...scene, elements: [
    ...scene.elements,
    { id: 'd', type: 'arrow', from: 'source-a', to: 'target', toAnchor: 'left', toPortRatio: 0.2 },
    { id: 'e', type: 'arrow', from: 'source-c', to: 'target', toAnchor: 'left', toPortRatio: 0.95 },
  ] }
  const capacity = assessArchitectureRouteDiagnostics(overCapacity).sidePortCapacityDeficits
  assert.deepEqual(capacity, [{ nodeId: 'target', side: 'left', portCount: 5,
    availablePorts: 4, sideSpanPx: 80, requiredSpanPx: 84 }],
  'capacity includes distinct real incoming relationships and reserves corner insets')
  assert.deepEqual(assessArchitectureRouteDiagnostics(scene).sidePortCapacityDeficits, [],
    'ordinary small fan-in should not be classified as physically impossible')
  const outgoing: CanvasScene = { ...overCapacity, elements: overCapacity.elements.map((item) =>
    item.type === 'arrow' ? {
      ...item, from: item.to, to: item.from, fromAnchor: 'left' as const,
      toAnchor: 'auto' as const, fromPortRatio: item.toPortRatio, toPortRatio: undefined,
    } : item) }
  assert.deepEqual(assessArchitectureRouteDiagnostics(outgoing).sidePortCapacityDeficits, capacity,
    'physical port demand must include real outgoing arrows, not just ingress')
})

test('真实端点法向诊断区分错误切向连接与合法的正交出入边，不更改画布', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '端口法向', width: 900, height: 550,
    elements: [
      { id: 'left', type: 'node', x: 100, y: 100, width: 160, height: 80, text: 'Source' },
      { id: 'right', type: 'node', x: 500, y: 100, width: 160, height: 80, text: 'Sink' },
      { id: 'bad', type: 'arrow', from: 'left', to: 'right', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'top', points: [{ x: 260, y: 20 }, { x: 580, y: 20 }] },
      { id: 'ok', type: 'arrow', from: 'left', to: 'right', routing: 'orthogonal',
        fromAnchor: 'right', toAnchor: 'left' },
    ],
  }
  const original = JSON.stringify(scene)
  const measured = assessArchitectureRouteDiagnostics(scene)
  assert.equal(measured.terminalNormalViolations, 1)
  assert.deepEqual(measured.worstTerminalNormalViolations,
    [{ edgeId: 'bad', endpoint: 'from', side: 'right' }])
  assert.equal(JSON.stringify(scene), original)
})

test('同分区线路在节点包围范围外明显折返时提示具体关系，不把普通直连当成绕行', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '外侧走廊', width: 800, height: 480,
    groups: [{ id: 'arch-application', label: 'Application' }],
    elements: [
      { id: 'api', type: 'node', groupId: 'arch-application', text: 'API',
        x: 100, y: 100, width: 120, height: 80 },
      { id: 'service', type: 'node', groupId: 'arch-application', text: 'Service',
        x: 480, y: 100, width: 120, height: 80 },
      { id: 'detour', type: 'arrow', from: 'api', to: 'service',
        routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left',
        points: [{ x: 260, y: 140 }, { x: 260, y: 30 }, { x: 660, y: 30 }, { x: 660, y: 140 }] },
    ],
  }
  const serialized = JSON.stringify(scene)
  const detoured = assessArchitectureRouteDiagnostics(scene)
  assert.equal(detoured.perimeterDetours, 1)
  assert.equal(detoured.totalRouteBends, 4)
  assert.deepEqual(detoured.worstRouteBends, [{ edgeId: 'detour', bends: 4 }])
  assert.deepEqual(detoured.worstPerimeterDetours, [
    { edgeId: 'detour', routeLength: 840, excessLength: 580, outsideDistance: 130 },
  ])
  const straight = assessArchitectureRouteDiagnostics({
    ...scene,
    elements: scene.elements.map((item) => item.id === 'detour' && item.type === 'arrow'
      ? { ...item, points: undefined } : item),
  })
  assert.equal(straight.perimeterDetours, 0)
  assert.equal(straight.totalRouteBends, 0)
  assert.deepEqual(straight.worstRouteBends, [])
  assert.deepEqual(straight.worstPerimeterDetours, [])
  assert.equal(JSON.stringify(scene), serialized, 'diagnostics must not modify the editable Canvas document')
})
