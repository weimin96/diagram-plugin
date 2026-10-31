import {
  canvasArrowBoxRoute, canvasBundleTrunks, type CanvasArrow, type CanvasNode,
  type CanvasPoint, type CanvasScene,
} from './canvas.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import { assertArchitectureLayoutTransition, architectureLayoutContract } from './architectureLayoutContract.js'

/** Transform orthogonal path columns as a band moves, keeping endpoint normal
 * directions and every real relationship. Horizontal legs change length;
 * vertical columns translate together instead of becoming diagonal.
 */
function moveAttachedRoute(
  points: CanvasPoint[], fromShift: number, toShift: number,
): CanvasPoint[] | undefined {
  const verticalLegs: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    if (Math.abs(points[i].x - points[i + 1].x) < .001
      && Math.abs(points[i].y - points[i + 1].y) > .001) verticalLegs.push(i)
    else if (Math.abs(points[i].y - points[i + 1].y) > .001) return undefined
  }
  // A direct vertical edge with one moved endpoint needs a fresh bend; this
  // conservative path-preserving reflow never guesses that new geometry.
  if (verticalLegs.length === 1 && fromShift !== toShift && points.length === 2) return undefined
  const offsets = new Map<number, number>()
  verticalLegs.forEach((leg, index) => {
    const amount = verticalLegs.length === 1
      ? (leg <= (points.length - 2) / 2 ? fromShift : toShift)
      : fromShift + (toShift - fromShift) * index / (verticalLegs.length - 1)
    offsets.set(leg, amount)
    offsets.set(leg + 1, amount)
  })
  const warped = points.map((point, index) => ({
    x: point.x + (offsets.get(index) ?? (fromShift + (toShift - fromShift) * index / Math.max(1, points.length - 1))),
    y: point.y,
  }))
  return warped.slice(1).some((point, index) =>
    Math.abs(point.x - warped[index].x) > .001 && Math.abs(point.y - warped[index].y) > .001)
    ? undefined : warped
}

/** Reclaim empty space in a right-protruding layer and its exterior corridor.
 * Run only for an explicitly requested reflow. Return the original object on
 * any metric regression; no generated nodes, route reruns or geometry guessing.
 */
export function balanceEnterpriseProposalColumns(scene: CanvasScene): CanvasScene {
  if (scene.architecture?.diagramStyle !== 'enterprise' || scene.lanes?.length
    || (scene.groups?.length ?? 0) < 3 || scene.elements.some((item) =>
      item.type === 'note' || item.type === 'node' && (item.locked || item.rotation)
      || item.type === 'arrow' && (item.freehand || item.start || item.end || !item.from || !item.to
        || item.from === item.to))) return scene
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const groups = scene.groups ?? []
  if (!nodes.length || !arrows.length || groups.some((group) =>
    group.collapsed || group.parentId || group.labelSide !== 'left')
    || nodes.some((node) => !groups.some((group) => group.id === node.groupId))) return scene
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const before = assessCanvasVisualQuality(scene).metrics
  const routeBefore = assessArchitectureRouteDiagnostics(scene)
  const baselineTrunks = canvasBundleTrunks(scene).length
  const originalRight = Math.max(...nodes.map((node) => node.x + node.width))
  const minLeft = Math.min(...nodes.map((node) => node.x))
  let best = scene
  let bestLength = routeBefore.totalRouteLength

  for (const group of groups) {
    const members = nodes.filter((node) => node.groupId === group.id)
    if (members.length < 2) continue
    const otherMembers = nodes.filter((node) => node.groupId !== group.id)
    const overhang = Math.max(...members.map((node) => node.x + node.width))
      - Math.max(...otherMembers.map((node) => node.x + node.width))
    if (overhang < 70) continue
    // Search until the outlier is genuinely in the common grid (one pass),
    // or a hard geometry veto stops further movement. Do not cap the shift at
    // an arbitrary 160px: that would let repeated clicks creep leftward.
    const maxShift = Math.min(600, Math.floor((overhang - 60) / 20) * 20)
    const movedIds = new Set(members.map((node) => node.id))
    const outside = new Set(arrows.filter((arrow) => {
      const source = byId.get(arrow.from), target = byId.get(arrow.to)
      if (!source || !target || source.groupId === target.groupId) return false
      const path = canvasArrowBoxRoute(source, target, arrow)
      return Math.max(...path.map((point) => point.x)) > originalRight + 20
        && Math.abs(source.y - target.y) > Math.max(source.height, target.height) * 3
    }).map((arrow) => arrow.id))
    const related = arrows.filter((arrow) =>
      movedIds.has(arrow.from) || movedIds.has(arrow.to) || outside.has(arrow.id))
    if (related.some((arrow) => arrow.labelPosition)) continue

    for (let shift = 40; shift <= maxShift; shift += 20) {
      if (Math.min(...members.map((node) => node.x - shift)) < minLeft - 24) continue
      let invalid = false
      const elements = scene.elements.map((item) => {
        if (item.type === 'node') return movedIds.has(item.id) ? { ...item, x: item.x - shift } : item
        if (item.type !== 'arrow' || !related.includes(item)) return item
        const source = byId.get(item.from), target = byId.get(item.to)
        if (!source || !target) return item
        const path = canvasArrowBoxRoute(source, target, item)
        let points: CanvasPoint[] | undefined
        if (movedIds.has(item.from) || movedIds.has(item.to)) {
          points = moveAttachedRoute(path, movedIds.has(item.from) ? -shift : 0,
            movedIds.has(item.to) ? -shift : 0)
        } else {
          // Keep the preexisting real perimeter path, bringing only the
          // exterior vertical column inward alongside the protruding band.
          points = path.map((point, index) => ({
            ...point,
            x: index > 0 && index < path.length - 1 && point.x > originalRight + 20
              ? point.x - shift : point.x,
          }))
        }
        if (!points) { invalid = true; return item }
        return { ...item, points: points.slice(1, -1) }
      })
      if (invalid) continue
      const movedNodes = new Map(elements.filter((item): item is CanvasNode => item.type === 'node')
        .map((node) => [node.id, node]))
      const farRight = Math.max(...elements.flatMap((item) => {
        if (item.type === 'node') return [item.x + item.width]
        if (item.type !== 'arrow') return []
        const from = movedNodes.get(item.from), to = movedNodes.get(item.to)
        return from && to ? canvasArrowBoxRoute(from, to, item).map((point) => point.x) : []
      }))
      const candidate = { ...scene, elements, width: Math.min(scene.width, Math.ceil(farRight + 24)) }
      const after = assessCanvasVisualQuality(candidate).metrics
      const routeAfter = assessArchitectureRouteDiagnostics(candidate)
      const protectedMetrics = [
        'nodeOverlaps', 'edgeNodeIntersections', 'edgeCrossings', 'edgeOverlaps',
        'labelNodeIntersections', 'labelOverlaps', 'labelOverflows',
      ] as const
      if (protectedMetrics.some((key) => after[key] > before[key])
        || routeAfter.unrelatedFrameIntrusionLength > routeBefore.unrelatedFrameIntrusionLength
        || routeAfter.frameOverlaps > routeBefore.frameOverlaps
        || routeAfter.nonOrthogonalSegments > routeBefore.nonOrthogonalSegments
        || routeAfter.terminalNormalViolations > routeBefore.terminalNormalViolations
        || canvasBundleTrunks(candidate).length < baselineTrunks
        || routeAfter.totalRouteLength >= bestLength - 1) continue
      try {
        assertArchitectureLayoutTransition(scene, candidate, architectureLayoutContract('reflow'))
      } catch { continue }
      best = candidate
      bestLength = routeAfter.totalRouteLength
    }
  }
  return best
}
