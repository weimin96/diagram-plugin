import { CANVAS_PORT_MIN_SEPARATION_PX, canvasArrowBoxRoute, canvasGroupFrames, type CanvasNode, type CanvasPoint, type CanvasScene } from './canvas.js'

/** Geometry diagnostics only. They must not silently alter a saved CanvasScene. */
export interface ArchitectureRouteDiagnostics {
  totalRouteLength: number
  /** Real right-angle turns, excluding duplicate waypoints and diagonal
   * geometry (reported separately by Canvas quality). A reading-cost signal. */
  totalRouteBends: number
  worstRouteBends: Array<{ edgeId: string; bends: number }>
  /** Declared side ports whose first/last orthogonal leg is not actually
   * perpendicular to the box boundary. Geometry evidence, not a layout score. */
  terminalNormalViolations: number
  worstTerminalNormalViolations: Array<{
    edgeId: string; endpoint: 'from' | 'to'; side: 'top' | 'right' | 'bottom' | 'left'
  }>
  /** Pairs of independent incoming arrows competing for the same physical
   * node-side port capacity; not a substitute for full-route collision checks. */
  ingressPortConflicts: number
  /** Advisory physical demand, including ingress and egress on the same
   * side. Leave one port-spacing of inset at each corner. This reports an
   * infeasible side capacity; it never silently resizes an authored node. */
  sidePortCapacityDeficits: Array<{
    nodeId: string; side: 'top' | 'right' | 'bottom' | 'left'
    portCount: number; availablePorts: number
    sideSpanPx: number; requiredSpanPx: number
  }>
  crossPartitionRouteLength: number
  crossPartitionDirectDistance: number
  crossPartitionRelations: number
  backwardCrossPartitionRelations: number
  frameOverlaps: number
  /** Pixel area of overlapping, unrelated sibling frames. */
  frameOverlapArea: number
  /** Largest unrelated frame collisions, with the two actual group IDs. */
  worstFrameOverlaps: Array<{
    firstGroupId: string; secondGroupId: string; area: number
    /** Members geometrically entering the opposing frame; not inferred causes. */
    intrudingNodeIds: string[]
  }>
  /** Total length of route segments passing inside unrelated partition frames. */
  unrelatedFrameIntrusionLength: number
  /** Top offending edge/frame pairs for targeted route review (not a visual score). */
  worstFrameIntrusions: Array<{ edgeId: string; frameId: string; length: number }>
  /** Same-region routes that leave both endpoint node envelopes and add
   * substantial distance. A review signal, not an automatic layout failure. */
  perimeterDetours: number
  worstPerimeterDetours: Array<{
    edgeId: string; routeLength: number; excessLength: number; outsideDistance: number
  }>
}

function segmentWithinRect(a: CanvasPoint, b: CanvasPoint, frame: {
  x: number; y: number; width: number; height: number
}): number {
  // Routes are orthogonal. A diagonal is not counted as a valid corridor.
  if (a.y === b.y && a.y > frame.y && a.y < frame.y + frame.height) {
    return Math.max(0, Math.min(Math.max(a.x, b.x), frame.x + frame.width)
      - Math.max(Math.min(a.x, b.x), frame.x))
  }
  if (a.x === b.x && a.x > frame.x && a.x < frame.x + frame.width) {
    return Math.max(0, Math.min(Math.max(a.y, b.y), frame.y + frame.height)
      - Math.max(Math.min(a.y, b.y), frame.y))
  }
  return 0
}

/** Read the outward tangent from a real endpoint. At the target the outward
 * direction points backwards from the end of the route to its prior waypoint. */
function hasOutwardPortNormal(
  endpoint: CanvasPoint, neighbor: CanvasPoint,
  side: 'top' | 'right' | 'bottom' | 'left',
): boolean {
  switch (side) {
    case 'top': return neighbor.x === endpoint.x && neighbor.y < endpoint.y
    case 'right': return neighbor.y === endpoint.y && neighbor.x > endpoint.x
    case 'bottom': return neighbor.x === endpoint.x && neighbor.y > endpoint.y
    case 'left': return neighbor.y === endpoint.y && neighbor.x < endpoint.x
  }
}

export function assessArchitectureRouteDiagnostics(scene: CanvasScene): ArchitectureRouteDiagnostics {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const groups = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const frames = canvasGroupFrames(scene).filter((frame) => !frame.collapsed)
  const intersects = (node: CanvasNode, frame: (typeof frames)[number]) =>
    Math.min(node.x + node.width, frame.x + frame.width) > Math.max(node.x, frame.x)
    && Math.min(node.y + node.height, frame.y + frame.height) > Math.max(node.y, frame.y)
  let frameOverlaps = 0
  let frameOverlapArea = 0
  const frameCollisions: ArchitectureRouteDiagnostics['worstFrameOverlaps'] = []
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      const a = frames[i], b = frames[j]
      // Parent/child frames intentionally enclose one another.
      if (a.memberIds.some((id) => b.memberIds.includes(id))
        || groups.get(a.id)?.parentId === b.id || groups.get(b.id)?.parentId === a.id
        || (groups.get(a.id)?.parentId ?? null) !== (groups.get(b.id)?.parentId ?? null)) continue
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (width <= 5 || height <= 5) continue
      frameOverlaps += 1
      const area = Math.round(width * height)
      frameOverlapArea += area
      const intrudingNodes = [
        ...a.memberIds.filter((id) => nodes.get(id)?.groupId === a.id && intersects(nodes.get(id)!, b)),
        ...b.memberIds.filter((id) => nodes.get(id)?.groupId === b.id && intersects(nodes.get(id)!, a)),
      ]
      const overlapWithOppositeFrame = (id: string) => {
        const node = nodes.get(id)!
        const opposite = node.groupId === a.id ? b : a
        return (Math.min(node.x + node.width, opposite.x + opposite.width) - Math.max(node.x, opposite.x))
          * (Math.min(node.y + node.height, opposite.y + opposite.height) - Math.max(node.y, opposite.y))
      }
      const intrudingNodeIds = intrudingNodes.sort((left, right) =>
        overlapWithOppositeFrame(right) - overlapWithOppositeFrame(left)
        || left.localeCompare(right, 'en')).slice(0, 4)
      frameCollisions.push({ firstGroupId: a.id, secondGroupId: b.id, area, intrudingNodeIds })
    }
  }
  let totalRouteLength = 0
  let totalRouteBends = 0
  const routeBends: ArchitectureRouteDiagnostics['worstRouteBends'] = []
  const ingressBySide = new Map<string, Array<{ position: number; bundleKey?: string }>>()
  const demandedBySide = new Map<string, {
    nodeId: string; side: 'top' | 'right' | 'bottom' | 'left'; span: number; owners: Set<string>
  }>()
  const reserveSideCapacity = (
    node: CanvasNode, side: 'top' | 'right' | 'bottom' | 'left' | 'auto' | undefined,
    edgeId: string, owner: string,
  ) => {
    if (!side || side === 'auto' || node.rotation) return
    const key = `${node.id}\u0000${side}`
    const entry = demandedBySide.get(key) ?? {
      nodeId: node.id, side, span: side === 'left' || side === 'right' ? node.height : node.width,
      owners: new Set<string>(),
    }
    entry.owners.add(owner || edgeId)
    demandedBySide.set(key, entry)
  }
  let crossPartitionRouteLength = 0
  let crossPartitionDirectDistance = 0
  let crossPartitionRelations = 0
  let backwardCrossPartitionRelations = 0
  let unrelatedFrameIntrusionLength = 0
  const intrusions: ArchitectureRouteDiagnostics['worstFrameIntrusions'] = []
  const perimeter: ArchitectureRouteDiagnostics['worstPerimeterDetours'] = []
  const portNormalViolations: ArchitectureRouteDiagnostics['worstTerminalNormalViolations'] = []
  const frameById = new Map(frames.map((frame) => [frame.id, frame]))
  for (const arrow of scene.elements) {
    if (arrow.type !== 'arrow') continue
    const source = nodes.get(arrow.from), target = nodes.get(arrow.to)
    if (!source || !target) continue
    reserveSideCapacity(source, arrow.fromAnchor, arrow.id,
      arrow.bundleKey ? `from:${arrow.bundleKey}` : arrow.id)
    reserveSideCapacity(target, arrow.toAnchor, arrow.id,
      arrow.bundleKey ? `to:${arrow.bundleKey}` : arrow.id)
    if (arrow.toAnchor && arrow.toAnchor !== 'auto' && !target.rotation) {
      const span = arrow.toAnchor === 'left' || arrow.toAnchor === 'right' ? target.height : target.width
      const key = `${target.id}\u0000${arrow.toAnchor}`
      ingressBySide.set(key, [...(ingressBySide.get(key) ?? []), {
        position: (arrow.toPortRatio ?? 0.5) * span, bundleKey: arrow.bundleKey,
      }])
    }
    const points = canvasArrowBoxRoute(source, target, arrow)
    if (arrow.routing === 'orthogonal' && points.length >= 3) {
      const corners = points.filter((point, index) =>
        index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
      let bends = 0
      for (let index = 1; index + 1 < corners.length; index++) {
        const before = corners[index - 1], current = corners[index], after = corners[index + 1]
        if ((before.x === current.x && current.y === after.y)
          || (before.y === current.y && current.x === after.x)) bends++
      }
      totalRouteBends += bends
      if (bends) routeBends.push({ edgeId: arrow.id, bends })
    }
    if (arrow.routing === 'orthogonal' && !source.rotation && !target.rotation && points.length >= 2) {
      for (const endpoint of ['from', 'to'] as const) {
        const side = endpoint === 'from' ? arrow.fromAnchor : arrow.toAnchor
        if (!side || side === 'auto') continue
        const start = endpoint === 'from' ? points[0] : points.at(-1)!
        const next = endpoint === 'from' ? points[1] : points.at(-2)!
        if (!hasOutwardPortNormal(start, next, side)) {
          portNormalViolations.push({ edgeId: arrow.id, endpoint, side })
        }
      }
    }
    const length = points.slice(1).reduce((sum, point, index) =>
      sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0)
    totalRouteLength += length
    if (source.groupId && source.groupId === target.groupId && points.length >= 3) {
      const first = points[0], last = points.at(-1)!
      const direct = Math.abs(first.x - last.x) + Math.abs(first.y - last.y)
      const excess = length - direct
      const left = Math.min(source.x, target.x), top = Math.min(source.y, target.y)
      const right = Math.max(source.x + source.width, target.x + target.width)
      const bottom = Math.max(source.y + source.height, target.y + target.height)
      const outside = Math.max(0, left - Math.min(...points.map((point) => point.x)))
        + Math.max(0, Math.max(...points.map((point) => point.x)) - right)
        + Math.max(0, top - Math.min(...points.map((point) => point.y)))
        + Math.max(0, Math.max(...points.map((point) => point.y)) - bottom)
      // Both conditions are required: a legitimate long lane inside a
      // partition is not an exterior detour, and a tiny bend outside a
      // rounded rectangle is not a significant rerouting problem.
      if (excess >= 80 && outside >= 36) {
        perimeter.push({
          edgeId: arrow.id, routeLength: Math.round(length),
          excessLength: Math.round(excess), outsideDistance: Math.round(outside),
        })
      }
    }
    if (!source.groupId || !target.groupId || source.groupId === target.groupId) continue
    crossPartitionRelations += 1
    crossPartitionRouteLength += length
    const sourceX = source.x + source.width / 2, sourceY = source.y + source.height / 2
    const targetX = target.x + target.width / 2, targetY = target.y + target.height / 2
    crossPartitionDirectDistance += Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY)
    if (frameById.has(source.groupId) && frameById.has(target.groupId)
      && frameById.get(source.groupId)!.x > frameById.get(target.groupId)!.x + 5) {
      backwardCrossPartitionRelations += 1
    }
    for (const frame of frames) {
      if (frame.id === source.groupId || frame.id === target.groupId) continue
      if (frame.memberIds.includes(arrow.from) || frame.memberIds.includes(arrow.to)) continue
      let frameIntrusion = 0
      for (let index = 0; index + 1 < points.length; index += 1) {
        frameIntrusion += segmentWithinRect(points[index], points[index + 1], frame)
      }
      if (frameIntrusion > 0) intrusions.push({ edgeId: arrow.id, frameId: frame.id, length: Math.round(frameIntrusion) })
      unrelatedFrameIntrusionLength += frameIntrusion
    }
  }
  let ingressPortConflicts = 0
  for (const ports of ingressBySide.values()) {
    ports.sort((a, b) => a.position - b.position)
    for (let index = 1; index < ports.length; index++) {
      if (ports[index].position - ports[index - 1].position < CANVAS_PORT_MIN_SEPARATION_PX
        && !(ports[index].bundleKey && ports[index].bundleKey === ports[index - 1].bundleKey)) {
        ingressPortConflicts++
      }
    }
  }
  const sidePortCapacityDeficits = [...demandedBySide.values()].flatMap((entry) => {
    const portCount = entry.owners.size
    const availablePorts = Math.max(0, Math.floor(entry.span / CANVAS_PORT_MIN_SEPARATION_PX) - 1)
    return portCount > availablePorts ? [{
      nodeId: entry.nodeId, side: entry.side, portCount, availablePorts,
      sideSpanPx: entry.span,
      requiredSpanPx: (portCount + 1) * CANVAS_PORT_MIN_SEPARATION_PX,
    }] : []
  }).sort((a, b) => (b.requiredSpanPx - b.sideSpanPx) - (a.requiredSpanPx - a.sideSpanPx)
    || a.nodeId.localeCompare(b.nodeId, 'en') || a.side.localeCompare(b.side, 'en'))
  return {
    totalRouteLength: Math.round(totalRouteLength),
    totalRouteBends,
    worstRouteBends: routeBends.sort((a, b) => b.bends - a.bends
      || a.edgeId.localeCompare(b.edgeId, 'en')).slice(0, 5),
    terminalNormalViolations: portNormalViolations.length,
    worstTerminalNormalViolations: portNormalViolations.slice(0, 12),
    ingressPortConflicts,
    sidePortCapacityDeficits,
    crossPartitionRouteLength: Math.round(crossPartitionRouteLength),
    crossPartitionDirectDistance: Math.round(crossPartitionDirectDistance),
    crossPartitionRelations,
    backwardCrossPartitionRelations,
    frameOverlaps,
    frameOverlapArea: Math.round(frameOverlapArea),
    worstFrameOverlaps: frameCollisions.sort((a, b) => b.area - a.area
      || a.firstGroupId.localeCompare(b.firstGroupId)
      || a.secondGroupId.localeCompare(b.secondGroupId)).slice(0, 5),
    unrelatedFrameIntrusionLength: Math.round(unrelatedFrameIntrusionLength),
    worstFrameIntrusions: intrusions.sort((a, b) => b.length - a.length
      || a.edgeId.localeCompare(b.edgeId) || a.frameId.localeCompare(b.frameId)).slice(0, 5),
    perimeterDetours: perimeter.length,
    worstPerimeterDetours: perimeter.sort((a, b) => b.excessLength - a.excessLength
      || b.outsideDistance - a.outsideDistance || a.edgeId.localeCompare(b.edgeId)).slice(0, 5),
  }
}
