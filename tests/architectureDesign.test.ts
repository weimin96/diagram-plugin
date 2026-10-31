import assert from 'node:assert/strict'
import test from 'node:test'
import { applyArchitectureTheme, beautifyArchitectureScene, inferArchitectureComposition, routeArchitectureArrowIds, routeArchitectureEdges, routeArchitectureEdgesIncremental } from '../src/architectureDesign.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { anchorPoint, canvasArrowRoutePoints, canvasBundleTrunks, canvasGroupFrames, type CanvasScene } from '../src/canvas.js'
import { compactEnterpriseLayerSpacing } from '../src/architectureProposalSpacing.js'
import { assertArchitectureLayoutTransition, architectureLayoutContract } from '../src/architectureLayoutContract.js'

test('自动布局避让锁定节点，并保留锁定节点的位置和尺寸', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '固定节点避让', width: 1400, height: 800,
    elements: [
      { id: 'client', type: 'node', text: 'Web Client', x: 100, y: 100, width: 180, height: 90, icon: 'web', locked: true },
      { id: 'api', type: 'node', text: 'API Service', x: 500, y: 100, width: 180, height: 90, icon: 'api' },
      { id: 'db', type: 'node', text: 'PostgreSQL', x: 900, y: 100, width: 180, height: 90, icon: 'database' },
      { id: 'client-api', type: 'arrow', from: 'client', to: 'api' },
      { id: 'api-db', type: 'arrow', from: 'api', to: 'db' },
    ],
  }
  const result = beautifyArchitectureScene(scene, { theme: 'technical' }).scene
  const fixed = result.elements.find((item) => item.id === 'client')!
  assert.ok(fixed.type !== 'arrow')
  assert.deepEqual([fixed.x, fixed.y, fixed.width, fixed.height], [100, 100, 180, 90])
  assert.equal(assessCanvasVisualQuality(result).metrics.nodeOverlaps, 0)
})

function sampleScene(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Architecture',
    width: 1200,
    height: 800,
    elements: [
      { id: 'client', type: 'node', x: 40, y: 100, width: 220, height: 96, text: '员工浏览器' },
      { id: 'web', type: 'node', x: 340, y: 100, width: 220, height: 96, text: 'Web React' },
      { id: 'service', type: 'node', x: 640, y: 100, width: 220, height: 96, text: 'Spring Boot Service' },
      { id: 'queue', type: 'node', x: 640, y: 300, width: 220, height: 96, text: 'Kafka Event Bus' },
      { id: 'db', type: 'node', x: 940, y: 100, width: 220, height: 96, text: 'PostgreSQL' },
      { id: 'a1', type: 'arrow', from: 'client', to: 'web' },
      { id: 'a2', type: 'arrow', from: 'web', to: 'service' },
      { id: 'a3', type: 'arrow', from: 'service', to: 'queue' },
      { id: 'a4', type: 'arrow', from: 'service', to: 'db' },
    ],
  }
}

test("角色分区与结构识别", () => {
  // 场景 2: 'beautifies architecture into semantic partitions with technology roles'
  {
  const result = beautifyArchitectureScene(sampleScene(), { theme: 'enterprise' })
  const scene = result.scene
  const nodes = new Map(scene.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))

  assert.equal(scene.lanes?.length ?? 0, 0)
  assert.ok((scene.groups?.filter((group) => group.id.startsWith('arch-')).length ?? 0) >= 4)
  assert.equal(nodes.get('web')?.stencil, 'react')
  assert.equal(nodes.get('web')?.icon, 'web')
  assert.equal(nodes.get('service')?.stencil, 'spring')
  assert.equal(nodes.get('service')?.icon, 'service')
  assert.equal(nodes.get('queue')?.stencil, 'kafka')
  assert.equal(nodes.get('queue')?.icon, 'queue')
  assert.equal(nodes.get('db')?.stencil, 'postgres')
  assert.equal(nodes.get('db')?.icon, 'database')
  assert.notEqual(nodes.get('web')?.groupId, nodes.get('db')?.groupId)
  assert.ok(result.summary.partitions >= 4)
  assert.equal(result.summary.composition, 'layered')

  }
  // 场景 3: 'infers architecture composition from topology and semantic roles'
  {
  const node = (id: string, icon: 'user' | 'web' | 'gateway' | 'api' | 'service' | 'worker' | 'database' | 'queue' | 'search' | 'file' | 'ai' | 'mcp' | 'external' | 'cloud', stencil?: 'kafka' | 'postgres' | 'qdrant' | 'minio' | 'kubernetes' | 'docker' | 'nginx' | 'openai' | 'mcp') => ({
    id, type: 'node' as const, x: 0, y: 0, width: 170, height: 72, text: id, icon, ...(stencil ? { stencil } : {}),
  })
  const arrow = (id: string, from: string, to: string) => ({ id, type: 'arrow' as const, from, to })
  const scene = (title: string, elements: CanvasScene['elements']): CanvasScene => ({
    type: 'diagram-plugin-canvas', version: 1, title, width: 1400, height: 900, elements,
  })

  const hub = scene('hub', [
    node('hub', 'service'), node('a', 'external'), node('b', 'web'), node('c', 'database'), node('d', 'search'), node('e', 'worker'),
    arrow('h1', 'a', 'hub'), arrow('h2', 'b', 'hub'), arrow('h3', 'hub', 'c'), arrow('h4', 'hub', 'd'), arrow('h5', 'hub', 'e'),
  ])
  const events = scene('events', [
    node('api', 'api'), node('queue', 'queue', 'kafka'), node('worker', 'worker'), node('db', 'database', 'postgres'),
    arrow('e1', 'api', 'queue'), arrow('e2', 'queue', 'worker'), arrow('e3', 'worker', 'db'),
  ])
  const dataPlatform = scene('data', [
    node('source', 'external'), node('web', 'web'), node('worker-a', 'worker'), node('worker-b', 'worker'),
    node('db', 'database', 'postgres'), node('vector', 'database', 'qdrant'), node('files', 'file', 'minio'),
    arrow('d1', 'source', 'worker-a'), arrow('d2', 'worker-a', 'worker-b'), arrow('d3', 'worker-b', 'db'), arrow('d4', 'worker-b', 'vector'), arrow('d5', 'worker-a', 'files'),
  ])
  const agent = scene('agent', [
    node('web', 'web'), node('agent', 'ai'), node('tools', 'mcp', 'mcp'), node('model', 'ai', 'openai'), node('worker', 'worker'), node('db', 'database'),
    arrow('a1', 'web', 'agent'), arrow('a2', 'agent', 'tools'), arrow('a3', 'agent', 'model'), arrow('a4', 'agent', 'db'), arrow('a5', 'tools', 'worker'),
  ])
  const cloud = scene('cloud', [
    node('entry', 'gateway', 'nginx'), node('cluster', 'cloud', 'kubernetes'), node('runtime', 'cloud', 'docker'), node('api', 'service'), node('service', 'service'), node('worker', 'worker'), node('db', 'database'),
    arrow('c1', 'entry', 'api'), arrow('c2', 'api', 'service'), arrow('c3', 'service', 'worker'), arrow('c4', 'worker', 'db'), arrow('c5', 'cluster', 'api'), arrow('c6', 'runtime', 'service'),
  ])

  assert.equal(inferArchitectureComposition(sampleScene()), 'layered')
  assert.equal(inferArchitectureComposition(hub), 'hub-spoke')
  assert.equal(inferArchitectureComposition(events), 'event-driven')
  assert.equal(inferArchitectureComposition(dataPlatform), 'data-platform')
  assert.equal(inferArchitectureComposition(agent), 'agent-runtime')
  assert.equal(inferArchitectureComposition(cloud), 'cloud-native')

  const composed = new Map([
    ['hub-spoke', beautifyArchitectureScene(hub).scene],
    ['event-driven', beautifyArchitectureScene(events).scene],
    ['data-platform', beautifyArchitectureScene(dataPlatform).scene],
    ['agent-runtime', beautifyArchitectureScene(agent).scene],
    ['cloud-native', beautifyArchitectureScene(cloud).scene],
  ])
  for (const [name, result] of composed) {
    const quality = assessCanvasVisualQuality(result)
    assert.equal(quality.metrics.nodeOverlaps, 0, `${name}: composition should not overlap nodes`)
    assert.equal(quality.metrics.edgeNodeIntersections, 0, `${name}: composition should not route through nodes`)
    assert.equal(quality.metrics.edgeCrossings, 0, `${name}: composition should preserve a clean reading path`)
  }

  const centers = (value: CanvasScene) => new Map(canvasGroupFrames(value)
    .filter((frame) => frame.id.startsWith('arch-'))
    .map((frame) => [frame.id, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }]))
  const hubCenters = centers(composed.get('hub-spoke')!)
  assert.ok(hubCenters.get('arch-application')!.y > hubCenters.get('arch-experience')!.y)
  assert.ok(hubCenters.get('arch-application')!.y < hubCenters.get('arch-data')!.y)
  const eventCenters = centers(composed.get('event-driven')!)
  assert.ok(eventCenters.get('arch-processing')!.y > eventCenters.get('arch-application')!.y)
  assert.ok(eventCenters.get('arch-data')!.y > eventCenters.get('arch-processing')!.y)
  const dataCenters = centers(composed.get('data-platform')!)
  assert.ok(dataCenters.get('arch-external')!.x < dataCenters.get('arch-processing')!.x)
  assert.ok(dataCenters.get('arch-processing')!.x < dataCenters.get('arch-data')!.x)
  const agentCenters = centers(composed.get('agent-runtime')!)
  assert.ok(agentCenters.get('arch-application')!.y > agentCenters.get('arch-experience')!.y)
  assert.ok(agentCenters.get('arch-processing')!.y > agentCenters.get('arch-application')!.y)
  const cloudCenters = centers(composed.get('cloud-native')!)
  assert.ok(cloudCenters.get('arch-processing')!.x > cloudCenters.get('arch-application')!.x)
  assert.ok(cloudCenters.get('arch-data')!.y > cloudCenters.get('arch-application')!.y)

  }
})

test("正交关系和锁定几何", () => {
  // 场景 4: 'spreads architecture relationships with orthogonal channels and async styling'
  {
  const scene = beautifyArchitectureScene(sampleScene()).scene
  const arrows = new Map(scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.id, item]))

  assert.equal(arrows.get('a2')?.routing, 'orthogonal')
  assert.ok(['left', 'right', 'top', 'bottom'].includes(arrows.get('a2')?.fromAnchor ?? ''))
  assert.ok(['left', 'right', 'top', 'bottom'].includes(arrows.get('a2')?.toAnchor ?? ''))
  assert.equal(arrows.get('a3')?.lineStyle, 'dashed')
  assert.ok(['left', 'right', 'top', 'bottom'].includes(arrows.get('a4')?.fromAnchor ?? ''))

  }
  // 场景 5: 'keeps locked architecture nodes at their authored coordinates'
  {
  const scene = sampleScene()
  const client = scene.elements.find((item) => item.id === 'client')
  if (!client || client.type === 'arrow') throw new Error('missing client')
  client.locked = true
  client.x = 77
  client.y = 233

  const result = beautifyArchitectureScene(scene).scene
  const after = result.elements.find((item) => item.id === 'client')
  assert.ok(after && after.type !== 'arrow')
  assert.equal(after.x, 77)
  assert.equal(after.y, 233)

  }
})

test('marks a connected entry-to-data backbone as the primary architecture path', () => {
  const scene = beautifyArchitectureScene(sampleScene()).scene
  const elements = new Map(scene.elements.map((item) => [item.id, item]))

  for (const id of ['client', 'web', 'service', 'db']) {
    const item = elements.get(id)
    assert.ok(item && item.type !== 'arrow')
    assert.equal(item.emphasis, 'primary')
  }
  for (const id of ['a1', 'a2', 'a4']) {
    const item = elements.get(id)
    assert.ok(item && item.type === 'arrow')
    assert.equal(item.emphasis, 'primary')
  }
  const asyncBranch = elements.get('a3')
  assert.ok(asyncBranch && asyncBranch.type === 'arrow')
  assert.equal(asyncBranch.emphasis, 'secondary')
})

test("短直连与源头主干共存", () => {
  // 场景 7: 'bundles fan-out relationships through a shared source trunk when the corridor is clear'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Bundle',
    width: 1400,
    height: 800,
    elements: [
      { id: 'service', type: 'node', x: 160, y: 320, width: 200, height: 90, text: 'Application Service', icon: 'service' },
      { id: 'db', type: 'node', x: 900, y: 160, width: 200, height: 90, text: 'PostgreSQL', icon: 'database' },
      { id: 'cache', type: 'node', x: 900, y: 320, width: 200, height: 90, text: 'Redis', icon: 'cache' },
      { id: 'search', type: 'node', x: 900, y: 480, width: 200, height: 90, text: 'OpenSearch', icon: 'search' },
      { id: 'a-db', type: 'arrow', from: 'service', to: 'db' },
      { id: 'a-cache', type: 'arrow', from: 'service', to: 'cache' },
      { id: 'a-search', type: 'arrow', from: 'service', to: 'search' },
    ],
  }

  const result = beautifyArchitectureScene(scene, { repartition: false, relayout: false }).scene
  const arrows = result.elements.filter((item) => item.type === 'arrow')
  assert.equal(arrows.length, 3)
  assert.ok(arrows.every((item) => item.bundleKey === 'from:service'))
  const firstPoints = arrows.map((item) => item.points?.[0]).filter(Boolean)
  assert.ok(firstPoints.length >= 2)
  assert.ok(firstPoints.every((point) => point?.x === firstPoints[0]?.x))
  assert.ok(canvasBundleTrunks(result).some((trunk) => trunk.count >= 2))

  }
  // 场景 8: 'keeps short intra-boundary relationships direct while preserving event-bus fanout bundling'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Local bundle policy', width: 1100, height: 620,
    groups: [{ id: 'runtime', label: 'Runtime', kind: 'boundary' }],
    elements: [
      { id: 'api', type: 'node', x: 120, y: 120, width: 170, height: 72, text: 'API', icon: 'api', groupId: 'runtime' },
      { id: 'svc-a', type: 'node', x: 420, y: 80, width: 170, height: 72, text: 'Service A', icon: 'service', groupId: 'runtime' },
      { id: 'svc-b', type: 'node', x: 420, y: 210, width: 170, height: 72, text: 'Service B', icon: 'service', groupId: 'runtime' },
      { id: 'queue', type: 'node', x: 120, y: 400, width: 170, height: 72, text: 'Events', icon: 'queue', groupId: 'runtime' },
      { id: 'worker-a', type: 'node', x: 420, y: 360, width: 170, height: 72, text: 'Worker A', icon: 'worker', groupId: 'runtime' },
      { id: 'worker-b', type: 'node', x: 420, y: 490, width: 170, height: 72, text: 'Worker B', icon: 'worker', groupId: 'runtime' },
      { id: 'api-a', type: 'arrow', from: 'api', to: 'svc-a' },
      { id: 'api-b', type: 'arrow', from: 'api', to: 'svc-b' },
      { id: 'queue-a', type: 'arrow', from: 'queue', to: 'worker-a' },
      { id: 'queue-b', type: 'arrow', from: 'queue', to: 'worker-b' },
    ],
  }

  const result = routeArchitectureEdges(scene)
  const arrows = new Map(result.elements.filter((item) => item.type === 'arrow').map((item) => [item.id, item]))
  assert.equal(arrows.get('api-a')?.bundleKey, undefined)
  assert.equal(arrows.get('api-b')?.bundleKey, undefined)
  assert.equal(arrows.get('queue-a')?.bundleKey, 'from:queue')
  assert.equal(arrows.get('queue-b')?.bundleKey, 'from:queue')

  }
})

test("同组多目标共享线路约束", () => {
  // 场景 9: 'routes downward fan-out into one architecture group through a shared data bus'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Shared data bus',
    width: 1200,
    height: 760,
    groups: [{ id: 'data', label: 'Data', kind: 'boundary' }],
    elements: [
      { id: 'service', type: 'node', x: 480, y: 100, width: 180, height: 80, text: 'Core', icon: 'service' },
      { id: 'redis', type: 'node', x: 240, y: 520, width: 160, height: 72, text: 'Redis', icon: 'cache', groupId: 'data' },
      { id: 'search', type: 'node', x: 500, y: 520, width: 160, height: 72, text: 'Search', icon: 'search', groupId: 'data' },
      { id: 'db', type: 'node', x: 760, y: 520, width: 160, height: 72, text: 'Database', icon: 'database', groupId: 'data' },
      { id: 'to-redis', type: 'arrow', from: 'service', to: 'redis' },
      { id: 'to-search', type: 'arrow', from: 'service', to: 'search' },
      { id: 'to-db', type: 'arrow', from: 'service', to: 'db' },
    ],
  }

  const result = beautifyArchitectureScene(scene, { repartition: false, relayout: false }).scene
  const arrows = result.elements.filter((item) => item.type === 'arrow')
  assert.equal(arrows.length, 3)
  assert.ok(arrows.every((arrow) => arrow.bundleKey === 'from:service'))
  assert.ok(arrows.every((arrow) => arrow.fromAnchor === 'bottom' && arrow.toAnchor === 'top'))
  const firstBends = arrows.map((arrow) => arrow.points?.[0]).filter(Boolean)
  assert.equal(firstBends.length, 3)
  assert.ok(firstBends.every((point) => point?.x === firstBends[0]?.x && point?.y === firstBends[0]?.y))

  }
  // 场景 10: 'does not route a shared downward fanout through sibling targets in a multi-row group'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Stacked target group',
    width: 1200,
    height: 760,
    groups: [{ id: 'data', label: 'Data', kind: 'boundary' }],
    elements: [
      { id: 'api', type: 'node', x: 480, y: 80, width: 180, height: 80, text: 'Query API', icon: 'api' },
      { id: 'top-left', type: 'node', x: 340, y: 430, width: 160, height: 72, text: 'Search', icon: 'search', groupId: 'data' },
      { id: 'top-right', type: 'node', x: 600, y: 430, width: 160, height: 72, text: 'Vector', icon: 'vector', groupId: 'data' },
      { id: 'bottom-left', type: 'node', x: 340, y: 560, width: 160, height: 72, text: 'Database', icon: 'database', groupId: 'data' },
      { id: 'bottom-right', type: 'node', x: 600, y: 560, width: 160, height: 72, text: 'Files', icon: 'file', groupId: 'data' },
      { id: 'to-search', type: 'arrow', from: 'api', to: 'top-left' },
      { id: 'to-vector', type: 'arrow', from: 'api', to: 'top-right' },
      { id: 'to-db', type: 'arrow', from: 'api', to: 'bottom-left' },
      { id: 'to-files', type: 'arrow', from: 'api', to: 'bottom-right' },
    ],
    architecture: { theme: 'enterprise', view: 'detail', density: 'compact' },
  }

  const result = routeArchitectureEdges(scene)
  const quality = assessCanvasVisualQuality(result)
  assert.equal(quality.metrics.edgeNodeIntersections, 0)
  assert.equal(quality.metrics.nodeOverlaps, 0)

  }
  // 场景 11: 'shared data bus can exit a dense service cluster without falling back to crossing straight lines'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Dense data fanout',
    width: 1400,
    height: 900,
    groups: [{ id: 'data', label: 'Data', kind: 'boundary' }],
    elements: [
      { id: 'core', type: 'node', x: 900, y: 100, width: 188, height: 80, text: 'Core', icon: 'service' },
      { id: 'neighbor', type: 'node', x: 700, y: 200, width: 188, height: 80, text: 'Model', icon: 'ai' },
      { id: 'worker', type: 'node', x: 780, y: 440, width: 188, height: 80, text: 'Worker', icon: 'worker' },
      { id: 'redis', type: 'node', x: 480, y: 700, width: 180, height: 80, text: 'Redis', icon: 'cache', groupId: 'data' },
      { id: 'search', type: 'node', x: 700, y: 700, width: 180, height: 80, text: 'Search', icon: 'search', groupId: 'data' },
      { id: 'vector', type: 'node', x: 920, y: 700, width: 180, height: 80, text: 'Vector', icon: 'vector', groupId: 'data' },
      { id: 'core-redis', type: 'arrow', from: 'core', to: 'redis' },
      { id: 'core-search', type: 'arrow', from: 'core', to: 'search' },
      { id: 'core-vector', type: 'arrow', from: 'core', to: 'vector' },
      { id: 'worker-redis', type: 'arrow', from: 'worker', to: 'redis' },
      { id: 'worker-search', type: 'arrow', from: 'worker', to: 'search' },
      { id: 'worker-vector', type: 'arrow', from: 'worker', to: 'vector' },
    ],
    architecture: { theme: 'enterprise', view: 'detail', density: 'comfortable' },
  }

  const result = routeArchitectureEdges(scene)
  const quality = assessCanvasVisualQuality(result)
  assert.equal(quality.metrics.edgeNodeIntersections, 0)
  assert.equal(quality.metrics.edgeCrossings, 0)
  assert.ok(result.elements.filter((item) => item.type === 'arrow').every((item) => item.type === 'arrow' && item.routing === 'orthogonal'))

  }
})

test("典型图拓扑与跨分区走廊", () => {
  // 场景 12: 'routes common architecture topology families without crossing nodes'
  {
  const node = (id: string, x: number, y: number, icon: 'service' | 'gateway' | 'api' | 'database' | 'external' | 'ai' | 'web' | 'mcp' | 'queue' | 'worker' | 'search' = 'service') => ({
    id,
    type: 'node' as const,
    x,
    y,
    width: 160,
    height: 72,
    text: id,
    icon,
  })
  const arrow = (id: string, from: string, to: string, emphasis: 'primary' | 'secondary' = 'secondary') => ({
    id,
    type: 'arrow' as const,
    from,
    to,
    emphasis,
  })
  const scenes: CanvasScene[] = [
    {
      type: 'diagram-plugin-canvas', version: 1, title: 'Layered backbone', width: 1200, height: 700,
      elements: [
        node('entry', 80, 120, 'gateway'), node('api', 340, 120, 'api'), node('service', 600, 120), node('data', 900, 120, 'database'),
        arrow('e1', 'entry', 'api', 'primary'), arrow('e2', 'api', 'service', 'primary'), arrow('e3', 'service', 'data', 'primary'),
      ],
    },
    {
      type: 'diagram-plugin-canvas', version: 1, title: 'Convergence', width: 1200, height: 760,
      elements: [
        node('source-a', 80, 100, 'external'), node('source-b', 80, 300, 'external'), node('source-c', 80, 500, 'external'),
        node('processor', 500, 300), node('store', 900, 300, 'database'),
        arrow('c1', 'source-a', 'processor'), arrow('c2', 'source-b', 'processor'), arrow('c3', 'source-c', 'processor'), arrow('c4', 'processor', 'store', 'primary'),
      ],
    },
    {
      type: 'diagram-plugin-canvas', version: 1, title: 'Hub and spoke', width: 1300, height: 800,
      elements: [
        node('hub', 560, 330, 'ai'), node('web', 120, 120, 'web'), node('tools', 1000, 120, 'mcp'), node('events', 120, 580, 'queue'), node('store', 1000, 580, 'database'),
        arrow('h1', 'web', 'hub'), arrow('h2', 'hub', 'tools'), arrow('h3', 'hub', 'events'), arrow('h4', 'hub', 'store'),
      ],
    },
    {
      type: 'diagram-plugin-canvas', version: 1, title: 'Async pipeline', width: 1400, height: 760,
      elements: [
        node('api', 80, 160, 'api'), node('queue', 400, 160, 'queue'), node('worker-a', 720, 80, 'worker'), node('worker-b', 720, 300, 'worker'),
        node('database', 1060, 80, 'database'), node('index', 1060, 300, 'search'),
        arrow('q1', 'api', 'queue', 'primary'), arrow('q2', 'queue', 'worker-a'), arrow('q3', 'queue', 'worker-b'), arrow('q4', 'worker-a', 'database'), arrow('q5', 'worker-b', 'index'),
      ],
    },
  ]

  for (const scene of scenes) {
    const quality = assessCanvasVisualQuality(routeArchitectureEdges(scene))
    assert.equal(quality.metrics.nodeOverlaps, 0, `${scene.title}: nodes should not overlap`)
    assert.equal(quality.metrics.edgeNodeIntersections, 0, `${scene.title}: relationships should not cross nodes`)
    assert.equal(quality.metrics.edgeCrossings, 0, `${scene.title}: common topology should route cleanly`)
  }

  }
  // 场景 13: 'dense cross-boundary relationships share a corridor and avoid unrelated boundaries'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Dense cross-boundary routing',
    width: 1500,
    height: 900,
    groups: [
      { id: 'apps', label: 'Applications', kind: 'boundary' },
      { id: 'processing', label: 'Processing', kind: 'boundary' },
      { id: 'data', label: 'Data', kind: 'boundary' },
    ],
    architecture: { theme: 'enterprise', view: 'detail', density: 'compact' },
    elements: [
      { id: 'app-a', type: 'node', x: 100, y: 150, width: 170, height: 70, text: 'App A', icon: 'service', groupId: 'apps' },
      { id: 'app-b', type: 'node', x: 100, y: 270, width: 170, height: 70, text: 'App B', icon: 'service', groupId: 'apps' },
      { id: 'app-c', type: 'node', x: 100, y: 390, width: 170, height: 70, text: 'App C', icon: 'service', groupId: 'apps' },
      { id: 'processor-top', type: 'node', x: 590, y: 90, width: 210, height: 70, text: 'Processor A', icon: 'worker', groupId: 'processing' },
      { id: 'processor-bottom', type: 'node', x: 590, y: 490, width: 210, height: 70, text: 'Processor B', icon: 'worker', groupId: 'processing' },
      { id: 'db-a', type: 'node', x: 1120, y: 150, width: 170, height: 70, text: 'DB A', icon: 'database', groupId: 'data' },
      { id: 'db-b', type: 'node', x: 1120, y: 270, width: 170, height: 70, text: 'DB B', icon: 'database', groupId: 'data' },
      { id: 'db-c', type: 'node', x: 1120, y: 390, width: 170, height: 70, text: 'DB C', icon: 'database', groupId: 'data' },
      { id: 'a-db', type: 'arrow', from: 'app-a', to: 'db-a', emphasis: 'secondary' },
      { id: 'b-db', type: 'arrow', from: 'app-b', to: 'db-b', emphasis: 'secondary' },
      { id: 'c-db', type: 'arrow', from: 'app-c', to: 'db-c', emphasis: 'secondary' },
    ],
  }

  const result = routeArchitectureEdges(scene)
  const boxes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  const processingFrame = canvasGroupFrames(result).find((group) => group.id === 'processing')
  assert.ok(processingFrame)
  const crossBoundary = result.elements.filter((item) => item.type === 'arrow')
  assert.ok(crossBoundary.every((arrow) => arrow.bundleKey === 'group:apps->data'))
  assert.ok(canvasBundleTrunks(result).some((trunk) => trunk.id.startsWith('group:apps->data:')))

  for (const arrow of crossBoundary) {
    const from = boxes.get(arrow.from)!
    const to = boxes.get(arrow.to)!
    const start = anchorPoint(from, arrow.fromAnchor, to)
    const end = anchorPoint(to, arrow.toAnchor, from)
    const route = canvasArrowRoutePoints(start, end, arrow)
    for (let index = 0; index < route.length - 1; index += 1) {
      assert.equal(segmentCutsBox(route[index], route[index + 1], processingFrame), false)
    }
  }

  }
})

test("局部和系统语义边界", () => {
  // 场景 14: 'uses tight local architecture boundaries by default while keeping external providers separate'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Knowledge Platform',
    width: 1200,
    height: 800,
    elements: [
      { id: 'oidc', type: 'node', x: 60, y: 120, width: 200, height: 90, text: 'Enterprise OIDC Provider' },
      { id: 'web', type: 'node', x: 340, y: 120, width: 200, height: 90, text: 'React Web App' },
      { id: 'api', type: 'node', x: 620, y: 120, width: 200, height: 90, text: 'REST API Gateway' },
      { id: 'db', type: 'node', x: 900, y: 120, width: 200, height: 90, text: 'PostgreSQL' },
      { id: 'auth', type: 'arrow', from: 'web', to: 'oidc' },
      { id: 'call', type: 'arrow', from: 'web', to: 'api' },
      { id: 'persist', type: 'arrow', from: 'api', to: 'db' },
    ],
  }

  const result = beautifyArchitectureScene(scene).scene
  const system = result.groups?.find((group) => group.c4Type === 'software-system')
  assert.equal(system, undefined)
  const nodes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  assert.equal(nodes.get('oidc')?.icon, 'auth')
  assert.equal(nodes.get('oidc')?.groupId, 'arch-external')
  assert.equal(nodes.get('web')?.groupId, 'arch-experience')
  assert.equal(nodes.get('api')?.groupId, 'arch-application')
  assert.equal(nodes.get('db')?.groupId, 'arch-data')
  assert.ok(result.groups?.filter((group) => group.id.startsWith('arch-')).every((group) => !group.parentId))

  }
  // 场景 15: 'preserves an explicit software-system boundary around generated local architecture groups'
  {
  const scene = sampleScene()
  scene.groups = [{ id: 'platform', label: 'Platform', kind: 'boundary', c4Type: 'software-system' }]

  const result = beautifyArchitectureScene(scene).scene
  const system = result.groups?.find((group) => group.id === 'platform')
  assert.ok(system)
  const internalGroups = result.groups?.filter((group) => group.id.startsWith('arch-') && group.id !== 'arch-external') ?? []
  assert.ok(internalGroups.length >= 3)
  assert.ok(internalGroups.every((group) => group.parentId === 'platform'))

  }
})

test("阻挡节点的绕行与多走廊", () => {
  // 场景 16: 'routes architecture relationships around blocking nodes'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Obstacle routing',
    width: 1200,
    height: 700,
    elements: [
      { id: 'from', type: 'node', x: 80, y: 240, width: 180, height: 90, text: 'API Gateway', icon: 'gateway' },
      { id: 'blocker', type: 'node', x: 450, y: 210, width: 220, height: 150, text: 'Application Service', icon: 'service' },
      { id: 'to', type: 'node', x: 860, y: 240, width: 180, height: 90, text: 'PostgreSQL', icon: 'database' },
      { id: 'edge', type: 'arrow', from: 'from', to: 'to' },
    ],
  }
  const result = beautifyArchitectureScene(scene, { repartition: false, relayout: false, reroute: true }).scene
  const boxes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  const edge = result.elements.find((item) => item.id === 'edge')
  assert.ok(edge?.type === 'arrow')
  const from = boxes.get('from')!
  const to = boxes.get('to')!
  const start = anchorPoint(from, edge.fromAnchor, { x: to.x, y: to.y })
  const end = anchorPoint(to, edge.toAnchor, { x: from.x, y: from.y })
  const route = [start, ...(edge.points ?? []), end]
  assert.ok(route.length >= 4)
  for (let index = 0; index < route.length - 1; index += 1) {
    assert.equal(segmentCutsBox(route[index], route[index + 1], boxes.get('blocker')!), false)
  }

  }
  // 场景 17: 'routes through two corridors when an intermediate node and stacked target column block simple doglegs'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Stacked target routing',
    width: 1900,
    height: 800,
    elements: [
      { id: 'core', type: 'node', x: 800, y: 260, width: 220, height: 94, text: 'Core', icon: 'service' },
      { id: 'blocker', type: 'node', x: 1190, y: 260, width: 236, height: 94, text: 'Worker', icon: 'worker' },
      { id: 'above', type: 'node', x: 1580, y: 110, width: 220, height: 94, text: 'Redis', icon: 'cache' },
      { id: 'target', type: 'node', x: 1580, y: 260, width: 220, height: 94, text: 'OpenSearch', icon: 'search' },
      { id: 'below', type: 'node', x: 1580, y: 410, width: 220, height: 94, text: 'Qdrant', icon: 'vector' },
      { id: 'edge', type: 'arrow', from: 'core', to: 'target', label: '同步检索' },
    ],
  }

  const result = routeArchitectureEdgesIncremental(scene, ['core'])
  const edge = result.elements.find((item) => item.id === 'edge')
  assert.ok(edge?.type === 'arrow')
  assert.equal(edge.routing, 'orthogonal')
  assert.ok((edge.points?.length ?? 0) >= 2)

  const boxes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  const start = anchorPoint(boxes.get('core')!, edge.fromAnchor, boxes.get('target')!)
  const end = anchorPoint(boxes.get('target')!, edge.toAnchor, boxes.get('core')!)
  const route = [start, ...(edge.points ?? []), end]
  const first = route[1]
  const beforeEnd = route[route.length - 2]
  if (edge.fromAnchor === 'right') assert.ok(first.x >= start.x)
  if (edge.fromAnchor === 'left') assert.ok(first.x <= start.x)
  if (edge.fromAnchor === 'bottom') assert.ok(first.y >= start.y)
  if (edge.fromAnchor === 'top') assert.ok(first.y <= start.y)
  if (edge.toAnchor === 'right') assert.ok(beforeEnd.x >= end.x)
  if (edge.toAnchor === 'left') assert.ok(beforeEnd.x <= end.x)
  if (edge.toAnchor === 'bottom') assert.ok(beforeEnd.y >= end.y)
  if (edge.toAnchor === 'top') assert.ok(beforeEnd.y <= end.y)
  for (const obstacleId of ['blocker', 'above', 'below']) {
    const obstacle = boxes.get(obstacleId)!
    for (let index = 0; index < route.length - 1; index += 1) {
      assert.equal(segmentCutsBox(route[index], route[index + 1], obstacle), false, `${obstacleId} should not be crossed`)
    }
  }

  }
})

test("增量关系几何与明确 ID", () => {
  // 场景 18: 'incremental routing preserves unrelated relationship geometry'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Incremental routing',
    width: 1600,
    height: 900,
    elements: [
      { id: 'a', type: 'node', x: 80, y: 120, width: 180, height: 90, text: 'A' },
      { id: 'b', type: 'node', x: 620, y: 120, width: 180, height: 90, text: 'B' },
      { id: 'c', type: 'node', x: 80, y: 520, width: 180, height: 90, text: 'C' },
      { id: 'd', type: 'node', x: 620, y: 520, width: 180, height: 90, text: 'D' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left', points: [{ x: 420, y: 165 }] },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left', points: [{ x: 420, y: 565 }] },
    ],
  }
  const moved: CanvasScene = {
    ...scene,
    elements: scene.elements.map((item) => item.id === 'b' && item.type === 'node' ? { ...item, y: 260 } : item),
  }
  const result = routeArchitectureEdgesIncremental(moved, ['b'])
  const unrelated = result.elements.find((item) => item.id === 'cd')
  const affected = result.elements.find((item) => item.id === 'ab')
  assert.ok(unrelated?.type === 'arrow' && affected?.type === 'arrow')
  assert.deepEqual(unrelated.points, [{ x: 420, y: 565 }])
  assert.notDeepEqual(affected.points, [{ x: 420, y: 165 }])

  }
  // 场景 19: 'routes only explicitly requested relationship ids'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Arrow subset',
    width: 1200,
    height: 700,
    elements: [
      { id: 'a', type: 'node', x: 80, y: 120, width: 180, height: 90, text: 'A' },
      { id: 'b', type: 'node', x: 760, y: 120, width: 180, height: 90, text: 'B' },
      { id: 'c', type: 'node', x: 80, y: 420, width: 180, height: 90, text: 'C' },
      { id: 'd', type: 'node', x: 760, y: 420, width: 180, height: 90, text: 'D' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b' },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd', routing: 'orthogonal', points: [{ x: 520, y: 465 }] },
    ],
  }
  const result = routeArchitectureArrowIds(scene, ['ab'])
  const ab = result.elements.find((item) => item.id === 'ab')
  const cd = result.elements.find((item) => item.id === 'cd')
  assert.ok(ab?.type === 'arrow' && cd?.type === 'arrow')
  assert.equal(ab.routing, 'orthogonal')
  assert.deepEqual(cd.points, [{ x: 520, y: 465 }])

  }
})

test("移动障碍与增量更新", () => {
  // 场景 20: 'incremental routing reroutes a relationship that a moved node now blocks'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Incremental obstacle',
    width: 1400,
    height: 800,
    elements: [
      { id: 'from', type: 'node', x: 80, y: 180, width: 180, height: 90, text: 'From' },
      { id: 'to', type: 'node', x: 980, y: 180, width: 180, height: 90, text: 'To' },
      { id: 'blocker', type: 'node', x: 450, y: 520, width: 220, height: 120, text: 'Blocker' },
      { id: 'edge', type: 'arrow', from: 'from', to: 'to', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left', points: [{ x: 520, y: 225 }] },
    ],
  }
  const moved: CanvasScene = {
    ...scene,
    elements: scene.elements.map((item) => item.id === 'blocker' && item.type === 'node' ? { ...item, y: 165 } : item),
  }
  const result = routeArchitectureEdgesIncremental(moved, ['blocker'])
  const edge = result.elements.find((item) => item.id === 'edge')
  assert.ok(edge?.type === 'arrow')
  assert.notDeepEqual(edge.points, [{ x: 520, y: 225 }])

  }
  // 场景 21: 'incremental routing detects a moved obstacle crossing an existing straight relationship'
  {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Straight obstacle',
    width: 1200,
    height: 700,
    elements: [
      { id: 'from', type: 'node', x: 80, y: 80, width: 160, height: 80, text: 'From' },
      { id: 'to', type: 'node', x: 880, y: 480, width: 160, height: 80, text: 'To' },
      { id: 'blocker', type: 'node', x: 420, y: 520, width: 180, height: 100, text: 'Blocker' },
      { id: 'edge', type: 'arrow', from: 'from', to: 'to', routing: 'straight' },
    ],
  }
  const moved: CanvasScene = {
    ...scene,
    elements: scene.elements.map((item) => item.id === 'blocker' && item.type === 'node' ? { ...item, x: 480, y: 280 } : item),
  }
  const result = routeArchitectureEdgesIncremental(moved, ['blocker'])
  const edge = result.elements.find((item) => item.id === 'edge')
  assert.ok(edge?.type === 'arrow')
  assert.equal(edge.routing, 'orthogonal')

  }
})

test('recognizes architecture-specific roles beyond generic service and database', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Knowledge platform',
    width: 1400,
    height: 800,
    elements: [
      { id: 'mcp', type: 'node', x: 40, y: 40, width: 200, height: 90, text: 'MCP Server' },
      { id: 'worker', type: 'node', x: 40, y: 180, width: 200, height: 90, text: 'Parse Worker' },
      { id: 'search', type: 'node', x: 40, y: 320, width: 200, height: 90, text: 'OpenSearch' },
      { id: 'vector', type: 'node', x: 40, y: 460, width: 200, height: 90, text: 'Qdrant Vector DB' },
      { id: 'auth', type: 'node', x: 40, y: 600, width: 200, height: 90, text: 'Enterprise OIDC Provider' },
    ],
  }
  const result = beautifyArchitectureScene(scene, { relayout: false }).scene
  const nodes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  assert.equal(nodes.get('mcp')?.icon, 'mcp')
  assert.equal(nodes.get('worker')?.icon, 'worker')
  assert.equal(nodes.get('search')?.icon, 'search')
  assert.equal(nodes.get('vector')?.icon, 'vector')
  assert.equal(nodes.get('auth')?.icon, 'auth')
})

test("展示主题进入和退出", () => {
  // 场景 23: 'persists presentation architecture appearance without dashboard chrome'
  {
  const result = beautifyArchitectureScene(sampleScene(), { theme: 'presentation' }).scene
  const nodes = result.elements.filter((item) => item.type !== 'arrow')

  assert.deepEqual(result.architecture, { theme: 'presentation', presentation: true, view: 'detail', density: 'auto' })
  assert.ok(result.width >= 960)
  assert.ok(result.height >= 620)
  assert.ok(result.width < 1440)
  assert.ok(nodes.every((item) => item.locked || item.y >= 50))

  }
  // 场景 24: 'switching away from presentation removes presentation chrome without changing canvas version'
  {
  const presentation = beautifyArchitectureScene(sampleScene(), { theme: 'presentation' }).scene
  const technical = beautifyArchitectureScene(presentation, { theme: 'technical', relayout: false }).scene

  assert.equal(technical.version, 1)
  assert.deepEqual(technical.architecture, { theme: 'technical', view: 'detail', density: 'auto' })

  }
})

test("全部主题的外观与手动几何保护", () => {
  // 场景 25: 'applies all architecture themes without changing the canvas protocol'
  {
  for (const theme of ['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch'] as const) {
    const result = beautifyArchitectureScene(sampleScene(), { theme, relayout: false }).scene
    assert.equal(result.version, 1)
    assert.equal(result.architecture?.theme, theme)
  }

  }
  // 场景 26: 'theme-only appearance updates preserve authored geometry'
  {
  const scene = beautifyArchitectureScene(sampleScene(), { theme: 'enterprise' }).scene
  const before = new Map(scene.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, { x: item.x, y: item.y, width: item.width, height: item.height }]))
  const themed = applyArchitectureTheme(scene, 'editorial')
  for (const item of themed.elements) {
    if (item.type === 'arrow') continue
    assert.deepEqual({ x: item.x, y: item.y, width: item.width, height: item.height }, before.get(item.id))
  }

  }
  // Real semantics, synthetic geometry: 3 editable proposal tiers must keep
  // every directed relation and manual point in an explicit spacing reflow.
  {
    const proposal: CanvasScene = {
      type: 'diagram-plugin-canvas', version: 1, title: 'Proposal tiers',
      width: 1000, height: 790,
      architecture: { theme: 'enterprise', diagramStyle: 'enterprise', view: 'detail' },
      groups: ['入口层', '服务层', '存储层'].map((label, index) => ({
        id: `layer-${index}`, label, labelSide: 'left' as const,
      })),
      elements: [
        ...['入口', '服务', '数据'].map((text, index) => ({
          id: `n${index}`, type: 'node' as const, text, groupId: `layer-${index}`,
          x: 300, y: 60 + index * 230, width: 200, height: 80,
        })),
        { id: 'e1', type: 'arrow', from: 'n0', to: 'n1', routing: 'orthogonal', fromAnchor: 'bottom', toAnchor: 'top', label: 'HTTP' },
        { id: 'e2', type: 'arrow', from: 'n1', to: 'n2', routing: 'orthogonal', fromAnchor: 'bottom', toAnchor: 'top', label: 'SQL' },
      ],
    }
    const candidate = compactEnterpriseLayerSpacing(proposal)
    assert.notEqual(candidate, proposal, 'a spacious, unlocked proposal can be compacted')
    assert.ok(candidate.height < proposal.height)
    assert.deepEqual(candidate.elements.map((item) => item.id), proposal.elements.map((item) => item.id))
    assert.deepEqual(candidate.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to, item.label]),
      proposal.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to, item.label]))
    assertArchitectureLayoutTransition(proposal, candidate, architectureLayoutContract('reflow'))
    assert.strictEqual(compactEnterpriseLayerSpacing(candidate), candidate, 'repeated compaction is idempotent')
    assert.strictEqual(compactEnterpriseLayerSpacing({ ...proposal, elements: proposal.elements.map((item) =>
      item.type === 'node' && item.id === 'n1' ? { ...item, locked: true } : item) }).height, proposal.height,
    'a locked coordinate rejects the entire proposal instead of partially shifting it')
    assert.strictEqual(compactEnterpriseLayerSpacing({ ...proposal, architecture: { theme: 'enterprise', diagramStyle: 'engineering' } }).height,
      proposal.height, 'engineering layouts must not be rewritten as proposals')
    assert.deepEqual(beautifyArchitectureScene(proposal, { relayout: true }).scene.elements, proposal.elements,
      'ordinary beautification is not implicit geometry compaction')
    assert.ok(beautifyArchitectureScene(proposal, { compactLayerSpacing: true }).scene.height < proposal.height,
      'explicit MCP flag uses the same shared acceptance rule')
  }
})

test('auto density compacts large architecture layouts without changing canvas protocol', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Large architecture',
    width: 1600,
    height: 1000,
    elements: Array.from({ length: 50 }, (_, index) => ({
      id: `service-${index}`,
      type: 'node' as const,
      x: 40 + (index % 5) * 240,
      y: 80 + Math.floor(index / 5) * 120,
      width: 220,
      height: 96,
      text: `Service ${index}`,
      icon: 'service' as const,
    })),
  }

  const result = beautifyArchitectureScene(scene, { density: 'auto' })
  const nodes = result.scene.elements.filter((item) => item.type !== 'arrow')
  assert.equal(result.scene.version, 1)
  assert.equal(result.scene.architecture?.density, 'auto')
  assert.ok(nodes.every((item) => item.width <= 150))
  assert.ok(nodes.every((item) => item.height <= 68))
})

test('美化保留 compose 已写入的分区归属', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Partition ownership', width: 1500, height: 900,
    groups: [
      { id: 'arch-external', label: '外部与参与方', kind: 'boundary' },
      { id: 'arch-application', label: '核心应用', kind: 'boundary' },
      { id: 'arch-processing', label: '处理与异步', kind: 'boundary' },
    ],
    elements: [
      { id: 'api', type: 'node', x: 400, y: 120, width: 204, height: 84, text: 'API', icon: 'api', groupId: 'arch-application' },
      { id: 'x_mcp', type: 'node', x: 80, y: 120, width: 204, height: 84, text: '外部 MCP 客户端', icon: 'mcp', groupId: 'arch-external' },
      { id: 'x_models', type: 'node', x: 80, y: 360, width: 204, height: 84, text: '模型与解析服务', icon: 'ai', groupId: 'arch-external' },
      { id: 'runtime', type: 'node', x: 720, y: 120, width: 204, height: 84, text: 'Agent Runtime', icon: 'worker', groupId: 'arch-processing' },
      { id: 'a1', type: 'arrow', from: 'x_mcp', to: 'api' },
      { id: 'a2', type: 'arrow', from: 'x_models', to: 'api' },
      { id: 'a3', type: 'arrow', from: 'api', to: 'runtime' },
    ],
  }
  const result = beautifyArchitectureScene(scene, { view: 'detail' }).scene
  const nodes = new Map(result.elements.filter((item) => item.type !== 'arrow').map((item) => [item.id, item]))
  assert.equal(nodes.get('x_mcp')?.groupId, 'arch-external')
  assert.equal(nodes.get('x_models')?.groupId, 'arch-external')
  assert.equal(nodes.get('runtime')?.groupId, 'arch-processing')
  assert.equal(nodes.get('api')?.groupId, 'arch-application')
})

function segmentCutsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean {
  const left = box.x - 1
  const right = box.x + box.width + 1
  const top = box.y - 1
  const bottom = box.y + box.height + 1
  if (a.y === b.y) return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
  if (a.x === b.x) return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
  return false
}
