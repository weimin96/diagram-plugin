import assert from 'node:assert/strict'
import test from 'node:test'
import { ARCHITECTURE_NODE_TEMPLATES, architectureNodeTemplate, searchArchitectureNodeTemplates } from '../src/architectureNodeTemplates.js'
import type { CanvasArrow, CanvasScene } from '../src/canvas.js'
import { alignCanvasSelection, canvasRotationFromPointer, computeCanvasSmartSnap, copyCanvasSelection, deleteCanvasSelection, insertCanvasArchitectureNodeTemplate, insertCanvasNodeOnArrow, layoutCanvasNeighborhood, nextCanvasGroupId, pasteCanvasSelection, reconnectCanvasArrow, reflowCanvasNeighborhood, reorderCanvasSelection, resizeCanvasTransformBox, reverseCanvasArrow, scaleCanvasTransformBoxes, separateCanvasSelection, setCanvasC4CollapseLevel } from '../src/canvasOperations.js'

function scene(): CanvasScene {
  return {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'test',
    width: 1200,
    height: 800,
    elements: [
      { id: 'node-1', type: 'node', x: 100, y: 120, width: 200, height: 90, text: 'A' },
      { id: 'node-2', type: 'node', x: 500, y: 360, width: 200, height: 90, text: 'B' },
      { id: 'node-3', type: 'node', x: 850, y: 120, width: 200, height: 90, text: 'C' },
      { id: 'arrow-1', type: 'arrow', from: 'node-1', to: 'node-2' },
      { id: 'arrow-2', type: 'arrow', from: 'node-2', to: 'node-3' },
    ],
  }
}

test('copies and pastes a connected canvas selection with unique remapped arrows', () => {
  const source = scene()
  const copied = copyCanvasSelection(source, ['node-1', 'node-2', 'node-3'])
  assert.equal(copied.length, 5)

  const pasted = pasteCanvasSelection(source, copied)
  assert.equal(pasted.selectedIds.length, 3)
  assert.equal(pasted.scene.elements.length, 10)

  const newIds = new Set(pasted.selectedIds)
  const newArrows = pasted.scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow' && item.id !== 'arrow-1' && item.id !== 'arrow-2')
  assert.equal(newArrows.length, 2)
  assert.notEqual(newArrows[0].id, newArrows[1].id)
  for (const arrow of newArrows) {
    assert.ok(newIds.has(arrow.from))
    assert.ok(newIds.has(arrow.to))
  }
})

test('反转关系保留精确端口归属，换节点时只清理被替换端口', () => {
  const base = scene()
  const fixed: CanvasScene = {
    ...base,
    elements: base.elements.map((item) => item.id === 'arrow-1' && item.type === 'arrow'
      ? { ...item, fromAnchor: 'right', fromPortRatio: 0.25, toAnchor: 'left', toPortRatio: 0.75 } : item),
  }
  const reversed = reverseCanvasArrow(fixed, 'arrow-1').elements.find((item) => item.id === 'arrow-1')
  assert.ok(reversed?.type === 'arrow')
  assert.deepEqual([reversed.fromPortRatio, reversed.toPortRatio], [0.75, 0.25])
  const reconnected = reconnectCanvasArrow(fixed, 'arrow-1', 'to', 'node-3', 'left')
    .elements.find((item) => item.id === 'arrow-1')
  assert.ok(reconnected?.type === 'arrow')
  assert.equal(reconnected.fromPortRatio, 0.25)
  assert.equal(reconnected.toPortRatio, undefined)
  assert.equal(insertCanvasNodeOnArrow(fixed, 'node-3', 'arrow-1').scene.elements
    .filter((item): item is CanvasArrow => item.type === 'arrow' && item.from === 'node-3')[0]?.fromPortRatio, undefined)
})

test('smart snap aligns edges and centers against nearby shapes and boundary targets', () => {
  const edge = computeCanvasSmartSnap(
    { x: 292, y: 210, width: 100, height: 80 },
    [{ x: 400, y: 100, width: 120, height: 80 }],
    10,
  )
  assert.equal(edge.delta.x, 8)
  assert.equal(edge.xGuide, 400)

  const boundary = computeCanvasSmartSnap(
    { x: 94, y: 220, width: 100, height: 80 },
    [],
    8,
    [100],
    [],
  )
  assert.equal(boundary.delta.x, 6)
  assert.equal(boundary.xGuide, 100)
})

test('smart snap equalizes spacing between neighboring shapes and reports matching size', () => {
  const result = computeCanvasSmartSnap(
    { x: 205, y: 100, width: 100, height: 80 },
    [
      { x: 0, y: 100, width: 100, height: 80 },
      { x: 400, y: 100, width: 100, height: 80 },
    ],
    12,
  )
  assert.equal(result.delta.x, -5)
  assert.equal(result.spacingGuides.length, 2)
  assert.deepEqual(result.spacingGuides.map((guide) => guide.distance), [100, 100])
  assert.equal(result.sameWidth, true)
  assert.equal(result.sameHeight, true)
})

test('resizes from directional handles and preserves the opposite edge', () => {
  const east = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100 },
    'e',
    { x: 360, y: 150 },
  )
  assert.deepEqual(east, { x: 100, y: 100, width: 260, height: 100 })

  const west = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100 },
    'w',
    { x: 40, y: 150 },
  )
  assert.deepEqual(west, { x: 40, y: 100, width: 260, height: 100 })

  const centered = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100 },
    'se',
    { x: 350, y: 225 },
    { center: true },
  )
  assert.deepEqual(centered, { x: 50, y: 75, width: 300, height: 150 })

  const rotated = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100, rotation: 90 },
    'e',
    { x: 200, y: 310 },
  )
  assert.deepEqual(rotated, { x: 70, y: 130, width: 260, height: 100, rotation: 90 })
})

test('keeps aspect ratio for corner resize and scales a multi selection as one frame', () => {
  const aspect = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100 },
    'se',
    { x: 360, y: 220 },
    { preserveAspect: true },
  )
  assert.equal(aspect.width / aspect.height, 2)
  assert.equal(aspect.x, 100)
  assert.equal(aspect.y, 100)

  const sideAspect = resizeCanvasTransformBox(
    { x: 100, y: 100, width: 200, height: 100 },
    'e',
    { x: 400, y: 150 },
    { preserveAspect: true },
  )
  assert.deepEqual(sideAspect, { x: 100, y: 75, width: 300, height: 150 })

  const boxes = new Map([
    ['a', { x: 0, y: 0, width: 100, height: 80 }],
    ['b', { x: 200, y: 100, width: 100, height: 80 }],
  ])
  const scaled = scaleCanvasTransformBoxes(boxes, { x: 0, y: 0, width: 300, height: 180 }, 'se', { x: 600, y: 360 })
  assert.deepEqual(scaled.get('a'), { x: 0, y: 0, width: 200, height: 160 })
  assert.deepEqual(scaled.get('b'), { x: 400, y: 200, width: 200, height: 160 })
})

test('rotates from pointer angle and snaps rotation when requested', () => {
  const center = { x: 100, y: 100 }
  assert.equal(canvasRotationFromPointer(center, { x: 100, y: 0 }, { x: 200, y: 100 }), 90)
  assert.equal(canvasRotationFromPointer(center, { x: 100, y: 0 }, { x: 180, y: 40 }, 0, 15), 60)
})

test('copies standalone drawing lines with their absolute geometry', () => {
  const source = scene()
  source.elements.push({ id: 'free-line', type: 'arrow', from: '', to: '', start: { x: 160, y: 560 }, end: { x: 520, y: 620 }, markerEnd: 'arrow', strokeColor: '#2f73d9' })
  const copied = copyCanvasSelection(source, ['free-line'])
  assert.equal(copied.length, 1)
  const pasted = pasteCanvasSelection(source, copied, 32)
  const duplicated = pasted.scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id !== 'free-line' && Boolean(item.start))
  assert.ok(duplicated)
  assert.deepEqual(duplicated.start, { x: 192, y: 592 })
  assert.deepEqual(duplicated.end, { x: 552, y: 652 })
  assert.equal(duplicated.strokeColor, '#2f73d9')
})

test('moves selected boxes one layer at a time without changing arrows', () => {
  const source = scene()
  const forward = reorderCanvasSelection(source, ['node-1'], 'forward')
  assert.deepEqual(forward.elements.filter((item) => item.type !== 'arrow').map((item) => item.id), ['node-2', 'node-1', 'node-3'])
  const backward = reorderCanvasSelection(forward, ['node-1'], 'backward')
  assert.deepEqual(backward.elements.filter((item) => item.type !== 'arrow').map((item) => item.id), ['node-1', 'node-2', 'node-3'])
  assert.deepEqual(backward.elements.filter((item) => item.type === 'arrow').map((item) => item.id), ['arrow-1', 'arrow-2'])
})

test('deleting a canvas node also deletes connected arrows', () => {
  const deleted = deleteCanvasSelection(scene(), ['node-2'])
  assert.deepEqual(deleted.elements.map((item) => item.id).sort(), ['node-1', 'node-3'])
})

test('keeps ancestor groups that only contain nested groups when deleting an element', () => {
  const source = scene()
  source.groups = [
    { id: 'group-1', label: 'Parent' },
    { id: 'group-2', label: 'Child', parentId: 'group-1' },
  ]
  source.elements = source.elements.map((item) => item.id === 'node-1' || item.id === 'node-2' ? { ...item, groupId: 'group-2' } : item)
  const deleted = deleteCanvasSelection(source, ['node-3'])
  assert.deepEqual(deleted.groups?.map((group) => group.id), ['group-1', 'group-2'])
})

test('never reuses a group id that already exists on the scene', () => {
  const source = scene()
  source.groups = [{ id: 'group-1', label: 'Existing' }]
  assert.equal(nextCanvasGroupId(source), 'group-2')
})

test('architecture node templates cover builtin and selected cloud providers', () => {
  assert.ok(ARCHITECTURE_NODE_TEMPLATES.length >= 60)
  for (const provider of ['builtin', 'aws', 'azure', 'gcp'] as const) {
    assert.ok(ARCHITECTURE_NODE_TEMPLATES.some((item) => item.provider === provider))
  }
  assert.equal(architectureNodeTemplate('aws:lambda')?.icon, 'worker')
  assert.equal(architectureNodeTemplate('azure:azureopenai')?.icon, 'ai')
  assert.equal(architectureNodeTemplate('gcp:cloud_sql')?.icon, 'database')
  assert.deepEqual(searchArchitectureNodeTemplates('serverless', 'aws', 4).map((item) => item.id), ['aws:lambda'])
  assert.ok(searchArchitectureNodeTemplates('kubernetes', 'all', 10).some((item) => item.id === 'builtin:kubernetes'))
  assert.ok(searchArchitectureNodeTemplates('kubernetes', 'all', 10).some((item) => item.id === 'gcp:google_kubernetes_engine'))
})

test('inserts an architecture node template without conflating role, technology and visual icon', () => {
  const source = scene()
  source.architecture = { theme: 'enterprise', view: 'detail', density: 'auto' }
  source.groups = [{ id: 'arch-application', label: 'Application', kind: 'boundary' }]
  const template = architectureNodeTemplate('aws:lambda')
  assert.ok(template)
  const result = insertCanvasArchitectureNodeTemplate(source, template, { x: 600, y: 300 })
  const node = result.scene.elements.find((item) => item.id === result.selectedIds[0])
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'worker')
  assert.equal(node.iconRef, 'aws:lambda')
  assert.equal(node.groupId, undefined)
  assert.equal(node.text, 'Lambda')
  assert.equal(node.subtitle, 'Serverless Function')

  const spring = architectureNodeTemplate('builtin:spring')
  assert.ok(spring)
  const withExistingGroup = insertCanvasArchitectureNodeTemplate(source, spring, { x: 400, y: 220 })
  const springNode = withExistingGroup.scene.elements.find((item) => item.id === withExistingGroup.selectedIds[0])
  assert.ok(springNode && springNode.type === 'node')
  assert.equal(springNode.groupId, 'arch-application')
  assert.equal(springNode.stencil, 'spring')
  assert.equal(springNode.iconRef, undefined)

  source.groups.push({ id: 'custom-boundary', label: 'Custom', kind: 'boundary' })
  const dropped = insertCanvasArchitectureNodeTemplate(source, spring, { x: 520, y: 360 }, 'custom-boundary')
  const droppedNode = dropped.scene.elements.find((item) => item.id === dropped.selectedIds[0])
  assert.ok(droppedNode && droppedNode.type === 'node')
  assert.equal(droppedNode.groupId, 'custom-boundary')
})

test('aligns selected canvas boxes while retaining unrelated elements', () => {
  const aligned = alignCanvasSelection(scene(), ['node-1', 'node-2'], 'x', 16)
  const first = aligned.elements.find((item) => item.id === 'node-1')
  const second = aligned.elements.find((item) => item.id === 'node-2')
  assert.ok(first && first.type === 'node')
  assert.ok(second && second.type === 'node')
  assert.equal(first.x, second.x)
  assert.deepEqual(aligned.elements.find((item) => item.id === 'node-3'), scene().elements.find((item) => item.id === 'node-3'))
})

test('aligns boxes of different sizes on a shared center line', () => {
  const source = scene()
  source.elements = [
    { id: 'node-1', type: 'node', x: 100, y: 120, width: 200, height: 90, text: 'A' },
    { id: 'node-2', type: 'node', x: 500, y: 360, width: 90, height: 40, text: 'B' },
  ]
  const aligned = alignCanvasSelection(source, ['node-1', 'node-2'], 'x', 16)
  const centers = aligned.elements.map((item) => item.type === 'arrow' ? Number.NaN : item.x + item.width / 2)
  assert.equal(centers[0], centers[1])
  assert.equal(centers[0] % 16, 0)
})

test('reconnects an arrow endpoint and clears stale manual routing', () => {
  const source = scene()
  source.elements = source.elements.map((item) => item.id === 'arrow-1' && item.type === 'arrow'
    ? { ...item, points: [{ x: 320, y: 200 }], labelPosition: { x: 350, y: 170 }, bundleKey: 'from:node-1' }
    : item)
  const next = reconnectCanvasArrow(source, 'arrow-1', 'to', 'node-3', 'left')
  const arrow = next.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'arrow-1')
  assert.ok(arrow)
  assert.equal(arrow.to, 'node-3')
  assert.equal(arrow.toAnchor, 'left')
  assert.equal(arrow.points, undefined)
  assert.equal(arrow.labelPosition, undefined)
  assert.equal(arrow.bundleKey, undefined)
})

test('inserts a node into an existing relationship without duplicating its label', () => {
  const source = scene()
  source.elements = source.elements.map((item) => item.id === 'arrow-1' && item.type === 'arrow' ? { ...item, label: 'request' } : item)
  const result = insertCanvasNodeOnArrow(source, 'node-3', 'arrow-1')
  assert.ok(result.newArrowId)
  const arrows = result.scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const first = arrows.find((item) => item.id === 'arrow-1')
  const second = arrows.find((item) => item.id === result.newArrowId)
  assert.ok(first && second)
  assert.equal(first.from, 'node-1')
  assert.equal(first.to, 'node-3')
  assert.equal(first.label, 'request')
  assert.equal(second.from, 'node-3')
  assert.equal(second.to, 'node-2')
  assert.equal(second.label, undefined)
})

test('separates overlapping selected nodes while leaving unrelated nodes fixed', () => {
  const source = scene()
  source.elements = source.elements.map((item) => {
    if (item.id === 'node-1' && item.type === 'node') return { ...item, x: 100, y: 100 }
    if (item.id === 'node-2' && item.type === 'node') return { ...item, x: 160, y: 130 }
    return item
  })
  const beforeThird = source.elements.find((item) => item.id === 'node-3')
  const next = separateCanvasSelection(source, ['node-1', 'node-2'], 24, 16)
  const first = next.elements.find((item) => item.id === 'node-1')
  const second = next.elements.find((item) => item.id === 'node-2')
  assert.ok(first && first.type === 'node')
  assert.ok(second && second.type === 'node')
  const overlaps = first.x < second.x + second.width + 24
    && first.x + first.width + 24 > second.x
    && first.y < second.y + second.height + 24
    && first.y + first.height + 24 > second.y
  assert.equal(overlaps, false)
  assert.deepEqual(next.elements.find((item) => item.id === 'node-3'), beforeThird)
})

test('reverses relationship direction while preserving manual bend geometry', () => {
  const source = scene()
  source.elements = source.elements.map((item) => item.id === 'arrow-1' && item.type === 'arrow'
    ? { ...item, fromAnchor: 'right', toAnchor: 'left', points: [{ x: 320, y: 160 }, { x: 420, y: 260 }] }
    : item)
  const next = reverseCanvasArrow(source, 'arrow-1')
  const arrow = next.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === 'arrow-1')
  assert.ok(arrow)
  assert.equal(arrow.from, 'node-2')
  assert.equal(arrow.to, 'node-1')
  assert.equal(arrow.fromAnchor, 'left')
  assert.equal(arrow.toAnchor, 'right')
  assert.deepEqual(arrow.points, [{ x: 420, y: 260 }, { x: 320, y: 160 }])
})

test('reflows only the collision neighborhood while keeping the dragged anchor and distant nodes stable', () => {
  const source = scene()
  source.elements = source.elements.map((item) => {
    if (item.id === 'node-1' && item.type === 'node') return { ...item, x: 100, y: 100 }
    if (item.id === 'node-2' && item.type === 'node') return { ...item, x: 180, y: 120 }
    if (item.id === 'node-3' && item.type === 'node') return { ...item, x: 900, y: 600 }
    return item
  })
  const beforeAnchor = source.elements.find((item) => item.id === 'node-1')
  const beforeDistant = source.elements.find((item) => item.id === 'node-3')
  const result = reflowCanvasNeighborhood(source, ['node-1'], 24, 16)
  assert.ok(result.movedIds.includes('node-2'))
  assert.deepEqual(result.scene.elements.find((item) => item.id === 'node-1'), beforeAnchor)
  assert.deepEqual(result.scene.elements.find((item) => item.id === 'node-3'), beforeDistant)
  const first = result.scene.elements.find((item) => item.id === 'node-1')
  const second = result.scene.elements.find((item) => item.id === 'node-2')
  assert.ok(first && first.type === 'node' && second && second.type === 'node')
  const overlaps = first.x < second.x + second.width + 24
    && first.x + first.width + 24 > second.x
    && first.y < second.y + second.height + 24
    && first.y + first.height + 24 > second.y
  assert.equal(overlaps, false)
})

test('neighborhood reflow keeps nodes inside their assigned vertical lane', () => {
  const source = scene()
  source.lanes = [{ id: 'lane-a', label: 'A', axis: 'vertical', start: 80, size: 360 }]
  source.elements = source.elements.map((item) => item.type === 'node'
    ? { ...item, laneId: 'lane-a', x: item.id === 'node-1' ? 120 : item.id === 'node-2' ? 160 : item.x }
    : item)
  const result = reflowCanvasNeighborhood(source, ['node-1'], 24, 16)
  const second = result.scene.elements.find((item) => item.id === 'node-2')
  assert.ok(second && second.type === 'node')
  assert.ok(second.x >= 88)
  assert.ok(second.x + second.width <= 432)
})

test('lays out only the local graph neighborhood and preserves the selected anchor center', () => {
  const source = scene()
  source.elements.push({ id: 'node-4', type: 'node', x: 1040, y: 620, width: 120, height: 70, text: 'Distant' })
  const anchor = source.elements.find((item) => item.id === 'node-2')
  const distant = source.elements.find((item) => item.id === 'node-4')
  assert.ok(anchor && anchor.type === 'node')
  const beforeCenter = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }
  const result = layoutCanvasNeighborhood(source, ['node-2'], 1, 12, 16)
  const after = result.scene.elements.find((item) => item.id === 'node-2')
  assert.ok(after && after.type === 'node')
  assert.ok(result.scopeIds.includes('node-1'))
  assert.ok(result.scopeIds.includes('node-3'))
  assert.ok(!result.scopeIds.includes('node-4'))
  assert.ok(Math.abs(after.x + after.width / 2 - beforeCenter.x) <= 16)
  assert.ok(Math.abs(after.y + after.height / 2 - beforeCenter.y) <= 16)
  assert.deepEqual(result.scene.elements.find((item) => item.id === 'node-4'), distant)
})

test('switches persisted C4 hierarchy between system, container and expanded levels', () => {
  const source = scene()
  source.groups = [
    { id: 'system', label: 'Platform', kind: 'boundary', c4Type: 'software-system' },
    { id: 'runtime', label: 'Runtime', kind: 'boundary', c4Type: 'container', parentId: 'system' },
    { id: 'domain', label: 'Domain', kind: 'boundary', parentId: 'runtime', collapsed: true },
  ]
  const system = setCanvasC4CollapseLevel(source, 'system')
  assert.equal(system.groups?.find((group) => group.id === 'system')?.collapsed, true)
  assert.equal(system.groups?.find((group) => group.id === 'runtime')?.collapsed, undefined)
  assert.equal(system.groups?.find((group) => group.id === 'domain')?.collapsed, true)
  const container = setCanvasC4CollapseLevel(system, 'container')
  assert.equal(container.groups?.find((group) => group.id === 'system')?.collapsed, undefined)
  assert.equal(container.groups?.find((group) => group.id === 'runtime')?.collapsed, true)
  const expanded = setCanvasC4CollapseLevel(container, 'expanded')
  assert.equal(expanded.groups?.find((group) => group.id === 'system')?.collapsed, undefined)
  assert.equal(expanded.groups?.find((group) => group.id === 'runtime')?.collapsed, undefined)
  assert.equal(expanded.groups?.find((group) => group.id === 'domain')?.collapsed, true)
})
