import { canvasArrowBoxRoute, canvasGroupFrames, type CanvasNode, type CanvasPoint, type CanvasScene } from './canvas.js'

/** Geometry diagnostics only. They must not silently alter a saved CanvasScene. */
export interface ArchitectureRouteDiagnostics {
  totalRouteLength: number
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
  let crossPartitionRouteLength = 0
  let crossPartitionDirectDistance = 0
  let crossPartitionRelations = 0
  let backwardCrossPartitionRelations = 0
  let unrelatedFrameIntrusionLength = 0
  const intrusions: ArchitectureRouteDiagnostics['worstFrameIntrusions'] = []
  const frameById = new Map(frames.map((frame) => [frame.id, frame]))
  for (const arrow of scene.elements) {
    if (arrow.type !== 'arrow') continue
    const source = nodes.get(arrow.from), target = nodes.get(arrow.to)
    if (!source || !target) continue
    const points = canvasArrowBoxRoute(source, target, arrow)
    const length = points.slice(1).reduce((sum, point, index) =>
      sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0)
    totalRouteLength += length
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
  return {
    totalRouteLength: Math.round(totalRouteLength),
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
  }
}
