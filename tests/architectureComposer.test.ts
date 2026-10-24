import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { composeArchitectureGraph, type ArchitectureIntentGraph } from '../src/architectureComposer.js'
import { parseCanvasScene, serializeCanvasScene, type CanvasArrow } from '../src/canvas.js'
import { DiagramStore } from '../src/store.js'

const input: ArchitectureIntentGraph = {
  title: '平台架构',
  nodes: [
    { id: 'person', text: '用户', icon: 'user' },
    { id: 'web', text: 'Web 入口', icon: 'web' },
    { id: 'api', text: 'API 服务', icon: 'api' },
    { id: 'worker', text: '后台 Worker', icon: 'worker' },
    { id: 'queue', text: 'Kafka', icon: 'queue', stencil: 'kafka' },
    { id: 'db', text: 'PostgreSQL', icon: 'database', stencil: 'postgres' },
  ],
  relations: [
    { from: 'person', to: 'web' },
    { from: 'web', to: 'api', label: 'HTTP' },
    { from: 'api', to: 'db', label: 'SQL' },
    { from: 'api', to: 'queue', asynchronous: true },
    { from: 'queue', to: 'worker' },
  ],
}

test('one call composes semantic architecture with coordinates, boundaries and quality results', () => {
  const result = composeArchitectureGraph(input)
  const nodes = result.scene.elements.filter((item) => item.type === 'node')
  assert.equal(result.scene.workbench, 'architecture')
  assert.equal(result.scene.style, 'nord')
  assert.equal(nodes.length, input.nodes.length)
  assert.ok(nodes.every((node) => node.x >= 0 && node.y >= 0))
  assert.ok(new Set(nodes.map((node) => `${node.x}:${node.y}`)).size === nodes.length)
  assert.ok((result.scene.groups?.length ?? 0) >= 3)
  assert.equal(result.quality.metrics.nodeOverlaps, 0)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.ok(result.candidates.length >= 2)
  assert.ok(result.evaluation.structuralScore >= 0 && result.evaluation.structuralScore <= 90)
  assert.ok(result.candidates.every((candidate) => candidate.structuralScore <= 90))
  assert.equal(result.evaluation.layout, result.summary.composition)
  assert.deepEqual(composeArchitectureGraph(input).scene, result.scene)
})

test('fixed density limits candidates and keeps deterministic layout', () => {
  const result = composeArchitectureGraph({ ...input, density: 'compact' })
  assert.ok(result.candidates.every((candidate) => candidate.density === 'compact'))
  assert.equal(result.summary.resolvedDensity, 'compact')
})

test('confirmed primary path and functional regions survive automatic layout and Canvas round trip', () => {
  const intent: ArchitectureIntentGraph = {
    ...input,
    primaryPath: ['person', 'web', 'api', 'db'],
    nodes: input.nodes.map((node) => node.id === 'api'
      ? { ...node, partition: 'processing', sourcePaths: ['src/api.ts'] }
      : node),
  }
  const generated = composeArchitectureGraph(intent)
  const saved = parseCanvasScene(serializeCanvasScene(generated.scene))
  const api = saved.elements.find((element) => element.id === 'api')
  assert.ok(api?.type === 'node')
  assert.equal(api.groupId, 'arch-processing')
  assert.deepEqual(api.sourcePaths, ['src/api.ts'])
  assert.deepEqual(generated.visualPlan.primaryNodeIds, intent.primaryPath)
  const mainEdges = saved.elements.filter((edge): edge is CanvasArrow => edge.type === 'arrow' && edge.emphasis === 'primary')
  assert.deepEqual(mainEdges.map((edge) => [edge.from, edge.to]), [
    ['person', 'web'], ['web', 'api'], ['api', 'db'],
  ])
  assert.deepEqual(composeArchitectureGraph(intent).scene, generated.scene)
})

test('rejects unsupported or invented primary path before writing', () => {
  assert.throws(() => composeArchitectureGraph({ ...input, primaryPath: ['person', 'api'] }), /缺少实际有向关系/)
  assert.throws(() => composeArchitectureGraph({ ...input, primaryPath: ['api', 'web'] }), /缺少实际有向关系/)
  assert.throws(() => composeArchitectureGraph({ ...input, primaryPath: ['person', 'web', 'person'] }), /不重复/)
  assert.throws(() => composeArchitectureGraph({ ...input, primaryPath: ['person', 'missing'] }), /已存在节点/)
})

test('多区域候选局部重排减少交叉且不改动节点与语义关系', () => {
  const nodes = [
    ['audience', '业务用户', 'user'], ['portal', '业务门户', 'web'],
    ['gateway', 'API 网关', 'gateway'], ['auth', '认证服务', 'auth'],
    ['business', '核心业务服务', 'service'], ['search', '检索服务', 'search'],
    ['job', '任务调度', 'scheduler'], ['worker', '异步处理', 'worker'],
    ['queue', '消息队列', 'queue'], ['pg', 'PostgreSQL', 'database'],
    ['redis', 'Redis', 'cache'], ['minio', '对象存储', 'file'],
  ] as const
  const relations = [
    ['audience', 'portal'], ['portal', 'gateway'], ['gateway', 'auth'],
    ['gateway', 'business'], ['business', 'pg'], ['business', 'redis'],
    ['business', 'search'], ['business', 'queue'], ['queue', 'worker'],
    ['job', 'worker'], ['worker', 'minio'],
  ] as const
  const graph: ArchitectureIntentGraph = {
    title: '多区域业务架构',
    nodes: nodes.map(([id, text, icon]) => ({ id, text, icon })),
    relations: relations.map(([from, to]) => ({ from, to })),
  }
  const composed = composeArchitectureGraph(graph)
  const arrows = composed.scene.elements.filter((item) => item.type === 'arrow')
  assert.equal(composed.quality.metrics.edgeCrossings, 0)
  assert.equal(composed.quality.metrics.edgeOverlaps, 0)
  assert.equal(composed.quality.metrics.edgeNodeIntersections, 0)
  assert.ok(composed.reroutedEdges >= 1 && composed.reroutedEdges <= 3)
  assert.deepEqual(arrows.map((arrow) => [arrow.from, arrow.to]), relations.map(([from, to]) => [from, to]))
  assert.deepEqual(composed.scene.elements.filter((item) => item.type === 'node').map((node) => node.id), nodes.map(([id]) => id))
  assert.deepEqual(composeArchitectureGraph(graph).scene, composed.scene)
})

test('invalid semantic relations are rejected before any write', async () => {
  assert.throws(() => composeArchitectureGraph({ ...input, nodes: [...input.nodes, input.nodes[0]] }), /重复/)
  assert.throws(() => composeArchitectureGraph({ ...input, relations: [{ from: 'person', to: 'missing' }] }), /不存在/)
})

test('composed architecture is stored atomically and remains editable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-compose-'))
  try {
    const store = await DiagramStore.open(root)
    const source = serializeCanvasScene(composeArchitectureGraph(input).scene)
    const saved = await store.createComposedArchitecture(input.title, source)
    assert.equal(saved.canvasWorkbench, 'architecture')
    assert.deepEqual(parseCanvasScene(saved.source), parseCanvasScene(await readFile(path.join(root, saved.path), 'utf8')))
    assert.equal((await store.get(saved.path)).canvasWorkbench, 'architecture')
    assert.equal((await store.list()).length, 1)
    await assert.rejects(store.createComposedArchitecture('不匹配标题', source), /标题一致/)
    assert.equal((await store.list()).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
