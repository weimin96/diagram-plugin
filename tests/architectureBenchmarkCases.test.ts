import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'

test('core / extended / stress 基准隔离，所有图的关系端点有效', () => {
  assert.equal(architectureBenchmarkCases('core').length, 5)
  assert.equal(architectureBenchmarkCases('extended').length, 20)
  assert.equal(architectureBenchmarkCases('stress').length, 3)
  for (const suite of ['core', 'extended', 'stress'] as const) {
    const cases = architectureBenchmarkCases(suite)
    assert.equal(new Set(cases.map((item) => item.id)).size, cases.length)
    for (const example of cases) {
      const nodes = new Set(example.intent.nodes.map((node) => node.id))
      assert.equal(nodes.size, example.intent.nodes.length, example.id)
      for (const edge of example.intent.relations) {
        assert.ok(nodes.has(edge.from) && nodes.has(edge.to), example.id)
      }
    }
  }
})

test('逆序样例仅改变输入顺序，不捏造或遗漏拓扑', () => {
  const cases = architectureBenchmarkCases('extended')
  for (const original of architectureBenchmarkCases('core')) {
    const reversed = cases.find((item) => item.id === `${original.id}-reversed`)!
    assert.deepEqual(new Set(reversed.intent.nodes.map((node) => node.id)),
      new Set(original.intent.nodes.map((node) => node.id)))
    assert.deepEqual(new Set(reversed.intent.relations.map((edge) => `${edge.from}->${edge.to}`)),
      new Set(original.intent.relations.map((edge) => `${edge.from}->${edge.to}`)))
  }
})
