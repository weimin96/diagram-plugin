import assert from 'node:assert/strict'
import test from 'node:test'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { canvasBundleTrunks } from '../src/canvas.js'
import { inferArchitectureComposition } from '../src/architectureDesign.js'
import { architectureCases } from './fixtures/architecture/cases.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'

test('真实规模虚构拓扑基准不丢失语义关系或穿过节点', () => {
  const ids = new Set<string>()
  for (const example of architectureCases) {
    assert.ok(!ids.has(example.id), 'benchmark ids must be unique')
    ids.add(example.id)
    const composed = composeArchitectureGraph(example.intent)
    const quality = composed.quality.metrics
    const arrows = composed.scene.elements.filter((item) => item.type === 'arrow')
    const nodes = composed.scene.elements.filter((item) => item.type === 'node')
    assert.equal(nodes.length, example.intent.nodes.length, example.id)
    assert.deepEqual(arrows.map(({ from, to }) => [from, to]),
      example.intent.relations.map(({ from, to }) => [from, to]), example.id)
    assert.equal(quality.nodeOverlaps, 0, example.id)
    assert.equal(quality.edgeNodeIntersections, 0, example.id)
    assert.equal(quality.labelNodeIntersections, 0, example.id)
    assert.ok(composed.evaluation.structuralScore > 0, example.id)
  }
})

test('业务平台基准无交叉、无重叠，且输出稳定', () => {
  const example = architectureCases.find((item) => item.id === 'business-platform')!
  const first = composeArchitectureGraph(example.intent)
  assert.equal(first.quality.metrics.edgeCrossings, 0)
  assert.equal(first.quality.metrics.edgeOverlaps, 0)
  assert.equal(first.quality.metrics.excessiveEdgeDetours, 0)
  assert.deepEqual(composeArchitectureGraph(example.intent).scene, first.scene)
})

test('部署拓扑候选选择在不退化业务平台的条件下降低交叉', () => {
  const example = architectureCases.find((item) => item.id === 'deployment')!
  const output = composeArchitectureGraph(example.intent)
  assert.ok(output.candidates.length >= 3)
  assert.equal(output.quality.metrics.nodeOverlaps, 0)
  assert.equal(output.quality.metrics.edgeNodeIntersections, 0)
  assert.equal(output.quality.metrics.edgeCrossings, 0)
  assert.ok(output.evaluation.structuralScore >= 80)
  assert.ok(output.candidates.some((candidate) => candidate.layout === 'hub-spoke'))
  assert.equal(output.evaluation.issueCount, output.quality.issues.length)
})

test('依赖感知的同分区位置交换减少 Agent 和部署拓扑的连线冲突', () => {
  for (const id of ['agent-runtime', 'deployment']) {
    const example = architectureCases.find((item) => item.id === id)!
    const output = composeArchitectureGraph(example.intent)
    assert.equal(output.quality.metrics.edgeCrossings, 0, id)
    assert.equal(output.quality.metrics.edgeOverlaps, 0, id)
    assert.equal(output.quality.metrics.edgeNodeIntersections, 0, id)
    assert.ok(output.reorderedPairs >= 1 && output.reorderedPairs <= 2, id)
    assert.deepEqual(output.scene.elements.filter((item) => item.type === 'arrow')
      .map(({ from, to }) => [from, to]),
    example.intent.relations.map(({ from, to }) => [from, to]), id)
  }
})

test('扩大正交走廊搜索后数据平台连线重叠有上界且不破坏架构', () => {
  const example = architectureCases.find((item) => item.id === 'data-platform')!
  const result = composeArchitectureGraph(example.intent)
  assert.ok(result.quality.metrics.edgeOverlaps <= 1)
  assert.ok(result.quality.metrics.edgeCrossings <= 1)
  assert.ok(result.evaluation.structuralScore >= 82)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.equal(result.quality.metrics.nodeOverlaps, 0)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow')
    .map(({ from, to }) => [from, to]), example.intent.relations.map(({ from, to }) => [from, to]))
})

test('扩大同分区节点邻域后微服务架构不再出现交叉', () => {
  const example = architectureCases.find((item) => item.id === 'microservices')!
  const result = composeArchitectureGraph(example.intent)
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.equal(result.quality.metrics.edgeOverlaps, 1)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.ok(result.reorderedPairs <= 3)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow')
    .map(({ from, to }) => [from, to]), example.intent.relations.map(({ from, to }) => [from, to]))
})

test('共享真实出口主干，仍检测无关线路重叠与伪造 Bundle', () => {
  const example = architectureCases.find((item) => item.id === 'microservices')!
  const result = composeArchitectureGraph(example.intent)
  const fanouts = result.scene.elements.filter((item) => item.type === 'arrow' && item.bundleKey?.startsWith('from:orders'))
  assert.equal(fanouts.length, 2)
  assert.ok(canvasBundleTrunks(result.scene).some((trunk) => trunk.count === 2))
  assert.equal(result.quality.metrics.edgeOverlaps, 1)
  const fake = { ...result.scene, elements: result.scene.elements.map((item) =>
    item.type === 'arrow' && (item.id === '__relation-2' || item.id === '__relation-10')
      ? { ...item, bundleKey: 'from:forged' } : item) }
  assert.equal(assessCanvasVisualQuality(fake).metrics.edgeOverlaps, 1)
})

test('高扇出三段折线必须绕过真实阻挡节点，保留端点语义', () => {
  const sample = architectureBenchmarkCases('extended').find((item) => item.id === 'business-platform-fanout')!
  const result = composeArchitectureGraph(sample.intent)
  assert.equal(result.quality.metrics.nodeOverlaps, 0)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map(({ from, to }) => [from, to]),
    sample.intent.relations.map(({ from, to }) => [from, to]))
})

test('Kafka 和批流数据管线不会被混成普通事件图，微服务不误判', () => {
  for (const [id, expected] of [['data-platform', 'data-platform'], ['microservices', 'event-driven']] as const) {
    const example = architectureCases.find((item) => item.id === id)!
    const scene = {
      type: 'diagram-plugin-canvas' as const, version: 1 as const, title: example.intent.title,
      width: 1200, height: 800,
      elements: [
        ...example.intent.nodes.map((node) => ({ ...node, type: 'node' as const, x: 0, y: 0, width: 204, height: 84 })),
        ...example.intent.relations.map(({ from, to }, index) => ({ id: `rel-${index}`, type: 'arrow' as const, from, to })),
      ],
    }
    assert.equal(inferArchitectureComposition(scene), expected, id)
    const result = composeArchitectureGraph(example.intent)
    assert.equal(result.semanticComposition, expected, id)
    assert.ok(result.candidates.some((candidate) => candidate.layout === expected), id)
  }
})
