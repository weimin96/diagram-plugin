/** Geometry-preserving candidate repairs for the existing Canvas router.
 * Pure candidate generation; acceptance and entire-scene quality scoring
 * remain with the Composer. No layout engine or persisted protocol here.
 */
import { canvasArrowBoxRoute, canvasBundleTrunks, canvasSharedSourceStem, type CanvasArrow, type CanvasNode, type CanvasScene } from './canvas.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'

/** Quality-gated correction for the terminal tangent of newly generated,
 * independent orthogonal relationships. This is never applied to manually
 * edited scenes or verified shared trunks. The original graph and viewport
 * remain unchanged when no globally acceptable correction exists.
 */
export function normalizeGeneratedArchitectureTerminals(scene: CanvasScene): CanvasScene {
  if (!scene.architecture) return scene
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const originalRoutes = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  if (originalRoutes.length < 12) return scene
  const initial = assessArchitectureRouteDiagnostics(scene)
  if (!initial.terminalNormalViolations) return scene
  let best = scene
  let quality = assessCanvasVisualQuality(scene).metrics
  let diagnostics = initial
  const preservedTrunks = canvasSharedSourceStemsSignature(scene)
  const geometricalKeys = [
    'nodeOverlaps', 'edgeCrossings', 'edgeOverlaps', 'edgeNodeIntersections',
    'labelNodeIntersections', 'labelOverlaps', 'labelOverflows',
  ] as const
  for (let pass = 0; pass < 2; pass++) {
    let changes = 0
    for (const original of originalRoutes) {
      const arrow = best.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === original.id)
      if (!arrow || arrow.freehand || arrow.bundleKey || arrow.routing !== 'orthogonal'
        || !arrow.fromAnchor || arrow.fromAnchor === 'auto'
        || !arrow.toAnchor || arrow.toAnchor === 'auto' || arrow.labelPosition) continue
      const source = nodes.get(arrow.from), target = nodes.get(arrow.to)
      if (!source || !target || source.rotation || target.rotation) continue
      const route = canvasArrowBoxRoute(source, target, arrow)
      if (route.length < 3) continue
      let nextBest: { scene: CanvasScene; metrics: typeof quality; route: typeof diagnostics } | undefined
      for (const fromEnd of [true, false]) {
        if (nextBest) break
        const side = fromEnd ? arrow.fromAnchor : arrow.toAnchor
        const endpoint = fromEnd ? route[0] : route.at(-1)!
        const adjacent = fromEnd ? route[1] : route.at(-2)!
        const normal = side === 'left' ? adjacent.y === endpoint.y && adjacent.x < endpoint.x
          : side === 'right' ? adjacent.y === endpoint.y && adjacent.x > endpoint.x
            : side === 'top' ? adjacent.x === endpoint.x && adjacent.y < endpoint.y
              : adjacent.x === endpoint.x && adjacent.y > endpoint.y
        if (normal) continue
        const axis = side === 'top' || side === 'bottom' ? 'y' : 'x'
        const sign = side === 'top' || side === 'left' ? -1 : 1
        for (const distance of [12, 20, 28, 36, 48]) {
          const stub = { ...endpoint, [axis]: endpoint[axis] + sign * distance }
          const bend = axis === 'y'
            ? { x: adjacent.x, y: stub.y } : { x: stub.x, y: adjacent.y }
          const points = fromEnd
            ? [route[0], stub, bend, ...route.slice(1)]
            : [...route.slice(0, -1), bend, stub, route.at(-1)!]
          if (points.some((point) => point.x < 0 || point.y < 0
            || point.x > scene.width || point.y > scene.height)) continue
          const updated = { ...arrow, points: points.slice(1, -1) }
          const candidate = { ...best, elements: best.elements.map((item) =>
            item.id === arrow.id ? updated : item) }
          const metrics = assessCanvasVisualQuality(candidate).metrics
          if (geometricalKeys.some((key) => metrics[key] > quality[key])) continue
          const candidateRoute = assessArchitectureRouteDiagnostics(candidate)
          if (candidateRoute.terminalNormalViolations >= diagnostics.terminalNormalViolations
            || candidateRoute.nonOrthogonalSegments > diagnostics.nonOrthogonalSegments
            || candidateRoute.unrelatedFrameIntrusionLength > diagnostics.unrelatedFrameIntrusionLength
            || candidateRoute.frameOverlaps > diagnostics.frameOverlaps
            || candidateRoute.ingressPortConflicts > diagnostics.ingressPortConflicts
            || candidateRoute.totalRouteLength > initial.totalRouteLength * 1.01
            || canvasSharedSourceStemsSignature(candidate) !== preservedTrunks) continue
          nextBest = { scene: candidate, metrics, route: candidateRoute }
          // First accepted corridor is enough. We are reducing incorrect
          // physical terminal tangents, not globally reoptimizing edge cost.
          break
        }
      }
      if (nextBest) {
        best = nextBest.scene
        quality = nextBest.metrics
        diagnostics = nextBest.route
        changes++
      }
    }
    if (!changes) break
  }
  return best
}

function canvasSharedSourceStemsSignature(scene: CanvasScene): string {
  return JSON.stringify(canvasBundleTrunks(scene).map((trunk) => [trunk.id, trunk.path]).sort((a, b) =>
    String(a[0]).localeCompare(String(b[0]), 'en')))
}

/** Repair sub-pixel/short diagonal terminal stubs from imported orthogonal
 * routes. This changes waypoints only, never the original ports or topology.
 * A complete scene quality veto protects unrelated relationships.
 */
export function straightenArchitectureTerminalRoutes(scene: CanvasScene): CanvasScene {
  if (!scene.architecture) return scene
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  let changed = 0
  const elements = scene.elements.map((arrow) => {
    if (arrow.type !== 'arrow' || arrow.routing !== 'orthogonal'
      || arrow.freehand || arrow.bundleKey || !arrow.points?.length) return arrow
    const from = nodes.get(arrow.from), to = nodes.get(arrow.to)
    if (!from || !to) return arrow
    const route = canvasArrowBoxRoute(from, to, arrow)
    if (route.length < 4) return arrow
    const points = route.slice(1, -1).map((point) => ({ ...point }))
    let edited = false
    const align = (
      anchor: CanvasArrow['fromAnchor'], endpoint: { x: number; y: number },
      point: { x: number; y: number },
    ) => {
      if (!anchor || anchor === 'auto') return
      const axis = anchor === 'left' || anchor === 'right' ? 'y' : 'x'
      const deviation = Math.abs(point[axis] - endpoint[axis])
      // A major bend is authored geometry, not floating point jitter. Leave
      // it untouched rather than changing an intentional user-selected path.
      if (deviation > 16 || deviation < .00001) return
      point[axis] = endpoint[axis]
      edited = true
    }
    align(arrow.fromAnchor, route[0], points[0])
    align(arrow.toAnchor, route.at(-1)!, points.at(-1)!)
    if (!edited) return arrow
    const revised = { ...arrow, points }
    const corrected = canvasArrowBoxRoute(from, to, revised)
    if (corrected.slice(1).some((point, index) =>
      Math.abs(point.x - corrected[index].x) > .001
      && Math.abs(point.y - corrected[index].y) > .001)) return arrow
    changed++
    return revised
  })
  if (!changed) return scene
  const proposed = { ...scene, elements }
  const before = assessCanvasVisualQuality(scene).metrics
  const after = assessCanvasVisualQuality(proposed).metrics
  const routeBefore = assessArchitectureRouteDiagnostics(scene)
  const routeAfter = assessArchitectureRouteDiagnostics(proposed)
  const checks = [
    'nodeOverlaps', 'edgeCrossings', 'edgeOverlaps', 'edgeNodeIntersections',
    'labelOverlaps', 'labelNodeIntersections', 'labelOverflows',
  ] as const
  if (checks.some((key) => after[key] > before[key])
    || routeAfter.terminalNormalViolations >= routeBefore.terminalNormalViolations
    || routeAfter.nonOrthogonalSegments >= routeBefore.nonOrthogonalSegments
    || routeAfter.unrelatedFrameIntrusionLength > routeBefore.unrelatedFrameIntrusionLength
    || routeAfter.totalRouteLength > routeBefore.totalRouteLength * 1.01) return scene
  return proposed
}

/**
 * Shift one interior orthogonal corridor; keep endpoint anchors and all nodes
 * fixed. This resolves collinear overlaps that the bounded orthogonal router can
 * repeat, without introducing a second layout engine.
 */
export function nudgeArchitectureCorridors(scene: CanvasScene, arrowId: string): CanvasScene[] {
  const arrows = scene.elements.filter((item) => item.type === 'arrow')
  const arrow = arrows.find((item) => item.id === arrowId)
  if (!arrow || arrow.bundleKey) return []
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const from = boxes.get(arrow.from)
  const to = boxes.get(arrow.to)
  if (!from || !to) return []
  const route = canvasArrowBoxRoute(from, to, arrow)
  const candidates: CanvasScene[] = []
  const localShortRoute = from.groupId && from.groupId === to.groupId && route.length <= 5
  const offsets = localShortRoute
    ? [-96, 96, -48, -32, -20, -12, 12, 20, 32, 48]
    : [-48, -32, -20, -12, 12, 20, 32, 48]
  // For a segment to slide, the segments immediately before and after must
  // be perpendicular; endpoints stay anchored to their original nodes.
  for (let index = 1; index < route.length - 2 && candidates.length < 16; index += 1) {
    const a = route[index], b = route[index + 1]
    const vertical = a.x === b.x && a.y !== b.y
    const horizontal = a.y === b.y && a.x !== b.x
    if (!vertical && !horizontal) continue
    const previous = route[index - 1], next = route[index + 2]
    if (vertical && (previous.y !== a.y || next.y !== b.y)) continue
    if (horizontal && (previous.x !== a.x || next.x !== b.x)) continue
    for (const offset of offsets) {
      const displaced = route.map((point) => ({ ...point }))
      if (vertical) {
        displaced[index].x += offset
        displaced[index + 1].x += offset
      } else {
        displaced[index].y += offset
        displaced[index + 1].y += offset
      }
      if (displaced.some((point) => point.x < 0 || point.x > scene.width || point.y < 0 || point.y > scene.height)) continue
      const revised = { ...arrow, points: displaced.slice(1, -1) }
      candidates.push({
        ...scene,
        elements: scene.elements.map((item) => item.id === arrowId ? revised : item),
      })
      if (candidates.length >= 16) break
    }
  }
  return candidates
}

/** A three-segment route has no movable interior corridor. Detour around the
 * actual blocking node while retaining the authored edge's port directions. */
export function bypassArchitectureBlockingNode(scene: CanvasScene, arrowId: string, blockerId: string): CanvasScene[] {
  const arrow = scene.elements.find((item) => item.type === 'arrow' && item.id === arrowId)
  if (!arrow || arrow.type !== 'arrow') return []
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const from = arrow && nodes.get(arrow.from)
  const to = arrow && nodes.get(arrow.to)
  const blocker = nodes.get(blockerId)
  if (!arrow || !from || !to || !blocker || arrow.bundleKey) return []
  const route = canvasArrowBoxRoute(from, to, arrow)
  if (route.length !== 3) return []
  const [start, , end] = route
  const horizontalFirst = arrow.fromAnchor === 'right' || arrow.fromAnchor === 'left'
  const verticalFirst = arrow.fromAnchor === 'top' || arrow.fromAnchor === 'bottom'
  const horizontalLast = arrow.toAnchor === 'right' || arrow.toAnchor === 'left'
  const verticalLast = arrow.toAnchor === 'top' || arrow.toAnchor === 'bottom'
  if (!((horizontalFirst && verticalLast) || (verticalFirst && horizontalLast))) return []
  const portOffset = (side: string | undefined) => side === 'top' || side === 'left' ? -32 : 32
  const axis = horizontalFirst
    ? [blocker.x - 8, blocker.x - 16, blocker.x - 24,
      blocker.x + blocker.width + 8, blocker.x + blocker.width + 12, blocker.x + blocker.width + 16,
      blocker.x + blocker.width + 24]
    : [blocker.y - 8, blocker.y - 16, blocker.y - 24,
      blocker.y + blocker.height + 8, blocker.y + blocker.height + 12, blocker.y + blocker.height + 16,
      blocker.y + blocker.height + 24]
  const candidates: CanvasScene[] = []
  for (const corridor of axis) {
    const points = horizontalFirst
      ? [start, { x: corridor, y: start.y }, { x: corridor, y: end.y + portOffset(arrow.toAnchor) },
        { x: end.x, y: end.y + portOffset(arrow.toAnchor) }, end]
      : [start, { x: start.x, y: corridor }, { x: end.x + portOffset(arrow.toAnchor), y: corridor },
        { x: end.x + portOffset(arrow.toAnchor), y: end.y }, end]
    // Disallow reversing either endpoint's port normal, and never leave the canvas.
    const firstLeg = horizontalFirst ? points[1].x - start.x : points[1].y - start.y
    const lastLeg = horizontalFirst ? end.y - points[3].y : end.x - points[3].x
    const fromPositive = arrow.fromAnchor === 'right' || arrow.fromAnchor === 'bottom'
    const toPositive = arrow.toAnchor === 'left' || arrow.toAnchor === 'top'
    if ((fromPositive ? firstLeg <= 0 : firstLeg >= 0)
      || (toPositive ? lastLeg <= 0 : lastLeg >= 0)) continue
    if (points.some((p) => p.x < 0 || p.y < 0 || p.x > scene.width || p.y > scene.height)) continue
    candidates.push({
      ...scene,
      elements: scene.elements.map((item) => item.id === arrowId ? { ...arrow, points: points.slice(1, -1) } : item),
    })
  }
  return candidates
}


/** Move a vertical fan-out branch sideways after its real shared source stem.
 * Keep both endpoint normals, IDs and bundle membership unchanged. */
export function nudgeSharedSourceBranch(scene: CanvasScene, id: string): CanvasScene[] {
  const arrow = scene.elements.find((item) => item.id === id)
  if (arrow?.type !== 'arrow' || !arrow.bundleKey?.startsWith('from:')
    || arrow.fromAnchor !== 'bottom' || arrow.toAnchor !== 'top') return []
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const source = boxes.get(arrow.from), target = boxes.get(arrow.to)
  if (!source || !target) return []
  const original = canvasArrowBoxRoute(source, target, arrow)
  const start = original[0], end = original.at(-1)!
  if (end.y - start.y < 100 || Math.abs(end.x - start.x) > source.width / 2) return []
  const siblings = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow' && item.id !== id
    && item.from === arrow.from && item.bundleKey === arrow.bundleKey)
    .flatMap((item) => {
      const to = boxes.get(item.to)
      return to ? [canvasArrowBoxRoute(source, to, item)] : []
    })
  if (!siblings.length) return []
  const candidates: CanvasScene[] = []
  for (const side of [12, -12, 24, -24]) {
    const x = start.x + side
    for (const first of [48, 64, 72]) {
      const firstY = start.y + first
      for (const last of [32, 44]) {
        const lastY = end.y - last
        if (firstY + 12 > lastY || x < 0 || x > scene.width) continue
        const route = [start, { x: start.x, y: firstY }, { x, y: firstY },
          { x, y: lastY }, { x: end.x, y: lastY }, end]
        if (siblings.some((sibling) => !canvasSharedSourceStem(sibling, route))) continue
        candidates.push({ ...scene, elements: scene.elements.map((item) => item.id === id
          ? { ...arrow, points: route.slice(1, -1) } : item) })
      }
    }
  }
  return candidates
}
