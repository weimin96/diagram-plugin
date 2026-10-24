import assert from 'node:assert/strict'
import test from 'node:test'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { architectureCases } from './fixtures/architecture/cases.js'

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
