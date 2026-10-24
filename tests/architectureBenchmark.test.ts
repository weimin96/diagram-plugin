import assert from 'node:assert/strict'
import test from 'node:test'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { canvasBundleTrunks, canvasSharedSourceStem } from '../src/canvas.js'
import { inferArchitectureComposition } from '../src/architectureDesign.js'
import { architectureCases } from './fixtures/architecture/cases.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'

test('稀疏交错输入按目标空间顺序落位，减小分区重叠而不丢失关系或增加交叉', () => {
  const partitions = [
    { partition: 'external' as const, icon: 'user' as const, count: 2, prefix: 'ext' },
    { partition: 'experience' as const, icon: 'web' as const, count: 2, prefix: 'exp' },
    { partition: 'application' as const, icon: 'service' as const, count: 7, prefix: 'app' },
    { partition: 'processing' as const, icon: 'queue' as const, count: 3, prefix: 'proc' },
    { partition: 'data' as const, icon: 'database' as const, count: 4, prefix: 'data' },
  ]
  const groups = partitions.map(({ partition, icon, count, prefix }) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}${index}`, text: `${partition} ${index}`, icon, partition,
    })))
  const nodes = groups.flatMap((_, index) => groups[index]).sort((a, b) => {
    const first = Number(a.id.match(/\d+$/)?.[0] ?? 0)
    const second = Number(b.id.match(/\d+$/)?.[0] ?? 0)
    return first - second
  })
  const relations = [
    { from: 'ext0', to: 'exp0' }, { from: 'exp0', to: 'app0' },
    { from: 'app0', to: 'proc0' }, { from: 'proc0', to: 'data0' },
  ]
  const intent = { title: 'Interleaved functional regions', nodes, relations }
  const original = JSON.stringify(intent)
  const output = composeArchitectureGraph(intent)
  assert.equal(output.layoutOrderingStrategy, 'spatial-order')
  assert.ok(output.routeDiagnostics.frameOverlapArea <= 100_000)
  assert.equal(output.quality.metrics.edgeCrossings, 0)
  assert.equal(output.quality.metrics.edgeOverlaps, 0)
  assert.equal(output.quality.metrics.edgeNodeIntersections, 0)
  assert.ok(output.evaluation.structuralScore >= 82)
  assert.deepEqual(output.scene.elements.filter((item) => item.type === 'node').map((item) => item.id),
    nodes.map((node) => node.id))
  assert.deepEqual(output.scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to]),
    relations.map((edge) => [edge.from, edge.to]))
  assert.equal(JSON.stringify(intent), original)
  assert.deepEqual(composeArchitectureGraph(intent).scene, output.scene)
})

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
    assert.equal(composed.inputOrderStrategy, 'original', `healthy source-order case should not need normalization: ${example.id}`)
    if (example.id === 'data-platform') {
      assert.equal(composed.layoutOrderingStrategy, 'aligned-spacing', 'use aligned grid only with verified routing improvement')
      assert.equal(quality.edgeCrossings, 0, 'aligned grid removes the prior data-pipeline crossing')
    } else {
      assert.equal(composed.layoutOrderingStrategy, 'semantic', `healthy case should avoid dependency relayout: ${example.id}`)
    }
  }
})

test('P24 仅对低质量多交叉图进行联合分区依赖排布并保留真实关系', () => {
  const sample = architectureBenchmarkCases('extended').find((item) => item.id === 'deployment-fanout')!
  const original = JSON.stringify(sample.intent)
  const result = composeArchitectureGraph(sample.intent)
  assert.equal(result.layoutOrderingStrategy, 'dependency')
  assert.equal(result.inputOrderStrategy, 'original')
  assert.ok(result.evaluation.structuralScore >= 74, 'full-route score improves over 56 baseline')
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.ok(result.quality.metrics.edgeOverlaps <= 6)
  assert.equal(result.quality.metrics.nodeOverlaps, 0)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.equal(result.quality.metrics.labelNodeIntersections, 0)
  assert.ok(result.routeDiagnostics.crossPartitionRouteLength <= 6500)
  assert.ok(result.presentation.estimatedTitlePxAtFit >= 11)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map(({ from, to }) => [from, to]),
    sample.intent.relations.map(({ from, to }) => [from, to]))
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => item.id),
    sample.intent.relations.map((_, index) => `__relation-${index + 1}`))
  assert.equal(JSON.stringify(sample.intent), original)
  const repeated = composeArchitectureGraph(sample.intent)
  assert.deepEqual(repeated.scene, result.scene, 'same graph yields deterministic geometry and ordered elements')
  assert.equal(repeated.layoutOrderingStrategy, result.layoutOrderingStrategy)
})

test('P24 不为零交叉高扇出图追加联合布局搜索', () => {
  for (const id of ['microservices-fanout', 'data-platform-fanout']) {
    const input = architectureBenchmarkCases('extended').find((item) => item.id === id)!.intent
    const output = composeArchitectureGraph(input)
    assert.equal(output.layoutOrderingStrategy, 'semantic', id)
    assert.equal(output.quality.metrics.edgeNodeIntersections, 0, id)
  }
})

test('高扇出冲突只在无新增交叉时采用反向布线，且保留原始关系 ID 和顺序', () => {
  const sample = architectureBenchmarkCases('extended').find((item) => item.id === 'microservices-fanout')!
  const input = JSON.stringify(sample.intent)
  const result = composeArchitectureGraph(sample.intent)
  assert.equal(result.inputOrderStrategy, 'relation-reverse')
  assert.ok(result.evaluation.structuralScore >= 72)
  assert.ok(result.quality.metrics.edgeOverlaps <= 6)
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to]),
    sample.intent.relations.map((item) => [item.from, item.to]))
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => item.id),
    sample.intent.relations.map((_, index) => `__relation-${index + 1}`))
  assert.equal(JSON.stringify(sample.intent), input)
  assert.deepEqual(composeArchitectureGraph(sample.intent).scene, result.scene)
})

test('小规模 AI 图表对任意节点及关系输入顺序进行安全择优，不改关系 ID 和方向', () => {
  const samples = architectureBenchmarkCases('extended')
  const cases = [
    { id: 'business-platform-reversed', score: 89.8, overlaps: 0 },
    { id: 'data-platform-reversed', score: 87.5, overlaps: 1 },
    { id: 'deployment-reversed', score: 90, overlaps: 0 },
  ] as const
  for (const sample of cases) {
    const intent = samples.find((item) => item.id === sample.id)!.intent
    const originalNodes = intent.nodes.map((node) => node.id)
    const originalEdges = intent.relations.map(({ from, to }) => [from, to])
    const actual = composeArchitectureGraph(intent)
    assert.ok(actual.evaluation.structuralScore >= sample.score, sample.id)
    assert.ok(actual.quality.metrics.edgeOverlaps <= sample.overlaps, sample.id)
    assert.equal(actual.quality.metrics.edgeCrossings, 0, sample.id)
    assert.equal(actual.quality.metrics.edgeNodeIntersections, 0, sample.id)
    assert.ok(['original', 'node-id', 'relation-key'].includes(actual.inputOrderStrategy))
    assert.deepEqual(actual.scene.elements.filter((element) => element.type === 'node').map((element) => element.id),
      originalNodes, sample.id)
    assert.deepEqual(actual.scene.elements.filter((element) => element.type === 'arrow').map(({ from, to }) => [from, to]),
      originalEdges, sample.id)
    assert.deepEqual(actual.scene.elements.filter((element) => element.type === 'arrow').map((element) => element.id),
      originalEdges.map((_, index) => `__relation-${index + 1}`), sample.id)
    assert.ok(actual.visualPlan.primaryRelationIds.every((id) =>
      actual.scene.elements.some((element) => element.type === 'arrow' && element.id === id)))
    assert.deepEqual(intent.nodes.map((node) => node.id), originalNodes)
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
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.ok(result.evaluation.structuralScore >= 87.5)
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

test('同源多段折线识别最长共同前缀，不把分叉后的线路当作主干', () => {
  const left = [{ x: 100, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 260 }, { x: 160, y: 260 }]
  const right = [{ x: 100, y: 100 }, { x: 75, y: 100 }, { x: 75, y: 200 }, { x: 170, y: 200 }]
  assert.deepEqual(canvasSharedSourceStem(left, right)?.trunk,
    [{ x: 100, y: 100 }, { x: 75, y: 100 }])
  const sharedSecondLeg = [{ x: 100, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 220 }, { x: 180, y: 220 }]
  const shared = canvasSharedSourceStem(left, sharedSecondLeg)!
  assert.deepEqual(shared.trunk, [{ x: 100, y: 100 }, { x: 50, y: 100 }, { x: 50, y: 220 }])
  assert.equal(canvasSharedSourceStem(left, [{ x: 100, y: 100 }, { x: 100, y: 220 }, { x: 170, y: 220 }]), undefined)
})

test('高扇出保留五条真实主干，并在零交叉下减少非同源重叠', () => {
  const example = architectureBenchmarkCases('extended').find((item) => item.id === 'microservices-fanout')!
  const result = composeArchitectureGraph(example.intent)
  const bundleArrows = result.scene.elements.filter((item) => item.type === 'arrow' && item.bundleKey?.startsWith('from:'))
  assert.equal(bundleArrows.length, 10)
  const trunks = canvasBundleTrunks(result.scene)
  assert.equal(trunks.filter((item) => item.id.startsWith('from:')).length, 5)
  assert.ok(trunks.some((item) => item.path.split('L').length >= 3), '保留多段共享主干')
  assert.equal(result.quality.metrics.edgeCrossings, 0)
  assert.ok(result.quality.metrics.edgeOverlaps <= 6)
  assert.ok(result.evaluation.structuralScore >= 72)
  assert.equal(result.quality.metrics.edgeNodeIntersections, 0)
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow')
    .map(({ from, to }) => [from, to]), example.intent.relations.map(({ from, to }) => [from, to]))
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
