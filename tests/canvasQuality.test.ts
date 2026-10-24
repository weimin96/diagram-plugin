import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import type { CanvasScene } from '../src/canvas.js'

test('空间索引在密集、稀疏及跨网格节点上与完整两两碰撞判定一致', () => {
  for (const spacing of [29, 84, 240]) {
    const elements: CanvasScene['elements'] = Array.from({ length: 180 }, (_, index) => ({
      id: `n-${index}`, type: 'node', text: `节点 ${index}`,
      x: (index % 20) * spacing + (index % 3) * 9,
      y: Math.floor(index / 20) * spacing + (index % 4) * 7,
      width: 66 + index % 5 * 9, height: 50 + index % 7 * 5,
    }))
    const inset = 2
    const expected: string[] = []
    for (let left = 0; left < elements.length; left += 1) {
      const a = elements[left]
      if (a.type !== 'node') continue
      for (let right = left + 1; right < elements.length; right += 1) {
        const b = elements[right]
        if (b.type !== 'node') continue
        if (a.x + inset < b.x + b.width - inset && a.x + a.width - inset > b.x + inset
          && a.y + inset < b.y + b.height - inset && a.y + a.height - inset > b.y + inset) {
          expected.push(`${a.id}|${b.id}`)
        }
      }
    }
    const scene: CanvasScene = {
      type: 'diagram-plugin-canvas', version: 1, title: '空间网格', width: 6200, height: 2800, elements,
    }
    const result = assessCanvasVisualQuality(scene)
    const actual = result.issues.filter((issue) => issue.code === 'node-overlap')
      .map((issue) => issue.elementIds.join('|'))
    assert.equal(result.metrics.nodeOverlaps, expected.length)
    assert.deepEqual(actual, expected)
  }
})

test('自动标记显著长于直接距离的外围架构绕线', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '过长绕线', width: 1400, height: 1000,
    architecture: { theme: 'enterprise', view: 'detail', density: 'auto' },
    elements: [
      { type: 'node', id: 'a', x: 200, y: 200, width: 150, height: 75, text: '入口' },
      { type: 'node', id: 'b', x: 610, y: 200, width: 150, height: 75, text: '服务' },
      { type: 'arrow', id: 'loop', from: 'a', to: 'b', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left',
        points: [{ x: 430, y: 238 }, { x: 430, y: 900 }, { x: 540, y: 900 }, { x: 540, y: 238 }] },
    ],
  }
  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.metrics.excessiveEdgeDetours, 1)
  assert.ok(quality.issues.some((issue) => issue.code === 'excessive-edge-detour'))
})

test('架构质量检查识别漂亮但只有产品清单的重复泳道矩阵', () => {
  const elements: CanvasScene['elements'] = []
  for (let column = 0; column < 3; column += 1) {
    const hub = `hub-${column}`
    elements.push({ type: 'node', id: hub, text: `产品域 ${column}`, x: 80 + column * 440, y: 370, width: 130, height: 80, laneId: 'products' })
    for (let row = 0; row < 6; row += 1) {
      const leaf = `product-${column}-${row}`
      elements.push({ type: 'node', id: leaf, text: `产品 ${row}`, x: 240 + column * 440, y: 220 + row * 72, width: 260, height: 52, laneId: 'products' })
      elements.push({ type: 'arrow', id: `edge-${column}-${row}`, from: hub, to: leaf })
    }
  }
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '产品清单', width: 1800, height: 1100,
    architecture: { theme: 'enterprise', view: 'detail', density: 'auto' },
    lanes: [
      { id: 'users', label: '用户', axis: 'horizontal', start: 40, size: 150 },
      { id: 'products', label: '产品', axis: 'horizontal', start: 210, size: 570 },
      { id: 'infra', label: '底座', axis: 'horizontal', start: 800, size: 220 },
    ],
    elements: [
      ...elements,
      { type: 'node', id: 'user', text: '用户', x: 80, y: 90, width: 150, height: 70, laneId: 'users' },
      { type: 'node', id: 'infra', text: '基础设施', x: 80, y: 865, width: 150, height: 70, laneId: 'infra' },
    ],
  }
  const quality = assessCanvasVisualQuality(scene)
  assert.ok(quality.needsRevision)
  for (const code of ['decorative-architecture-lanes', 'isolated-architecture-hubs', 'repetitive-card-grid']) {
    assert.ok(quality.issues.some((issue) => issue.code === code), code)
  }
  assert.equal(quality.metrics.crossLaneRelations, 0)
  assert.equal(quality.metrics.isolatedHubs, 3)
  assert.equal(quality.metrics.repeatedCards, 18)
})

test('中英文、人工位置与独立连线固定样例的标签不遮挡节点或互相重叠', () => {
  for (const name of ['chinese-relations', 'english-relations', 'manual-reservation']) {
    const scene: CanvasScene = JSON.parse(readFileSync(new URL(`./fixtures/canvas-labels/${name}.diagram.json`, import.meta.url), 'utf8'))
    const quality = assessCanvasVisualQuality(scene)
    assert.equal(quality.metrics.labelOverlaps, 0, name)
    assert.equal(quality.metrics.labelNodeIntersections, 0, name)
    assert.equal(quality.metrics.labelOverflows, 0, name)
  }
})

test('质量检查报告人工标签与节点和其他标签的碰撞', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '人工标签碰撞', width: 900, height: 500,
    elements: [
      { id: 'a', type: 'node', x: 20, y: 180, width: 180, height: 80, text: '入口' },
      { id: 'b', type: 'node', x: 680, y: 180, width: 180, height: 80, text: '服务' },
      { id: 'request', type: 'arrow', from: 'a', to: 'b', label: '请求处理', labelPosition: { x: 100, y: 220 } },
      { id: 'response', type: 'arrow', from: 'b', to: 'a', label: '返回结果', labelPosition: { x: 100, y: 220 } },
    ],
  }
  const quality = assessCanvasVisualQuality(scene)
  assert.ok(quality.issues.some((issue) => issue.code === 'label-through-node'))
  assert.ok(quality.issues.some((issue) => issue.code === 'label-overlap'))
  assert.equal(quality.metrics.labelOverlaps, 1)
  assert.equal(quality.metrics.labelNodeIntersections, 2)
})

test('Canvas quality gate catches overlap, edge-through-node and long labels', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Quality',
    width: 1200,
    height: 700,
    architecture: { theme: 'technical', view: 'detail', density: 'auto' },
    elements: [
      { id: 'a', type: 'node', x: 60, y: 180, width: 180, height: 90, text: 'API Gateway' },
      { id: 'overlap', type: 'node', x: 180, y: 200, width: 180, height: 90, text: 'Overlapping Service' },
      { id: 'blocker', type: 'node', x: 430, y: 170, width: 200, height: 110, text: 'Worker' },
      { id: 'b', type: 'node', x: 820, y: 180, width: 180, height: 90, text: 'PostgreSQL' },
      { id: 'long', type: 'node', x: 820, y: 420, width: 180, height: 90, text: 'This node title is intentionally much longer than a diagram card should normally contain because it belongs in description' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', routing: 'straight', label: 'HTTP' },
    ],
  }

  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.needsRevision, true)
  assert.ok(quality.metrics.nodeOverlaps >= 1)
  assert.ok(quality.metrics.edgeNodeIntersections >= 1)
  assert.ok(quality.metrics.longLabels >= 1)
  assert.ok(quality.issues.some((issue) => issue.code === 'node-overlap'))
  assert.ok(quality.issues.some((issue) => issue.code === 'edge-through-node'))
  assert.ok(quality.issues.some((issue) => issue.code === 'long-label'))
})

test('Canvas quality gate identifies crossing independent relationships', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Crossing',
    width: 1000,
    height: 700,
    elements: [
      { id: 'a', type: 'node', x: 60, y: 80, width: 120, height: 70, text: 'A' },
      { id: 'b', type: 'node', x: 780, y: 500, width: 120, height: 70, text: 'B' },
      { id: 'c', type: 'node', x: 60, y: 500, width: 120, height: 70, text: 'C' },
      { id: 'd', type: 'node', x: 780, y: 80, width: 120, height: 70, text: 'D' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', routing: 'straight' },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd', routing: 'straight' },
    ],
  }

  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.metrics.edgeCrossings, 1)
  assert.ok(quality.issues.some((issue) => issue.code === 'edge-crossing'))
})

test('同一 bundle 的非共线路段交叉仍然需要报告', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Bundled crossing',
    width: 1000,
    height: 700,
    architecture: { theme: 'enterprise', view: 'detail', density: 'compact' },
    elements: [
      { id: 'a', type: 'node', x: 60, y: 80, width: 120, height: 70, text: 'A' },
      { id: 'b', type: 'node', x: 780, y: 500, width: 120, height: 70, text: 'B' },
      { id: 'c', type: 'node', x: 60, y: 500, width: 120, height: 70, text: 'C' },
      { id: 'd', type: 'node', x: 780, y: 80, width: 120, height: 70, text: 'D' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', routing: 'straight', bundleKey: 'group:left->right' },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd', routing: 'straight', bundleKey: 'group:left->right' },
    ],
  }

  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.metrics.edgeCrossings, 1)
  assert.equal(quality.issues.some((issue) => issue.code === 'edge-crossing'), true)
})

test('质量检查区分独立连线重叠与共享总线', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '重叠线路', width: 600, height: 300,
    elements: [
      { id: 'a', type: 'node', x: 0, y: 0, width: 40, height: 40, text: 'A' },
      { id: 'b', type: 'node', x: 400, y: 0, width: 40, height: 40, text: 'B' },
      { id: 'c', type: 'node', x: 0, y: 200, width: 40, height: 40, text: 'C' },
      { id: 'd', type: 'node', x: 400, y: 200, width: 40, height: 40, text: 'D' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', fromAnchor: 'bottom', toAnchor: 'bottom', routing: 'orthogonal', points: [{ x: 20, y: 100 }, { x: 420, y: 100 }] },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd', fromAnchor: 'top', toAnchor: 'top', routing: 'orthogonal', points: [{ x: 20, y: 100 }, { x: 420, y: 100 }] },
    ],
  }
  assert.equal(assessCanvasVisualQuality(scene).metrics.edgeOverlaps, 1)
  assert.equal(assessCanvasVisualQuality(scene).needsRevision, true)
  const bundled = { ...scene, elements: scene.elements.map((item) => item.type === 'arrow' ? { ...item, bundleKey: 'group:shared' } : item) }
  assert.equal(assessCanvasVisualQuality(bundled).metrics.edgeOverlaps, 0)
})

test('Canvas quality gate passes a simple clean diagram', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Clean',
    width: 900,
    height: 500,
    elements: [
      { id: 'a', type: 'node', x: 80, y: 180, width: 180, height: 90, text: 'Client' },
      { id: 'b', type: 'node', x: 560, y: 180, width: 180, height: 90, text: 'API' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b', routing: 'straight', label: 'HTTPS' },
    ],
  }

  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.needsRevision, false)
  assert.deepEqual(quality.issues, [])
})

test('长注释不会被当作节点标题触发改写', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Note',
    width: 800,
    height: 400,
    elements: [
      { id: 'a', type: 'node', x: 20, y: 20, width: 160, height: 60, text: '入口' },
      { id: 'n', type: 'note', x: 20, y: 140, width: 400, height: 120, text: '说明'.repeat(40) },
    ],
  }
  const quality = assessCanvasVisualQuality(scene)
  assert.equal(quality.issues.some((issue) => issue.code === 'long-label'), false)
})
