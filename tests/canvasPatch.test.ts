import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasArrow, CanvasNode, CanvasScene } from '../src/canvas.js'
import { buildCanvasSubgraphContext, buildCanvasSubgraphPatch, canvasPatchRebaseReviewIds, mergeCanvasProposalSelection, rebaseCanvasSubgraphPatch } from '../src/canvasPatch.js'
import { parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'

function scene(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Patch test',
    width: 1800,
    height: 1000,
    architecture: { theme: 'technical', view: 'detail', density: 'auto' },
    elements: [
      { id: 'web', type: 'node', x: 120, y: 180, width: 220, height: 96, text: 'Web', icon: 'web', groupId: 'system' },
      { id: 'api', type: 'node', x: 520, y: 180, width: 220, height: 96, text: 'API', icon: 'api', groupId: 'system' },
      { id: 'db', type: 'node', x: 980, y: 180, width: 220, height: 96, text: 'DB', icon: 'database', groupId: 'system' },
      { id: 'locked', type: 'node', x: 520, y: 480, width: 220, height: 96, text: 'Locked', locked: true, groupId: 'system' },
      { id: 'web-api', type: 'arrow', from: 'web', to: 'api', label: 'HTTP', routing: 'orthogonal', points: [{ x: 420, y: 228 }], labelPosition: { x: 410, y: 190 } },
      { id: 'api-db', type: 'arrow', from: 'api', to: 'db', label: 'SQL', routing: 'orthogonal', points: [{ x: 840, y: 228 }], labelPosition: { x: 830, y: 190 }, bundleKey: 'from:api' },
    ],
    groups: [{ id: 'system', label: 'System', kind: 'boundary', c4Type: 'software-system' }],
  }
}

test('semantic patch preserves authored geometry and unrelated relationship geometry', () => {
  const source = scene()
  const result = buildCanvasSubgraphPatch(source, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { text: 'Public API', subtitle: 'Spring Boot' } }],
  })
  const api = result.scene.elements.find((item): item is CanvasNode => item.type === 'node' && item.id === 'api')
  const unrelated = result.scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'web-api')
  assert.ok(api && unrelated)
  assert.equal(api.x, 520)
  assert.equal(api.y, 180)
  assert.equal(api.text, 'Public API')
  assert.deepEqual(unrelated.points, [{ x: 420, y: 228 }])
  assert.deepEqual(unrelated.labelPosition, { x: 410, y: 190 })
  assert.deepEqual(result.automaticElementIds, [])
})

test('adds a stable node without authored coordinates and routes its declared relationship', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    adds: [
      { id: 'cache', type: 'node', properties: { text: 'Redis Cache', icon: 'cache', stencil: 'redis', groupId: 'system' } },
      { id: 'api-cache', type: 'arrow', properties: { from: 'api', to: 'cache', label: 'lookup' } },
    ],
  })
  const cache = result.scene.elements.find((item): item is CanvasNode => item.type === 'node' && item.id === 'cache')
  const edge = result.scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'api-cache')
  assert.ok(cache && edge)
  assert.ok(cache.x >= 0 && cache.x + cache.width <= result.scene.width)
  assert.ok(cache.y >= 0 && cache.y + cache.height <= result.scene.height)
  assert.equal(edge.routing, 'orthogonal')
  assert.ok(result.addedElementIds.includes('cache'))
  assert.ok(result.addedElementIds.includes('api-cache'))
})

test('new nodes inherit an unambiguous group and lane and stay inside that lane', () => {
  const source = scene()
  source.lanes = [{ id: 'runtime', label: 'Runtime', axis: 'vertical', start: 400, size: 420 }]
  source.elements = source.elements.map((item) => item.id === 'api' && item.type === 'node' ? { ...item, laneId: 'runtime' } : item)
  const result = buildCanvasSubgraphPatch(source, {
    scopeElementIds: ['api'],
    adds: [{ id: 'worker', type: 'node', properties: { text: 'Worker' } }],
  })
  const worker = result.scene.elements.find((item) => item.id === 'worker')
  assert.ok(worker && worker.type === 'node')
  assert.equal(worker.groupId, 'system')
  assert.equal(worker.laneId, 'runtime')
  assert.ok(worker.x >= 412)
  assert.ok(worker.x + worker.width <= 808)
})

test('reconnecting an arrow through a patch clears stale authored route metadata', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api-db'],
    updates: [{ id: 'api-db', changes: { to: 'locked' } }],
  })
  const edge = result.scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'api-db')
  assert.ok(edge)
  assert.equal(edge.to, 'locked')
  assert.equal(edge.labelPosition, undefined)
  assert.notDeepEqual(edge.points, [{ x: 840, y: 228 }])
})

test('精确端口 patch 校验边界、锚点依赖与关系重连后的端口释放', () => {
  const base = scene()
  const result = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api-db'],
    updates: [{ id: 'api-db', changes: {
      fromAnchor: 'right', toAnchor: 'left', fromPortRatio: 0.15, toPortRatio: 0.85,
    } }],
  })
  const arrow = result.scene.elements.find((item) => item.id === 'api-db')
  assert.ok(arrow?.type === 'arrow')
  assert.deepEqual([arrow.fromPortRatio, arrow.toPortRatio], [0.15, 0.85])
  assert.deepEqual(parseCanvasScene(serializeCanvasScene(result.scene)).elements
    .filter((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'api-db')
    .map((item) => item.fromPortRatio), [0.15])
  assert.throws(() => buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api-db'], updates: [{ id: 'api-db', changes: { fromPortRatio: 1.5 } }],
  }), /fromPortRatio/)
  assert.throws(() => buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api-db'], updates: [{ id: 'api-db', changes: { fromPortRatio: 0.15 } }],
  }), /精确端口需要明确/)
  const cleared = buildCanvasSubgraphPatch(result.scene, {
    scopeElementIds: ['api-db'], updates: [{ id: 'api-db', changes: { to: 'locked' } }],
  })
  const rerouted = cleared.scene.elements.find((item) => item.id === 'api-db')
  assert.ok(rerouted?.type === 'arrow')
  assert.equal(rerouted.fromPortRatio, undefined) // Auto-reroute resets both ports.
  assert.equal(rerouted.toPortRatio, undefined)
})

test('relationship text-only updates preserve authored route and label geometry', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api-db'],
    updates: [{ id: 'api-db', changes: { label: 'read/write SQL' } }],
  })
  const edge = result.scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'api-db')
  assert.ok(edge)
  assert.equal(edge.label, 'read/write SQL')
  assert.deepEqual(edge.points, [{ x: 840, y: 228 }])
  assert.deepEqual(edge.labelPosition, { x: 830, y: 190 })
  assert.equal(edge.bundleKey, 'from:api')
})

test('removing a node automatically removes its incident relationships and reports impact', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    removeIds: ['api'],
  })
  const ids = new Set(result.scene.elements.map((item) => item.id))
  assert.equal(ids.has('api'), false)
  assert.equal(ids.has('web-api'), false)
  assert.equal(ids.has('api-db'), false)
  assert.ok(result.automaticElementIds.includes('web-api'))
  assert.ok(result.automaticElementIds.includes('api-db'))
})

test('rejects updates outside the declared subgraph scope', () => {
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'db', changes: { text: 'Other DB' } }],
  }), /scope 外元素/)
})

test('rejects AI geometry changes to locked nodes', () => {
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['locked'],
    updates: [{ id: 'locked', changes: { x: 700 } }],
  }), /锁定节点/)
})

test('rejects invalid semantic values instead of silently normalizing them away', () => {
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { tone: 'ultraviolet' } }],
  }), /字段值无效/)
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api-db'],
    updates: [{ id: 'api-db', changes: { fromAnchor: 'center' } }],
  }), /字段值无效/)
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { iconRef: 'lucide:not-real' } }],
  }), /字段值无效/)
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { iconRef: 'aws:not-real' } }],
  }), /字段值无效/)
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { shapeRef: 'flowchart:not-real' } }],
  }), /字段值无效/)
})

test('applies registered drawing geometry independently from semantic role fields', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { shapeRef: 'flowchart:process' } }],
  })
  const node = result.scene.elements.find((item) => item.id === 'api')
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'api')
  assert.equal(node.shapeRef, 'flowchart:process')
})

test('applies explicit visual style overrides without changing node semantics', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { fillColor: '#ffffff', strokeColor: '#2f73d9', strokeWidth: 3, opacity: 0.75, cornerRadius: 18, rotation: 24 } }],
  })
  const node = result.scene.elements.find((item) => item.id === 'api')
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'api')
  assert.equal(node.fillColor, '#ffffff')
  assert.equal(node.strokeColor, '#2f73d9')
  assert.equal(node.opacity, 0.75)
  assert.equal(node.rotation, 24)
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { strokeColor: 'red' } }],
  }), /字段值无效/)
})

test('adds standalone text with bounded typography fields', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: [],
    adds: [{ id: 'caption', type: 'note', properties: { x: 640, y: 120, width: 240, height: 56, text: '阶段说明', textOnly: true, fontSize: 24, fontWeight: 600, textColor: '#2f73d9' } }],
  })
  const note = result.scene.elements.find((item) => item.id === 'caption')
  assert.ok(note && note.type === 'note')
  assert.equal(note.textOnly, true)
  assert.equal(note.fontSize, 24)
  assert.equal(note.fontWeight, 600)
  assert.equal(note.textColor, '#2f73d9')

  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: [],
    adds: [{ id: 'bad-caption', type: 'note', properties: { x: 640, y: 120, width: 240, height: 56, text: 'Bad', textOnly: true, fontSize: 120 } }],
  }), /字段值无效/)
})

test('applies a visual icon override without changing semantic role fields', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { iconRef: 'lucide:server' } }],
  })
  const node = result.scene.elements.find((item) => item.id === 'api')
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'api')
  assert.equal(node.iconRef, 'lucide:server')
})

test('applies a cloud provider icon override without changing semantic role fields', () => {
  const result = buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { iconRef: 'aws:apigateway' } }],
  })
  const node = result.scene.elements.find((item) => item.id === 'api')
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'api')
  assert.equal(node.iconRef, 'aws:apigateway')
})

test('new nodes must provide both coordinates or let the patch engine place them', () => {
  assert.throws(() => buildCanvasSubgraphPatch(scene(), {
    scopeElementIds: ['api'],
    adds: [{ id: 'partial-position', type: 'node', properties: { text: 'Partial', x: 700 } }],
  }), /同时提供 x\/y/)
})

test('local layout reports moved neighbors as automatic impact and preserves locked geometry', () => {
  const source = scene()
  const lockedBefore = source.elements.find((item) => item.id === 'locked')
  const result = buildCanvasSubgraphPatch(source, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { subtitle: 'Restructure this neighborhood' } }],
    layout: 'local',
  })
  assert.ok(result.automaticElementIds.some((id) => id === 'web' || id === 'db' || id === 'web-api' || id === 'api-db'))
  assert.deepEqual(result.scene.elements.find((item) => item.id === 'locked'), lockedBefore)
})

test('strict partial acceptance repairs required architecture relationship geometry', () => {
  const base = scene()
  const candidate = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  }).scene
  const merged = parseCanvasScene(mergeCanvasProposalSelection(
    serializeCanvasScene(base),
    serializeCanvasScene(candidate),
    ['api'],
    false,
  ))
  const api = merged.elements.find((item) => item.id === 'api')
  const baseEdge = base.elements.find((item) => item.id === 'api-db')
  const mergedEdge = merged.elements.find((item) => item.id === 'api-db')
  assert.ok(api && api.type === 'node')
  assert.equal(api.x, 620)
  assert.notDeepEqual(mergedEdge, baseEdge)
})

test('partial acceptance rejects a relationship whose new endpoint was not selected', () => {
  const base = scene()
  const candidate = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api'],
    adds: [
      { id: 'cache', type: 'node', properties: { text: 'Cache', groupId: 'system' } },
      { id: 'api-cache', type: 'arrow', properties: { from: 'api', to: 'cache', label: 'lookup' } },
    ],
  }).scene
  assert.throws(() => mergeCanvasProposalSelection(
    serializeCanvasScene(base),
    serializeCanvasScene(candidate),
    ['api-cache'],
    false,
  ), /需要同时接受新增端点 cache/)
  const merged = parseCanvasScene(mergeCanvasProposalSelection(
    serializeCanvasScene(base),
    serializeCanvasScene(candidate),
    ['cache', 'api-cache'],
    false,
  ))
  assert.ok(merged.elements.some((item) => item.id === 'cache'))
  assert.ok(merged.elements.some((item) => item.id === 'api-cache'))
})

test('legacy partial acceptance can still include related relationship changes', () => {
  const base = scene()
  const candidate = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  }).scene
  const merged = parseCanvasScene(mergeCanvasProposalSelection(
    serializeCanvasScene(base),
    serializeCanvasScene(candidate),
    ['api'],
    true,
  ))
  const baseEdge = base.elements.find((item) => item.id === 'api-db')
  const mergedEdge = merged.elements.find((item) => item.id === 'api-db')
  assert.notDeepEqual(mergedEdge, baseEdge)
})

test('subgraph context returns direct relationships and only relevant metadata', () => {
  const source = scene()
  source.lanes = [{ id: 'lane-runtime', label: 'Runtime', axis: 'vertical', start: 0, size: 1400 }]
  source.elements = source.elements.map((item) => item.type !== 'arrow' && ['web', 'api', 'db'].includes(item.id) ? { ...item, laneId: 'lane-runtime' } : item)
  const context = buildCanvasSubgraphContext(source, ['api'], 0, 20)
  const ids = new Set(context.elements.map((item) => item.id))
  assert.ok(ids.has('api'))
  assert.ok(ids.has('web'))
  assert.ok(ids.has('db'))
  assert.ok(ids.has('web-api'))
  assert.ok(ids.has('api-db'))
  assert.equal(ids.has('locked'), false)
  assert.deepEqual(context.groups?.map((item) => item.id), ['system'])
  assert.deepEqual(context.lanes?.map((item) => item.id), ['lane-runtime'])
  assert.deepEqual(context.scopeNodeIds, ['api'])
  assert.deepEqual(new Set(context.directRelationshipIds), new Set(['web-api', 'api-db']))
  assert.ok(context.contextElementIds.includes('web'))
  assert.ok(context.contextElementIds.includes('db'))
  assert.equal(context.contextElementIds.includes('web-api'), false)
})

test('selecting only an arrow does not promote its endpoint nodes into editable scope', () => {
  const context = buildCanvasSubgraphContext(scene(), ['api-db'], 0, 20)
  assert.deepEqual(context.scopeNodeIds, [])
  assert.deepEqual(context.directRelationshipIds, ['api-db'])
  assert.ok(context.contextElementIds.includes('api'))
  assert.ok(context.contextElementIds.includes('db'))
})

test('subgraph context bounds high fan-out neighborhoods', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Fanout',
    width: 12000,
    height: 4000,
    elements: [{ id: 'hub', type: 'node', x: 100, y: 100, width: 200, height: 90, text: 'Hub', emphasis: 'primary' }],
  }
  for (let index = 0; index < 80; index += 1) {
    source.elements.push({ id: `node-${index}`, type: 'node', x: 500 + index * 120, y: 200, width: 100, height: 60, text: `N${index}` })
    source.elements.push({ id: `edge-${index}`, type: 'arrow', from: 'hub', to: `node-${index}`, emphasis: index < 2 ? 'primary' : 'secondary' })
  }
  const context = buildCanvasSubgraphContext(source, ['hub'], 0, 12)
  const nodeCount = context.elements.filter((item) => item.type !== 'arrow').length
  assert.ok(nodeCount <= 12)
  assert.ok(context.elements.some((item) => item.id === 'hub'))
  assert.ok(context.elements.some((item) => item.id === 'node-0'))
  assert.ok(context.hiddenNodes > 0)
  assert.ok(context.hiddenArrows > 0)
})

test('subgraph context also bounds dense relationship sets', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Dense',
    width: 6000,
    height: 3000,
    elements: [],
  }
  for (let index = 0; index < 30; index += 1) {
    source.elements.push({ id: `n-${index}`, type: 'node', x: 100 + index * 120, y: 100, width: 100, height: 60, text: `N${index}` })
  }
  for (let from = 0; from < 30; from += 1) {
    for (let to = from + 1; to < 30; to += 1) {
      source.elements.push({ id: `e-${from}-${to}`, type: 'arrow', from: `n-${from}`, to: `n-${to}` })
    }
  }
  const context = buildCanvasSubgraphContext(source, ['n-0'], 1, 30)
  const arrowCount = context.elements.filter((item) => item.type === 'arrow').length
  assert.ok(arrowCount <= 120)
  assert.ok(context.hiddenArrows > 0)
})

test('5000-node canvases keep subgraph context bounded and patch only the requested element', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Huge',
    width: 200000,
    height: 4000,
    elements: [],
  }
  for (let index = 0; index < 5000; index += 1) {
    source.elements.push({ id: `n-${index}`, type: 'node', x: 40 + index * 36, y: 120 + index % 4 * 120, width: 120, height: 64, text: `N${index}` })
    if (index > 0) source.elements.push({ id: `e-${index - 1}-${index}`, type: 'arrow', from: `n-${index - 1}`, to: `n-${index}` })
  }
  const context = buildCanvasSubgraphContext(source, ['n-2500'], 1, 24)
  assert.ok(context.elements.filter((item) => item.type !== 'arrow').length <= 24)
  assert.ok(context.hiddenNodes >= 4976)
  assert.ok(context.contextElementIds.length < 100)

  const result = buildCanvasSubgraphPatch(source, {
    scopeElementIds: ['n-2500'],
    updates: [{ id: 'n-2500', changes: { text: 'Updated middle node' } }],
  })
  assert.deepEqual(result.changedElementIds, ['n-2500'])
  assert.equal(result.automaticElementIds.length, 0)
  const distant = result.scene.elements.find((item) => item.id === 'n-4999')
  assert.ok(distant && distant.type === 'node')
  assert.equal(distant.text, 'N4999')
})

test('incremental patch refuses to degrade into a hidden whole-graph reroute', () => {
  const source: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Large fanout',
    width: 20000,
    height: 6000,
    architecture: { theme: 'technical', view: 'detail', density: 'auto' },
    elements: [{ id: 'hub', type: 'node', x: 100, y: 500, width: 200, height: 90, text: 'Hub', icon: 'service' }],
  }
  for (let index = 0; index < 130; index += 1) {
    source.elements.push({ id: `target-${index}`, type: 'node', x: 900 + (index % 10) * 500, y: 100 + Math.floor(index / 10) * 400, width: 180, height: 80, text: `Target ${index}`, icon: 'database' })
    source.elements.push({ id: `edge-${index}`, type: 'arrow', from: 'hub', to: `target-${index}` })
  }
  assert.throws(() => buildCanvasSubgraphPatch(source, {
    scopeElementIds: ['hub'],
    updates: [{ id: 'hub', changes: { x: 180 } }],
  }), /自动重排影响过大/)
})

test('rebases a semantic patch over unrelated concurrent edits', () => {
  const base = scene()
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'db' && item.type === 'node'
    ? { ...item, text: 'Primary DB', x: 1040 }
    : item)
  const result = rebaseCanvasSubgraphPatch(base, current, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { text: 'Public API' } }],
  })
  const api = result.scene.elements.find((item) => item.id === 'api')
  const db = result.scene.elements.find((item) => item.id === 'db')
  assert.ok(api && api.type === 'node' && db && db.type === 'node')
  assert.equal(api.text, 'Public API')
  assert.equal(db.text, 'Primary DB')
  assert.equal(db.x, 1040)
  assert.equal(result.rebased, true)
})

test('rebases changes to a different field on the same element', () => {
  const base = scene()
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'api' && item.type === 'node'
    ? { ...item, subtitle: 'Concurrent subtitle' }
    : item)
  const result = rebaseCanvasSubgraphPatch(base, current, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { text: 'Public API' } }],
  })
  const api = result.scene.elements.find((item) => item.id === 'api')
  assert.ok(api && api.type === 'node')
  assert.equal(api.text, 'Public API')
  assert.equal(api.subtitle, 'Concurrent subtitle')
})

test('rejects rebase when the same owned field changed concurrently', () => {
  const base = scene()
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'api' && item.type === 'node'
    ? { ...item, text: 'Concurrent API' }
    : item)
  assert.throws(() => rebaseCanvasSubgraphPatch(base, current, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { text: 'Public API' } }],
  }), /api\.text/)
})

test('rejects rebase when automatic route geometry was edited concurrently', () => {
  const base = scene()
  const original = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  })
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'api-db' && item.type === 'arrow'
    ? { ...item, points: [{ x: 870, y: 260 }] }
    : item)
  assert.throws(() => rebaseCanvasSubgraphPatch(base, current, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  }, original.automaticElementIds), /api-db\.points/)
})

test('rejects local-layout rebase when neighborhood geometry changed concurrently', () => {
  const base = scene()
  const original = buildCanvasSubgraphPatch(base, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { subtitle: 'Restructure' } }],
    layout: 'local',
  })
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'web' && item.type === 'node'
    ? { ...item, y: item.y + 80 }
    : item)
  assert.throws(() => rebaseCanvasSubgraphPatch(base, current, {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { subtitle: 'Restructure' } }],
    layout: 'local',
  }, original.automaticElementIds), /web\.y/)
})

test('rebase drift asks for review when automatic routing geometry changes', () => {
  const base = scene()
  const patch = {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  }
  const original = buildCanvasSubgraphPatch(base, patch)
  const current = scene()
  current.elements.push({ id: 'blocker', type: 'node', x: 760, y: 120, width: 180, height: 180, text: 'Concurrent blocker', groupId: 'system' })
  const rebased = rebaseCanvasSubgraphPatch(base, current, patch, original.automaticElementIds)
  const reviewIds = canvasPatchRebaseReviewIds(original.scene, rebased.scene, original.automaticElementIds, original.addedElementIds)
  assert.ok(reviewIds.some((id) => original.automaticElementIds.includes(id)))
})

test('rebase drift ignores concurrent semantic fields on automatic relationships', () => {
  const base = scene()
  const patch = {
    scopeElementIds: ['api'],
    updates: [{ id: 'api', changes: { x: 620 } }],
  }
  const original = buildCanvasSubgraphPatch(base, patch)
  const current = scene()
  current.elements = current.elements.map((item) => item.id === 'api-db' && item.type === 'arrow' ? { ...item, label: 'Concurrent SQL label' } : item)
  const rebased = rebaseCanvasSubgraphPatch(base, current, patch, original.automaticElementIds)
  const reviewIds = canvasPatchRebaseReviewIds(original.scene, rebased.scene, original.automaticElementIds, original.addedElementIds)
  assert.equal(reviewIds.includes('api-db'), false)
})

test('rebase drift asks for review when concurrent nodes change automatic placement of a new node', () => {
  const base = scene()
  const patch = {
    scopeElementIds: ['api'],
    adds: [{ id: 'cache', type: 'node' as const, properties: { text: 'Cache', groupId: 'system' } }],
  }
  const original = buildCanvasSubgraphPatch(base, patch)
  const cache = original.scene.elements.find((item) => item.id === 'cache')
  assert.ok(cache && cache.type === 'node')
  const current = scene()
  current.elements.push({ id: 'concurrent-node', type: 'node', x: cache.x, y: cache.y, width: cache.width, height: cache.height, text: 'Concurrent node', groupId: 'system' })
  const rebased = rebaseCanvasSubgraphPatch(base, current, patch, original.automaticElementIds)
  const rebasedCache = rebased.scene.elements.find((item) => item.id === 'cache')
  assert.ok(rebasedCache && rebasedCache.type === 'node')
  assert.notDeepEqual({ x: rebasedCache.x, y: rebasedCache.y }, { x: cache.x, y: cache.y })
  const reviewIds = canvasPatchRebaseReviewIds(original.scene, rebased.scene, original.automaticElementIds, original.addedElementIds)
  assert.ok(reviewIds.includes('cache'))
})
