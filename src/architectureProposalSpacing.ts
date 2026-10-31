import {
  canvasArrowBoxRoute, canvasBundleTrunks, type CanvasNode, type CanvasScene,
} from './canvas.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'

/** Conservative, explicit reflow for authored enterprise proposal bands.
 *
 * Compress only proven empty vertical corridors. Translate the complete
 * orthogonal path with the same piecewise mapping as its endpoints: no edges
 * are reconstructed, removed, or semantically reclassified. An unrelated
 * obstacle, lock, free drawing, or any full-scene regression rejects the
 * candidate without modifying the input.
 */
export function compactEnterpriseLayerSpacing(scene: CanvasScene): CanvasScene {
  if (scene.architecture?.diagramStyle !== 'enterprise') return scene
  const bands = (scene.groups ?? []).filter((group) =>
    group.labelSide === 'left' && !group.parentId && !group.collapsed)
  if (bands.length < 3 || bands.length !== (scene.groups ?? []).length || scene.lanes?.length || scene.elements.some((item) =>
    item.type === 'note' || (item.type === 'node' && (item.locked || item.rotation))
      || (item.type === 'arrow' && (item.freehand || !item.from || !item.to || item.from === item.to
        || item.start || item.end)))) return scene

  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const bandIds = new Set(bands.map((band) => band.id))
  if (nodes.some((node) => !node.groupId || !bandIds.has(node.groupId))) return scene
  const rows = bands.map((band) => {
    const members = nodes.filter((item) => item.groupId === band.id)
    if (!members.length) return null
    return {
      top: Math.min(...members.map((item) => item.y)),
      bottom: Math.max(...members.map((item) => item.y + item.height)),
    }
  }).filter((row): row is { top: number; bottom: number } => Boolean(row))
    .sort((left, right) => left.top - right.top)
  if (rows.length !== bands.length) return scene

  // Reserve enough air for labels/arrow turns; do not tune to a specific file
  // or assume every architecture's layer pitch is identical.
  const minimumClearGap = 72
  const gaps = rows.slice(1).map((row, index) => {
    const preceding = rows[index]
    const gap = row.top - preceding.bottom
    if (gap <= minimumClearGap) return { low: preceding.bottom + 8, high: row.top - 8, delta: 0 }
    return {
      low: preceding.bottom + 8,
      high: row.top - 8,
      // One-pass convergence is required: a second click must be a no-op.
      delta: gap - minimumClearGap,
    }
  })
  if (gaps.some((gap) => gap.high <= gap.low)) return scene
  const reduction = gaps.reduce((sum, gap) => sum + gap.delta, 0)
  if (reduction < 10) return scene
  const shift = (y: number) => gaps.reduce((sum, gap) =>
    sum + gap.delta * Math.max(0, Math.min(1, (y - gap.low) / (gap.high - gap.low))), 0)
  const translate = (y: number) => Math.round((y - shift(y)) * 1000) / 1000

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const elements = scene.elements.map((item) => {
    if (item.type === 'node') return { ...item, y: translate(item.y) }
    if (item.type !== 'arrow') return item
    const from = byId.get(item.from), to = byId.get(item.to)
    if (!from || !to) return item
    const route = canvasArrowBoxRoute(from, to, item)
    if (route.length < 2) return item
    return {
      ...item,
      points: route.slice(1, -1).map((point) => ({ x: point.x, y: translate(point.y) })),
      ...(item.labelPosition
        ? { labelPosition: { x: item.labelPosition.x, y: translate(item.labelPosition.y) } } : {}),
    }
  })
  const next = { ...scene, elements, height: scene.height - reduction }
  if (next.height <= 0 || next.elements.some((item) => item.type === 'node'
    && item.y + item.height > next.height)) return scene

  const before = assessCanvasVisualQuality(scene).metrics
  const after = assessCanvasVisualQuality(next).metrics
  const routeBefore = assessArchitectureRouteDiagnostics(scene)
  const routeAfter = assessArchitectureRouteDiagnostics(next)
  const stableFields = [
    'nodeOverlaps', 'edgeCrossings', 'edgeOverlaps', 'edgeNodeIntersections',
    'labelNodeIntersections', 'labelOverlaps', 'labelOverflows',
  ] as const
  if (stableFields.some((field) => after[field] > before[field])
    || routeAfter.unrelatedFrameIntrusionLength > routeBefore.unrelatedFrameIntrusionLength
    || routeAfter.totalRouteLength >= routeBefore.totalRouteLength
    || canvasBundleTrunks(next).length < canvasBundleTrunks(scene).length) return scene
  return next
}
