import { reservedPorts, availablePortRatios, portSpacingPenalty, type FixedSide, type PortReservations } from './architecturePortPlanning.js'
import {
  addOccupiedSegments, expandRect, findOrthogonalRoute, scoreRoute,
  segmentIntersectsRect, segmentsCross, simplifyRoute, uniqueNumbers,
  type RouteRect, type RouteSegment, type RouteCorridorHints,
} from './architectureOrthogonalSolver.js'
/** Pure architecture relation routing and corridor constraints.
 * Reads Canvas geometry, returns updated Canvas arrows; does not infer roles,
 * move nodes, style cards, or import third-party layout engines.
 */
import type { CanvasArrow, CanvasGroup, CanvasGroupFrame, CanvasNode, CanvasNote, CanvasPoint, CanvasScene } from './canvas.js'
import { anchorPoint, canvasArrowBoxRoute, canvasBundleTrunks, canvasGroupFrames, canvasSharedSourceStem } from './canvas.js'

export function routeArchitectureEdges(scene: CanvasScene, visibilityFallback = false): CanvasScene {
  return routeArchitectureEdgeSubset(scene, undefined, false, visibilityFallback)
}

export function routeArchitectureArrowIds(
  scene: CanvasScene, arrowIds: Iterable<string>, nodePorts = false, visibilityFallback = false,
): CanvasScene {
  const only = new Set(arrowIds)
  if (!only.size) return scene
  const arrowCount = scene.elements.filter((item) => item.type === 'arrow').length
  if (only.size > Math.max(48, arrowCount * 0.45)) return routeArchitectureEdgeSubset(scene, undefined, false, visibilityFallback)
  return routeArchitectureEdgeSubset(scene, only, nodePorts, visibilityFallback)
}

/** Restore one real pre-move shared source trunk after an incremental node
 * reordering. This proposes geometry only; Composer evaluates the complete
 * scene before accepting it. Never invent a bus for unrelated relationships.
 */
export function restoreArchitectureMovedSourceTrunk(
  candidate: CanvasScene,
  reference: CanvasScene,
  movedNodeIds: ReadonlySet<string>,
): CanvasScene | undefined {
  const verifiedTrunks = new Set(canvasBundleTrunks(reference)
    .filter((trunk) => trunk.id.startsWith('from:')).map((trunk) => trunk.id))
  if (!verifiedTrunks.size) return undefined
  const oldArrows = reference.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const arrows = candidate.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const boxes = new Map(candidate.elements.filter((item): item is CanvasNode | CanvasNote =>
    item.type !== 'arrow').map((item) => [item.id, item]))
  const frames = new Map(canvasGroupFrames(candidate).map((frame) => [frame.id, frame]))
  const groups = new Map((candidate.groups ?? []).map((group) => [group.id, group]))
  for (const old of oldArrows) {
    if (!movedNodeIds.has(old.to) || movedNodeIds.has(old.from)
      || !old.bundleKey || !verifiedTrunks.has(old.bundleKey)) continue
    const updated = arrows.find((item) => item.id === old.id)
    const source = boxes.get(old.from), target = boxes.get(old.to)
    if (!updated || !source || !target || source.rotation || target.rotation
      || !old.toAnchor || old.toAnchor === 'auto' || old.toPortRatio !== undefined) continue
    const mate = arrows.find((item) => item.id !== old.id
      && item.from === old.from && item.bundleKey === old.bundleKey)
    if (!mate || !mate.fromAnchor || mate.fromAnchor === 'auto') continue
    const mateRoute = currentArrowRoute(mate, boxes)
    if (!mateRoute || mateRoute.length < 3) continue
    const [start, stem] = mateRoute
    if (start.x !== stem.x && start.y !== stem.y) continue
    const newTarget = fixedAnchorPoint(target, old.toAnchor)
    const obstacles = [
      ...[...boxes.values()].filter((item) => item.id !== source.id && item.id !== target.id)
        .map((item) => expandRect(item, 18)),
      ...routingGroupObstacles(source, target, frames, groups),
    ]
    const occupied: RouteSegment[] = []
    for (const other of arrows) {
      if (other.id === updated.id) continue
      const route = currentArrowRoute(other, boxes)
      if (route) addOccupiedSegments(route, occupied, other.bundleKey)
    }
    const direction: FixedSide = stem.x > start.x ? 'right' : stem.x < start.x ? 'left'
      : stem.y > start.y ? 'bottom' : 'top'
    const continuation = findOrthogonalRoute(stem, newTarget, obstacles, occupied,
      old.bundleKey, direction, old.toAnchor)
    const path = simplifyRoute([start, stem, ...continuation.slice(1)])
    // Preserving the original source stem may still be inferior to removing
    // the bundle. Never decide that locally: the caller assesses whole-scene
    // collisions, pair overlaps, fit, and readable route length.
    const restored: CanvasArrow = {
      ...updated, routing: 'orthogonal', fromAnchor: mate.fromAnchor,
      toAnchor: old.toAnchor, fromPortRatio: mate.fromPortRatio,
      toPortRatio: undefined, bundleKey: mate.bundleKey,
      points: path.slice(1, -1),
    }
    return { ...candidate, elements: candidate.elements.map((item) =>
      item.id === restored.id ? restored : item) }
  }
  return undefined
}

export function routeArchitectureEdgesIncremental(scene: CanvasScene, changedNodeIds: Iterable<string>): CanvasScene {
  const changed = new Set(changedNodeIds)
  if (!changed.size) return scene
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const changedRects = [...changed].flatMap((id) => {
    const box = boxes.get(id)
    return box ? [expandRect(box, 22)] : []
  })
  const affected = new Set<string>()

  for (const arrow of arrows) {
    if (changed.has(arrow.from) || changed.has(arrow.to)) {
      affected.add(arrow.id)
      continue
    }
    if (!changedRects.length) continue
    const route = currentArrowRoute(arrow, boxes)
    if (route && route.slice(0, -1).some((point, index) => {
      const segment = { a: point, b: route[index + 1] }
      return changedRects.some((rect) => segmentIntersectsRect(segment, rect))
    })) affected.add(arrow.id)
  }

  if (!affected.size) return scene
  // When a structural move invalidates a large fraction of the relationship
  // graph, a full pass is both simpler and more stable than many local passes.
  if (affected.size > Math.max(48, arrows.length * 0.45)) return routeArchitectureEdgeSubset(scene)
  return routeArchitectureEdgeSubset(scene, affected)
}

function routeArchitectureEdgeSubset(
  scene: CanvasScene, only?: Set<string>, nodePorts = false, visibilityFallback = false,
): CanvasScene {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const groupFrames = new Map(canvasGroupFrames(scene).map((frame) => [frame.id, frame]))
  const groups = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const routed = new Map<string, CanvasArrow>()
  const occupied: RouteSegment[] = []
  const fanout = countArrowEndpoints(arrows, 'from')
  const fanin = countArrowEndpoints(arrows, 'to')
  // The escape hatch is a single-edge geometry repair, not a second global
  // router. Multi-edge rerouting keeps the established center-port behavior.
  const portReservations = nodePorts && only?.size === 1 ? reservedPorts(arrows, only) : undefined
  const highDensityRouting = arrows.length >= 48 || boxes.size >= 36
  const groupedFanoutIds = only ? new Set<string>() : collectDownwardGroupFanoutArrowIds(arrows, boxes)
  const crossGroupBundleIds = only ? new Set<string>() : collectCrossGroupBundleArrowIds(arrows, boxes, groupedFanoutIds)

  if (only) {
    for (const arrow of arrows) {
      if (only.has(arrow.id)) continue
      const route = currentArrowRoute(arrow, boxes)
      if (route) addOccupiedSegments(route, occupied, arrow.bundleKey)
    }
  }

  const routeOrder = arrows
    .filter((arrow) => (!only || only.has(arrow.id)) && !groupedFanoutIds.has(arrow.id) && !crossGroupBundleIds.has(arrow.id))
    .slice()
    .sort((left, right) => architectureArrowRoutingPriority(left) - architectureArrowRoutingPriority(right))

  const localRouteOrder = only || !highDensityRouting ? [] : routeOrder.filter((arrow) => isIntraGroupArrow(arrow, boxes))
  const remainingRouteOrder = only || !highDensityRouting ? routeOrder : routeOrder.filter((arrow) => !isIntraGroupArrow(arrow, boxes))

  for (const arrow of localRouteOrder) {
    const result = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups, nodePorts, portReservations, visibilityFallback)
    if (result) routed.set(arrow.id, result)
  }

  if (!only && crossGroupBundleIds.size) {
    const bundled = routeCrossGroupBundles(
      arrows.filter((arrow) => crossGroupBundleIds.has(arrow.id)),
      boxes,
      occupied,
      groupFrames,
      groups,
      highDensityRouting,
    )
    for (const [id, arrow] of bundled) routed.set(id, arrow)
    for (const arrow of arrows) {
      if (!crossGroupBundleIds.has(arrow.id) || routed.has(arrow.id)) continue
      const fallback = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups, nodePorts, portReservations, visibilityFallback)
      if (fallback) routed.set(arrow.id, fallback)
    }
  }

  for (const arrow of remainingRouteOrder) {
    const result = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups, nodePorts, portReservations, visibilityFallback)
    if (result) routed.set(arrow.id, result)
  }

  if (!only && groupedFanoutIds.size) {
    const bundled = routeDownwardGroupFanouts(arrows.filter((arrow) => groupedFanoutIds.has(arrow.id)), boxes, occupied)
    for (const [id, arrow] of bundled) routed.set(id, arrow)
    for (const arrow of arrows) {
      if (!groupedFanoutIds.has(arrow.id) || routed.has(arrow.id)) continue
      const fallback = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups, nodePorts, portReservations, visibilityFallback)
      if (fallback) routed.set(arrow.id, fallback)
    }
  }

  return {
    ...scene,
    elements: scene.elements.map((item) => item.type === 'arrow' ? routed.get(item.id) ?? item : item),
  }
}

function isIntraGroupArrow(arrow: CanvasArrow, boxes: Map<string, CanvasNode | CanvasNote>): boolean {
  const from = boxes.get(arrow.from)
  const to = boxes.get(arrow.to)
  return Boolean(from?.groupId && from.groupId === to?.groupId)
}

function routeArchitectureArrow(
  arrow: CanvasArrow,
  boxes: Map<string, CanvasNode | CanvasNote>,
  occupied: RouteSegment[],
  fanout: Map<string, number>,
  fanin: Map<string, number>,
  groupFrames: Map<string, CanvasGroupFrame>,
  groups: Map<string, CanvasGroup>,
  nodePorts = false,
  portReservations?: PortReservations,
  visibilityFallback = false,
): CanvasArrow | undefined {
  const from = boxes.get(arrow.from)
  const to = boxes.get(arrow.to)
  if (!from || !to) return undefined
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const dx = toCenter.x - fromCenter.x
  const dy = toCenter.y - fromCenter.y
  const asyncEdge = from.icon === 'queue' || to.icon === 'queue'
    || from.stencil === 'kafka' || to.stencil === 'kafka'
    || from.stencil === 'rabbitmq' || to.stencil === 'rabbitmq'
  const nodeObstacles = [...boxes.values()]
    .filter((item) => item.id !== from.id && item.id !== to.id)
    .map((item) => expandRect(item, 18))
  const bundleKey = architectureArrowBundleKey(from, to, fanout, fanin)
  const groupObstacles = routingGroupObstacles(from, to, groupFrames, groups)
  const obstacles = [...nodeObstacles, ...groupObstacles]
  const fromFrame = from.groupId ? groupFrames.get(from.groupId) : undefined
  const toFrame = to.groupId ? groupFrames.get(to.groupId) : undefined
  const routingDx = fromFrame && toFrame && !nodePorts ? (toFrame.x + toFrame.width / 2) - (fromFrame.x + fromFrame.width / 2) : dx
  const routingDy = fromFrame && toFrame && !nodePorts ? (toFrame.y + toFrame.height / 2) - (fromFrame.y + fromFrame.height / 2) : dy
  const pairs = preferredAnchorPairs(routingDx, routingDy)
  let best: { score: number; fromAnchor: FixedSide; toAnchor: FixedSide; fromPortRatio?: number; toPortRatio?: number; route: CanvasPoint[] } | undefined
  for (const [fromAnchor, toAnchor] of pairs) {
    const independentPortRepair = !bundleKey && !arrow.bundleKey && portReservations
    const fromRatios = independentPortRepair
      ? availablePortRatios(from, fromAnchor, portReservations) : [0.5]
    const toRatios = independentPortRepair
      ? availablePortRatios(to, toAnchor, portReservations) : [0.5]
    for (const fromRatio of fromRatios) {
      for (const toRatio of toRatios) {
        const start = fromRatio === 0.5 ? fixedAnchorPoint(from, fromAnchor)
          : anchorPoint(from, fromAnchor, toCenter, fromRatio)
        const end = toRatio === 0.5 ? fixedAnchorPoint(to, toAnchor)
          : anchorPoint(to, toAnchor, fromCenter, toRatio)
        const route = findOrthogonalRoute(start, end, obstacles, occupied, bundleKey, fromAnchor, toAnchor, undefined, visibilityFallback)
        const score = scoreRoute(route, obstacles, occupied, bundleKey)
          + (fromAnchor === pairs[0][0] && toAnchor === pairs[0][1] ? 0 : 42)
          + (independentPortRepair ? portSpacingPenalty(from, fromAnchor, fromRatio, portReservations)
            + portSpacingPenalty(to, toAnchor, toRatio, portReservations) : 0)
        if (!best || score < best.score) best = {
          score, fromAnchor, toAnchor, fromPortRatio: fromRatio === 0.5 ? undefined : fromRatio,
          toPortRatio: toRatio === 0.5 ? undefined : toRatio, route,
        }
      }
    }
    if (bundleKey?.startsWith('from:') || bundleKey?.startsWith('to:')) {
      const start = fixedAnchorPoint(from, fromAnchor)
      const end = fixedAnchorPoint(to, toAnchor)
      const side = bundleKey.startsWith('from:') ? 'from' : 'to'
      const bundled = buildBundleRoute(start, end, fromAnchor, toAnchor, side)
      const bundleScore = scoreRoute(bundled, obstacles, occupied, bundleKey) - 72
        + (fromAnchor === pairs[0][0] && toAnchor === pairs[0][1] ? 0 : 42)
      if (!best || bundleScore < best.score) best = { score: bundleScore, fromAnchor, toAnchor, route: bundled }
    }
  }
  if (!best) return undefined
  // Generated semantic regions are visual groupings, not impenetrable walls.
  // A route that detours around the whole canvas is worse than crossing one
  // otherwise empty auto-generated region. Explicit authored/C4 boundaries
  // remain hard obstacles and are never relaxed here.
  const autoRegionsOnly = groups.size > 0 && [...groups.keys()].every((id) => id.startsWith('arch-'))
  const lengthOf = (points: CanvasPoint[]) => points.slice(1).reduce((total, point, index) =>
    total + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0)
  const directDistance = Math.abs(dx) + Math.abs(dy)
  if (autoRegionsOnly && groupObstacles.length && lengthOf(best.route) > Math.max(260, directDistance * 2.1)) {
    const originalLength = lengthOf(best.route)
    let shorter: typeof best | undefined
    for (const [fromAnchor, toAnchor] of pairs) {
      const start = fixedAnchorPoint(from, fromAnchor)
      const end = fixedAnchorPoint(to, toAnchor)
      const route = findOrthogonalRoute(start, end, nodeObstacles, occupied, bundleKey, fromAnchor, toAnchor, undefined, visibilityFallback)
      if (countRouteObstacleCollisions(route, nodeObstacles) > 0) continue
      const boundaries = countRouteObstacleCollisions(route, groupObstacles)
      if (boundaries > 1 || lengthOf(route) >= originalLength * .72) continue
      const score = scoreRoute(route, nodeObstacles, occupied, bundleKey) + boundaries * 180
      if (!shorter || score < shorter.score) shorter = { score, route, fromAnchor, toAnchor }
    }
    if (shorter) best = shorter
  }
  const simplified = simplifyRoute(best.route)
  addOccupiedSegments(simplified, occupied, bundleKey)
  return {
    ...arrow,
    routing: 'orthogonal',
    fromAnchor: best.fromAnchor,
    toAnchor: best.toAnchor,
    fromPortRatio: best.fromPortRatio,
    toPortRatio: best.toPortRatio,
    lineStyle: asyncEdge ? 'dashed' : arrow.lineStyle ?? 'solid',
    points: simplified.length > 2 ? simplified.slice(1, -1) : undefined,
    bundleKey,
  }
}

function architectureArrowBundleKey(
  from: CanvasNode | CanvasNote,
  to: CanvasNode | CanvasNote,
  fanout: Map<string, number>,
  fanin: Map<string, number>,
): string | undefined {
  const fromCount = fanout.get(from.id) ?? 0
  const toCount = fanin.get(to.id) ?? 0
  const sameGroup = Boolean(from.groupId && to.groupId && from.groupId === to.groupId)
  const groupedRelationship = Boolean(from.groupId || to.groupId)
  const distance = Math.abs((to.x + to.width / 2) - (from.x + from.width / 2))
    + Math.abs((to.y + to.height / 2) - (from.y + from.height / 2))

  if (sameGroup) {
    if (fromCount >= 2 && (from.icon === 'queue' || from.stencil === 'kafka' || from.stencil === 'rabbitmq')) return `from:${from.id}`
    return undefined
  }
  // Group-aware fan-outs are handled by the dedicated shared-bus routers.
  // If those cannot find a safe bus (for example a multi-row target group),
  // fall back to independent shortest routes instead of forcing a generic
  // trunk that can send local relationships around the outside of a boundary.
  if (groupedRelationship) return undefined
  if (fromCount >= 2 && distance >= 280) return `from:${from.id}`
  if (toCount >= 2 && distance >= 280) return `to:${to.id}`
  return undefined
}

function collectDownwardGroupFanoutArrowIds(
  arrows: CanvasArrow[],
  boxes: Map<string, CanvasNode | CanvasNote>,
): Set<string> {
  const grouped = new Map<string, CanvasArrow[]>()
  for (const arrow of arrows) {
    const source = boxes.get(arrow.from)
    const target = boxes.get(arrow.to)
    if (!source || !target?.groupId || target.y <= source.y + source.height) continue
    const key = `${arrow.from}\u0000${target.groupId}`
    grouped.set(key, [...(grouped.get(key) ?? []), arrow])
  }
  const result = new Set<string>()
  for (const members of grouped.values()) {
    if (members.length < 3) continue
    members.forEach((arrow) => result.add(arrow.id))
  }
  return result
}

function collectCrossGroupBundleArrowIds(
  arrows: CanvasArrow[],
  boxes: Map<string, CanvasNode | CanvasNote>,
  excluded: Set<string>,
): Set<string> {
  const grouped = new Map<string, CanvasArrow[]>()
  for (const arrow of arrows) {
    if (excluded.has(arrow.id)) continue
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to) continue
    const key = crossGroupPairKey(from, to)
    if (!key) continue
    grouped.set(key, [...(grouped.get(key) ?? []), arrow])
  }
  const result = new Set<string>()
  for (const members of grouped.values()) {
    if (members.length < 3) continue
    members.forEach((arrow) => result.add(arrow.id))
  }
  return result
}

function routeCrossGroupBundles(
  arrows: CanvasArrow[],
  boxes: Map<string, CanvasNode | CanvasNote>,
  occupied: RouteSegment[],
  groupFrames: Map<string, CanvasGroupFrame>,
  groups: Map<string, CanvasGroup>,
  preferAlignedBundles: boolean,
): Map<string, CanvasArrow> {
  const grouped = new Map<string, CanvasArrow[]>()
  for (const arrow of arrows) {
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to) continue
    const key = crossGroupPairKey(from, to)
    if (!key) continue
    grouped.set(key, [...(grouped.get(key) ?? []), arrow])
  }

  const result = new Map<string, CanvasArrow>()
  const orderedGroups = [...grouped.entries()].sort((left, right) => {
    const leftPriority = Math.min(...left[1].map(architectureArrowRoutingPriority))
    const rightPriority = Math.min(...right[1].map(architectureArrowRoutingPriority))
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    if (!preferAlignedBundles) return right[1].length - left[1].length
    const leftGeometry = crossGroupBundleGeometryRank(left[1], boxes, groupFrames)
    const rightGeometry = crossGroupBundleGeometryRank(right[1], boxes, groupFrames)
    return leftGeometry.alignment - rightGeometry.alignment
      || leftGeometry.distance - rightGeometry.distance
      || right[1].length - left[1].length
  })

  for (const [pairKey, members] of orderedGroups) {
    if (members.length < 3) continue
    const source = boxes.get(members[0].from)
    const target = boxes.get(members[0].to)
    if (!source?.groupId || !target?.groupId) continue
    const sourceFrame = groupFrames.get(source.groupId)
    const targetFrame = groupFrames.get(target.groupId)
    if (!sourceFrame || !targetFrame) continue
    const trunk = chooseCrossGroupTrunk(sourceFrame, targetFrame, boxes, occupied, groupFrames, groups)
    if (!trunk) continue

    const bundleKey = `group:${pairKey}`
    for (const arrow of members.slice().sort((left, right) => architectureArrowRoutingPriority(left) - architectureArrowRoutingPriority(right))) {
      const from = boxes.get(arrow.from)
      const to = boxes.get(arrow.to)
      if (!from || !to) continue
      const start = fixedAnchorPoint(from, trunk.fromAnchor)
      const end = fixedAnchorPoint(to, trunk.toAnchor)
      const sourcePort = trunk.sourcePort
      const targetPort = trunk.targetPort
      const obstacles = [
        ...[...boxes.values()].filter((item) => item.id !== from.id && item.id !== to.id).map((item) => expandRect(item, 10)),
        ...routingGroupObstacles(from, to, groupFrames, groups),
      ]
      const sourceRoute = findOrthogonalRoute(
        start,
        sourcePort,
        obstacles,
        occupied,
        bundleKey,
        trunk.fromAnchor,
        trunk.sourcePortApproach,
        trunk.hints,
      )
      const targetRoute = findOrthogonalRoute(
        targetPort,
        end,
        obstacles,
        occupied,
        bundleKey,
        trunk.targetPortLeave,
        trunk.toAnchor,
        trunk.hints,
      )
      const route = simplifyRoute([
        ...sourceRoute.slice(0, -1),
        sourcePort,
        targetPort,
        ...targetRoute.slice(1),
      ])
      if (countRouteObstacleCollisions(route, obstacles) > 0) continue
      const asyncEdge = from.icon === 'queue' || to.icon === 'queue'
        || from.stencil === 'kafka' || to.stencil === 'kafka'
        || from.stencil === 'rabbitmq' || to.stencil === 'rabbitmq'
      const routedArrow: CanvasArrow = {
        ...arrow,
        routing: 'orthogonal',
        fromAnchor: trunk.fromAnchor,
        toAnchor: trunk.toAnchor,
        fromPortRatio: undefined,
        toPortRatio: undefined,
        lineStyle: asyncEdge ? 'dashed' : arrow.lineStyle ?? 'solid',
        points: route.length > 2 ? route.slice(1, -1) : undefined,
        bundleKey,
      }
      result.set(arrow.id, routedArrow)
      addOccupiedSegments(route, occupied, bundleKey)
    }
  }
  return result
}

function crossGroupBundleGeometryRank(
  members: CanvasArrow[],
  boxes: Map<string, CanvasNode | CanvasNote>,
  groupFrames: Map<string, CanvasGroupFrame>,
): { alignment: number; distance: number } {
  const from = boxes.get(members[0]?.from ?? '')
  const to = boxes.get(members[0]?.to ?? '')
  const source = from?.groupId ? groupFrames.get(from.groupId) : undefined
  const target = to?.groupId ? groupFrames.get(to.groupId) : undefined
  if (!source || !target) return { alignment: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY }
  const dx = Math.abs((target.x + target.width / 2) - (source.x + source.width / 2))
  const dy = Math.abs((target.y + target.height / 2) - (source.y + source.height / 2))
  const major = Math.max(dx, dy, 1)
  return {
    alignment: Math.min(dx, dy) / major,
    distance: dx + dy,
  }
}

function chooseCrossGroupTrunk(
  source: CanvasGroupFrame,
  target: CanvasGroupFrame,
  boxes: Map<string, CanvasNode | CanvasNote>,
  occupied: RouteSegment[],
  groupFrames: Map<string, CanvasGroupFrame>,
  groups: Map<string, CanvasGroup>,
): {
  fromAnchor: 'top' | 'right' | 'bottom' | 'left'
  toAnchor: 'top' | 'right' | 'bottom' | 'left'
  sourcePortApproach: 'top' | 'right' | 'bottom' | 'left'
  targetPortLeave: 'top' | 'right' | 'bottom' | 'left'
  sourcePort: CanvasPoint
  targetPort: CanvasPoint
  hints: RouteCorridorHints
} | undefined {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  const horizontalGap = Math.max(0, target.x - (source.x + source.width), source.x - (target.x + target.width))
  const verticalGap = Math.max(0, target.y - (source.y + source.height), source.y - (target.y + target.height))
  const horizontal = horizontalGap > verticalGap || horizontalGap === verticalGap && Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)
  const unrelatedFrames = [...groupFrames.values()].filter((frame) => (
    frame.id !== source.id
    && frame.id !== target.id
    && !groupContainsGroup(frame.id, source.id, groups)
    && !groupContainsGroup(source.id, frame.id, groups)
    && !groupContainsGroup(frame.id, target.id, groups)
    && !groupContainsGroup(target.id, frame.id, groups)
    && groups.get(frame.id)?.c4Type !== 'software-system'
  ))
  const unrelatedNodes = [...boxes.values()].filter((item) => item.groupId !== source.id && item.groupId !== target.id)
  const obstacles = [
    ...unrelatedFrames.map((frame) => expandRect(frame, 10)),
    ...unrelatedNodes.map((item) => expandRect(item, 8)),
  ]

  if (horizontal) {
    const forward = targetCenter.x >= sourceCenter.x
    const sourceX = forward ? source.x + source.width + 22 : source.x - 22
    const targetX = forward ? target.x - 22 : target.x + target.width + 22
    const midpoint = (sourceCenter.y + targetCenter.y) / 2
    const candidates = uniqueNumbers([
      midpoint,
      source.y - 22,
      source.y + source.height + 22,
      target.y - 22,
      target.y + target.height + 22,
      ...obstacles.flatMap((item) => [item.y - 18, item.y + item.height + 18]),
    ]).sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint)).slice(0, 18)
    let best: { score: number; y: number } | undefined
    for (const y of candidates) {
      const route = [{ x: sourceX, y }, { x: targetX, y }]
      if (countRouteObstacleCollisions(route, obstacles) > 0) continue
      const score = Math.abs(y - midpoint) + countRouteCrossings(route, occupied) * 1800
      if (!best || score < best.score) best = { score, y }
    }
    if (!best) return undefined
    return {
      fromAnchor: forward ? 'right' : 'left',
      toAnchor: forward ? 'left' : 'right',
      sourcePortApproach: forward ? 'left' : 'right',
      targetPortLeave: forward ? 'right' : 'left',
      sourcePort: { x: sourceX, y: best.y },
      targetPort: { x: targetX, y: best.y },
      hints: { x: [sourceX, targetX], y: [best.y] },
    }
  }

  const forward = targetCenter.y >= sourceCenter.y
  const sourceY = forward ? source.y + source.height + 22 : source.y - 22
  const targetY = forward ? target.y - 22 : target.y + target.height + 22
  const midpoint = (sourceCenter.x + targetCenter.x) / 2
  const candidates = uniqueNumbers([
    midpoint,
    source.x - 22,
    source.x + source.width + 22,
    target.x - 22,
    target.x + target.width + 22,
    ...obstacles.flatMap((item) => [item.x - 18, item.x + item.width + 18]),
  ]).sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint)).slice(0, 18)
  let best: { score: number; x: number } | undefined
  for (const x of candidates) {
    const route = [{ x, y: sourceY }, { x, y: targetY }]
    if (countRouteObstacleCollisions(route, obstacles) > 0) continue
    const score = Math.abs(x - midpoint) + countRouteCrossings(route, occupied) * 1800
    if (!best || score < best.score) best = { score, x }
  }
  if (!best) return undefined
  return {
    fromAnchor: forward ? 'bottom' : 'top',
    toAnchor: forward ? 'top' : 'bottom',
    sourcePortApproach: forward ? 'top' : 'bottom',
    targetPortLeave: forward ? 'bottom' : 'top',
    sourcePort: { x: best.x, y: sourceY },
    targetPort: { x: best.x, y: targetY },
    hints: { x: [best.x], y: [sourceY, targetY] },
  }
}

function routeDownwardGroupFanouts(
  arrows: CanvasArrow[],
  boxes: Map<string, CanvasNode | CanvasNote>,
  occupied: RouteSegment[],
): Map<string, CanvasArrow> {
  const grouped = new Map<string, CanvasArrow[]>()
  for (const arrow of arrows) {
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to?.groupId || from.id === to.id) continue
    const key = `${arrow.from}\u0000${to.groupId}`
    grouped.set(key, [...(grouped.get(key) ?? []), arrow])
  }

  const result = new Map<string, CanvasArrow>()
  for (const members of grouped.values()) {
    if (members.length < 3) continue
    const source = boxes.get(members[0].from)
    const targets = members.flatMap((arrow) => {
      const target = boxes.get(arrow.to)
      return target ? [target] : []
    })
    if (!source || targets.length !== members.length) continue
    const sourceBottom = source.y + source.height
    const targetTop = Math.min(...targets.map((target) => target.y))
    if (targetTop - sourceBottom < 96 || targets.some((target) => target.y <= sourceBottom)) continue

    const start = fixedAnchorPoint(source, 'bottom')
    const branchY = targetTop - 28
    const targetLeft = Math.min(...targets.map((target) => target.x))
    const targetRight = Math.max(...targets.map((target) => target.x + target.width))
    const obstacles = [...boxes.values()]
      .filter((item) => item.id !== source.id && !targets.some((target) => target.id === item.id))
      // Shared data buses need to leave dense service clusters without being
      // rejected only because an adjacent card falls inside the generic 18px
      // comfort margin. Keep a smaller visual clearance here; the quality gate
      // still rejects any route that crosses the actual node geometry.
      .map((item) => expandRect(item, 8))
    const intermediate = obstacles.filter((item) => item.y < branchY && item.y + item.height > sourceBottom)
    const corridorCandidates = uniqueNumbers([
      start.x,
      ...intermediate.flatMap((item) => [item.x - 24, item.x + item.width + 24]),
    ])

    let best: {
      score: number
      routes: Map<string, { route: CanvasPoint[]; toAnchor: 'top' | 'right' | 'bottom' | 'left' }>
    } | undefined
    for (const corridorX of corridorCandidates) {
      const routes = new Map<string, { route: CanvasPoint[]; toAnchor: 'top' | 'right' | 'bottom' | 'left' }>()
      let score = 0
      let valid = true
      for (const arrow of members) {
        const target = boxes.get(arrow.to)!
        const routeObstacles = [
          ...obstacles,
          ...targets
            .filter((other) => other.id !== target.id)
            .map((other) => expandRect(other, 4)),
        ]
        const exitY = Math.min(branchY, start.y + 42)
        const prefix = corridorX === start.x
          ? [start, { x: start.x, y: branchY }]
          : [start, { x: start.x, y: exitY }, { x: corridorX, y: exitY }, { x: corridorX, y: branchY }]
        const routeCandidates: Array<{ route: CanvasPoint[]; toAnchor: 'top' | 'right' | 'bottom' | 'left' }> = []
        if (target.y <= targetTop + 4) {
          const end = fixedAnchorPoint(target, 'top')
          routeCandidates.push({
            route: simplifyRoute([...prefix, { x: end.x, y: branchY }, end]),
            toAnchor: 'top',
          })
        } else {
          const leftEnd = fixedAnchorPoint(target, 'left')
          const rightEnd = fixedAnchorPoint(target, 'right')
          routeCandidates.push(
            {
              route: simplifyRoute([...prefix, { x: targetLeft - 28, y: branchY }, { x: targetLeft - 28, y: leftEnd.y }, leftEnd]),
              toAnchor: 'left',
            },
            {
              route: simplifyRoute([...prefix, { x: targetRight + 28, y: branchY }, { x: targetRight + 28, y: rightEnd.y }, rightEnd]),
              toAnchor: 'right',
            },
          )
        }
        const routeChoice = routeCandidates
          .filter((candidate) => countRouteObstacleCollisions(candidate.route, routeObstacles) === 0)
          .map((candidate) => ({
            ...candidate,
            score: routeLength(candidate.route)
              + Math.max(0, candidate.route.length - 2) * 18
              + countRouteCrossings(candidate.route, occupied) * 1800,
          }))
          .sort((left, right) => left.score - right.score)[0]
        if (!routeChoice) {
          valid = false
          break
        }
        routes.set(arrow.id, { route: routeChoice.route, toAnchor: routeChoice.toAnchor })
        score += routeChoice.score
      }
      if (valid && (!best || score < best.score)) best = { score, routes }
    }
    if (!best) continue

    const bundleKey = `from:${source.id}`
    for (const arrow of members) {
      const routed = best.routes.get(arrow.id)
      const target = boxes.get(arrow.to)
      if (!routed || !target) continue
      const asyncEdge = source.icon === 'queue' || target.icon === 'queue'
        || source.stencil === 'kafka' || target.stencil === 'kafka'
        || source.stencil === 'rabbitmq' || target.stencil === 'rabbitmq'
      const routedArrow: CanvasArrow = {
        ...arrow,
        routing: 'orthogonal',
        fromAnchor: 'bottom',
        toAnchor: routed.toAnchor,
        fromPortRatio: undefined,
        toPortRatio: undefined,
        lineStyle: asyncEdge ? 'dashed' : arrow.lineStyle ?? 'solid',
        points: routed.route.length > 2 ? routed.route.slice(1, -1) : undefined,
        bundleKey,
      }
      result.set(arrow.id, routedArrow)
      addOccupiedSegments(routed.route, occupied, bundleKey)
    }
  }
  return result
}

function countRouteObstacleCollisions(route: CanvasPoint[], obstacles: RouteRect[]): number {
  let collisions = 0
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    for (const obstacle of obstacles) if (segmentIntersectsRect(segment, obstacle)) collisions += 1
  }
  return collisions
}

function routeLength(route: CanvasPoint[]): number {
  let length = 0
  for (let index = 0; index < route.length - 1; index += 1) {
    length += Math.abs(route[index + 1].x - route[index].x) + Math.abs(route[index + 1].y - route[index].y)
  }
  return length
}

function countRouteCrossings(route: CanvasPoint[], occupied: RouteSegment[]): number {
  let crossings = 0
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    for (const used of occupied) if (segmentsCross(segment, used)) crossings += 1
  }
  return crossings
}

function architectureArrowRoutingPriority(arrow: CanvasArrow): number {
  if (arrow.emphasis === 'primary') return 0
  if (arrow.emphasis === 'muted') return 2
  return 1
}

function currentArrowRoute(arrow: CanvasArrow, boxes: Map<string, CanvasNode | CanvasNote>): CanvasPoint[] | undefined {
  const from = boxes.get(arrow.from)
  const to = boxes.get(arrow.to)
  if (!from || !to) return undefined
  // The same authoritative endpoint geometry is used by Canvas rendering and
  // quality checks. Reconstructing four-side center ports here misses obstacles
  // across noncentral native ports when nodes move.
  return canvasArrowBoxRoute(from, to, arrow, arrow.from === arrow.to)
}

function countArrowEndpoints(arrows: CanvasArrow[], side: 'from' | 'to'): Map<string, number> {
  const counts = new Map<string, number>()
  arrows.forEach((arrow) => counts.set(arrow[side], (counts.get(arrow[side]) ?? 0) + 1))
  return counts
}

function crossGroupPairKey(from: CanvasNode | CanvasNote, to: CanvasNode | CanvasNote): string | undefined {
  if (!from.groupId || !to.groupId || from.groupId === to.groupId) return undefined
  return `${from.groupId}->${to.groupId}`
}

function routingGroupObstacles(
  from: CanvasNode | CanvasNote,
  to: CanvasNode | CanvasNote,
  frames: Map<string, CanvasGroupFrame>,
  groups: Map<string, CanvasGroup>,
): RouteRect[] {
  return [...frames.values()].flatMap((frame) => {
    const group = groups.get(frame.id)
    if (!group || group.c4Type === 'software-system') return []
    if (group.kind !== 'boundary' && !group.c4Type) return []
    if (groupRelatedToNode(frame.id, from.groupId, groups) || groupRelatedToNode(frame.id, to.groupId, groups)) return []
    return [expandRect(frame, 10)]
  })
}

function groupRelatedToNode(groupId: string, nodeGroupId: string | undefined, groups: Map<string, CanvasGroup>): boolean {
  if (!nodeGroupId) return false
  return groupContainsGroup(groupId, nodeGroupId, groups) || groupContainsGroup(nodeGroupId, groupId, groups)
}

function groupContainsGroup(ancestorId: string, candidateId: string, groups: Map<string, CanvasGroup>): boolean {
  let current: string | undefined = candidateId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = groups.get(current)?.parentId
  }
  return false
}

function buildBundleRoute(
  start: CanvasPoint,
  end: CanvasPoint,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
  side: 'from' | 'to',
): CanvasPoint[] {
  if (side === 'from') {
    const trunk = offsetAnchor(start, fromAnchor, 64)
    if (fromAnchor === 'left' || fromAnchor === 'right') return simplifyRoute([start, trunk, { x: trunk.x, y: end.y }, end])
    return simplifyRoute([start, trunk, { x: end.x, y: trunk.y }, end])
  }
  const trunk = offsetAnchor(end, toAnchor, 64)
  if (toAnchor === 'left' || toAnchor === 'right') return simplifyRoute([start, { x: trunk.x, y: start.y }, trunk, end])
  return simplifyRoute([start, { x: start.x, y: trunk.y }, trunk, end])
}

function offsetAnchor(point: CanvasPoint, anchor: 'top' | 'right' | 'bottom' | 'left', distance: number): CanvasPoint {
  if (anchor === 'left') return { x: point.x - distance, y: point.y }
  if (anchor === 'right') return { x: point.x + distance, y: point.y }
  if (anchor === 'top') return { x: point.x, y: point.y - distance }
  return { x: point.x, y: point.y + distance }
}

function preferredAnchorPairs(dx: number, dy: number): Array<['top' | 'right' | 'bottom' | 'left', 'top' | 'right' | 'bottom' | 'left']> {
  const horizontal: ['right' | 'left', 'left' | 'right'] = dx >= 0 ? ['right', 'left'] : ['left', 'right']
  const vertical: ['bottom' | 'top', 'top' | 'bottom'] = dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
  return Math.abs(dx) >= Math.abs(dy)
    ? [horizontal, vertical, [horizontal[0], vertical[1]], [vertical[0], horizontal[1]]]
    : [vertical, horizontal, [vertical[0], horizontal[1]], [horizontal[0], vertical[1]]]
}

function fixedAnchorPoint(box: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>, anchor: 'top' | 'right' | 'bottom' | 'left'): CanvasPoint {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  if (anchor === 'top') return { x: cx, y: box.y }
  if (anchor === 'right') return { x: box.x + box.width, y: cy }
  if (anchor === 'bottom') return { x: cx, y: box.y + box.height }
  return { x: box.x, y: cy }
}

function segmentsOverlapBeyondFork(left: ReturnType<typeof canvasArrowBoxRoute>, right: ReturnType<typeof canvasArrowBoxRoute>) {
  // Both routes already share one explicit source stem. Branches must not
  // overlap for any positive distance after the fork.
  for (let i = 0; i + 1 < left.length; i += 1) {
    const a = left[i], b = left[i + 1]
    for (let j = 0; j + 1 < right.length; j += 1) {
      const c = right[j], d = right[j + 1]
      if (a.x === b.x && c.x === d.x && a.x === c.x
        && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 2) return true
      if (a.y === b.y && c.y === d.y && a.y === c.y
        && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 2) return true
    }
  }
  return false
}

/** Explicitly identify a real shared source stem, not arbitrary edge overlaps. */
export function annotateSourceFanoutTrunks(scene: CanvasScene): CanvasScene {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item) => item.type === 'arrow')
  const bundles = new Map<string, string>()
  for (const source of new Set(arrows.map((arrow) => arrow.from))) {
    const outgoing = arrows.filter((arrow) => arrow.from === source && !arrow.bundleKey)
    if (outgoing.length < 2) continue
    const paths = outgoing.flatMap((arrow) => {
      const from = nodes.get(arrow.from), to = nodes.get(arrow.to)
      return from && to ? [{ arrow, path: canvasArrowBoxRoute(from, to, arrow) }] : []
    })
    // Shared-bus SVG rendering uses the identical first waypoint. Require
    // at least 12px of collinear outgoing trunk followed by separate branches.
    for (let i = 0; i < paths.length; i += 1) {
      const first = paths[i]
      if (bundles.has(first.arrow.id) || first.path.length < 3) continue
      for (let j = i + 1; j < paths.length; j += 1) {
        const second = paths[j]
        if (bundles.has(second.arrow.id) || second.path.length < 3) continue
        const shared = canvasSharedSourceStem(first.path, second.path)
        if (!shared || segmentsOverlapBeyondFork(shared.leftTail, shared.rightTail)) continue
        const b = shared.trunk.at(-1)!
        // Keep disjoint pairs separate even when their fork coordinates match.
        const key = `from:${source}:${Math.round(b.x)}:${Math.round(b.y)}:${i}:${j}`
        bundles.set(first.arrow.id, key)
        bundles.set(second.arrow.id, key)
        break
      }
    }
  }
  if (!bundles.size) return scene
  return { ...scene, elements: scene.elements.map((item) => item.type === 'arrow' && bundles.has(item.id)
    ? { ...item, bundleKey: bundles.get(item.id) }
    : item) }
}
