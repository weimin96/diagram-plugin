import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { composeArchitectureGraph, type ArchitectureIntentGraph } from '../src/architectureComposer.js'
import { parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
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
