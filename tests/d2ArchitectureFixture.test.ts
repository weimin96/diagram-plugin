import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureSceneToD2 } from '../scripts/d2-architecture-fixture.js'
import type { CanvasScene } from '../src/canvas.js'

const scene: CanvasScene = {
  type: 'diagram-plugin-canvas', version: 1, title: 'D2 import boundary', width: 1200, height: 720,
  architecture: { theme: 'enterprise', view: 'detail' },
  groups: [{ id: 'app', label: '核心应用', kind: 'boundary' }],
  elements: [
    { id: 'api.a', type: 'node', text: 'API 网关', x: 100, y: 120, width: 180, height: 80, groupId: 'app' },
    { id: 'db/key', type: 'node', text: 'PostgreSQL', x: 500, y: 120, width: 180, height: 80 },
    { id: 'r1', type: 'arrow', from: 'api.a', to: 'db/key', label: 'SQL 写入' },
    { id: 'r2', type: 'arrow', from: 'api.a', to: 'db/key', label: 'SQL 读取' },
  ],
}

test('D2 engine benchmark preserves semantic graph with stable safe aliases and does not mutate Canvas', () => {
  const before = JSON.stringify(scene)
  const one = architectureSceneToD2(scene)
  assert.deepEqual(architectureSceneToD2(scene), one)
  assert.equal(one.nodes.length, 2)
  assert.equal(one.relations.length, 2)
  assert.match(one.source, /g0: \{\n  label: "核心应用"\n  n0: "API 网关" \{\n    shape: rectangle\n    width: 180\n    height: 80\n  \}\n\}/)
  assert.match(one.source, /g0\.n0 -> n1: "SQL 写入"/)
  assert.match(one.source, /g0\.n0 -> n1: "SQL 读取"/)
  assert.equal(one.source.includes('api.a'), false)
  assert.equal(one.source.includes('db/key'), false)
  assert.equal(JSON.stringify(scene), before)
})

test('D2 benchmark refuses broken endpoints rather than inventing nodes', () => {
  assert.throws(() => architectureSceneToD2({ ...scene,
    elements: [...scene.elements, { id: 'bad', type: 'arrow', from: 'missing', to: 'api.a' }],
  }), /悬空架构关系/)
})
