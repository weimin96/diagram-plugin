import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasNodeRelations, resolveCanvasRelationshipFocus } from '../src/canvasRelationshipFocus.js'
import { projectArchitectureCase } from '../scripts/architecture-project-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { serializeCanvasScene } from '../src/canvas.js'

test('exact edge focus keeps the true source, target and direction without broad graph traversal', () => {
  const edges = [
    { id: 'a', from: 'composer', to: 'canvas' },
    { id: 'b', from: 'composer', to: 'routing' },
    { id: 'c', from: 'routing', to: 'canvas' },
  ]
  assert.deepEqual(resolveCanvasRelationshipFocus(edges, ['a'], null, false), edges[0])
  assert.deepEqual(resolveCanvasRelationshipFocus(edges, ['a'], 'b', false), edges[1],
    'hover briefly inspects the specific relation, selection returns when hover ends')
  assert.deepEqual(resolveCanvasRelationshipFocus(edges, ['a'], null, false), edges[0])
  assert.equal(resolveCanvasRelationshipFocus(edges, ['a'], 'b', true), null,
    'explicit dependency-trace mode has precedence')
  assert.equal(resolveCanvasRelationshipFocus(edges, ['node-id'], null, false), null)
  assert.equal(resolveCanvasRelationshipFocus(edges, ['a', 'b'], null, false), null)
  assert.equal(resolveCanvasRelationshipFocus(edges, [], 'missing', false), null)
  assert.equal(resolveCanvasRelationshipFocus(edges, [], null, false), null)
})

test('node relationship navigator keeps all actual incoming and outgoing edges, including parallel relations', () => {
  const nodes = [
    { id: 'api', text: 'API' }, { id: 'canvas', text: 'Canvas' },
    { id: 'routing', text: 'Routing' },
  ]
  const edges = [
    { id: 'b', from: 'routing', to: 'canvas', label: 'sync' },
    { id: 'a', from: 'api', to: 'canvas' },
    { id: 'c', from: 'canvas', to: 'api' },
    { id: 'd', from: 'routing', to: 'canvas', label: 'types' },
    { id: 'orphan', from: 'missing', to: 'canvas' },
  ]
  const original = JSON.stringify(edges)
  const relations = canvasNodeRelations('canvas', nodes, edges)
  assert.deepEqual(relations.incoming.map((edge) => [edge.id, edge.oppositeId, edge.label]), [
    ['a', 'api', undefined], ['b', 'routing', 'sync'], ['d', 'routing', 'types'],
  ])
  assert.deepEqual(relations.outgoing.map((edge) => [edge.id, edge.oppositeId]), [['c', 'api']])
  assert.equal(JSON.stringify(edges), original, 'navigator must not mutate or infer graph edges')
  assert.deepEqual(canvasNodeRelations('missing', nodes, edges), { incoming: [], outgoing: [] })
})

test('real source-module arrows focus only their actual direction and never mutate Canvas', async () => {
  const sample = await projectArchitectureCase()
  const output = composeArchitectureGraph(sample.intent)
  const before = serializeCanvasScene(output.scene)
  const edges = output.scene.elements.filter((item) => item.type === 'arrow')
  const picked = edges.find((item) => item.from === 'architectureComposer' && item.to === 'canvas')
  assert.ok(picked)
  const focused = resolveCanvasRelationshipFocus(edges, [picked.id], null, false)
  assert.deepEqual(focused && [focused.id, focused.from, focused.to],
    [picked.id, 'architectureComposer', 'canvas'])
  assert.equal(serializeCanvasScene(output.scene), before)
  assert.equal(output.scene.elements.filter((item) => item.type === 'arrow').length,
    sample.intent.relations.length, 'lens never removes unrelated relationships from the graph')
})
