import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasScene } from '../src/canvas.js'
import { architecturePartitionFlow } from '../src/architecturePartitionFlow.js'
import { architectureCases } from './fixtures/architecture/cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'

function graph(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas', version: 1, title: '真实依赖导航',
    width: 1200, height: 900,
    groups: [
      { id: 'storage', label: '存储' },
      { id: 'processing', label: '处理' },
      { id: 'source', label: '数据源' },
      { id: 'empty', label: '空分区' },
    ],
    elements: [
      { id: 'store', type: 'node', x: 700, y: 50, width: 120, height: 60, text: '数据库', groupId: 'storage' },
      { id: 'worker', type: 'node', x: 400, y: 50, width: 120, height: 60, text: '处理', groupId: 'processing' },
      { id: 'other', type: 'node', x: 400, y: 160, width: 120, height: 60, text: '任务', groupId: 'processing' },
      { id: 'start', type: 'node', x: 100, y: 50, width: 120, height: 60, text: '入口', groupId: 'source' },
      { id: 'e1', type: 'arrow', from: 'start', to: 'worker' },
      { id: 'e2', type: 'arrow', from: 'worker', to: 'store' },
      { id: 'e3', type: 'arrow', from: 'worker', to: 'other' },
      { id: 'e4', type: 'arrow', from: 'start', to: 'other' },
    ],
  }
}

test('按照实际跨分区 DAG 排序，且不受原始分区声明顺序影响', () => {
  const scene = graph()
  const before = JSON.stringify(scene)
  const result = architecturePartitionFlow(scene)
  assert.deepEqual(result.steps.map((item) => item.id), ['source', 'processing', 'storage'])
  assert.deepEqual(result.steps.map((item) => [item.nodeCount, item.incoming, item.outgoing, item.targets]), [
    [1, 0, 2, 1],
    [2, 2, 1, 1],
    [1, 1, 0, 0],
  ])
  assert.equal(result.internalRelations, 1)
  assert.equal(result.crossPartitionRelations, 3)
  assert.equal(JSON.stringify(scene), before)
})

test('循环依赖、有歧义的连线及空分区都有界处理', () => {
  const scene = graph()
  scene.elements.push({ id: 'cycle', type: 'arrow', from: 'store', to: 'start' })
  scene.elements.push({ id: 'unknown', type: 'arrow', from: 'store', to: 'missing' })
  const a = architecturePartitionFlow(scene)
  assert.equal(a.steps.length, 3)
  assert.equal(new Set(a.steps.map((item) => item.id)).size, 3)
  assert.equal(a.crossPartitionRelations, 4)
  assert.deepEqual(architecturePartitionFlow(scene), a)
})

test('真实架构实例的所有跨区关系数量与输入一一对应', () => {
  const scene = composeArchitectureGraph(architectureCases.find((item) => item.id === 'data-platform')!.intent).scene
  const result = architecturePartitionFlow(scene)
  const boxes = new Map(scene.elements.filter((item) => item.type === 'node').map((item) => [item.id, item]))
  const expected = scene.elements.filter((item) => item.type === 'arrow'
    && boxes.get(item.from)?.groupId !== boxes.get(item.to)?.groupId).length
  assert.equal(result.crossPartitionRelations, expected)
  assert.ok(result.steps.length >= 3)
  assert.ok(result.steps.every((item) => item.nodeCount > 0))
})
