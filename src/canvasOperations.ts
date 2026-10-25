import type { CanvasArrow, CanvasC4Type, CanvasElement, CanvasGroup, CanvasIcon, CanvasLane, CanvasLaneAxis, CanvasNode, CanvasNote, CanvasPoint, CanvasScene, CanvasStencil } from './canvas.js'
import type { ArchitectureNodeTemplate } from './architectureNodeTemplates.js'

export interface CanvasSnapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasSpacingGuide {
  axis: 'x' | 'y'
  from: number
  to: number
  cross: number
  distance: number
}

export interface CanvasSmartSnapResult {
  delta: CanvasPoint
  xGuide?: number
  yGuide?: number
  spacingGuides: CanvasSpacingGuide[]
  sameWidth: boolean
  sameHeight: boolean
}

export type CanvasResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface CanvasTransformBox extends CanvasSnapRect {
  rotation?: number
}

export function resizeCanvasTransformBox(
  box: CanvasTransformBox,
  handle: CanvasResizeHandle,
  pointer: CanvasPoint,
  options: { center?: boolean; preserveAspect?: boolean; minWidth?: number; minHeight?: number } = {},
): CanvasTransformBox {
  const minWidth = options.minWidth ?? 100
  const minHeight = options.minHeight ?? 60
  const rotation = box.rotation ?? 0
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const toLocal = (point: CanvasPoint, origin: CanvasPoint) => {
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
  }
  const hasX = handle.includes('e') || handle.includes('w')
  const hasY = handle.includes('n') || handle.includes('s')
  const signX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const signY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  let width = box.width
  let height = box.height
  let nextCenter = { ...center }

  if (options.center) {
    const local = toLocal(pointer, center)
    if (hasX) width = Math.max(minWidth, Math.abs(local.x) * 2)
    if (hasY) height = Math.max(minHeight, Math.abs(local.y) * 2)
  } else {
    const anchorLocal = { x: -signX * box.width / 2, y: -signY * box.height / 2 }
    const anchor = {
      x: center.x + anchorLocal.x * cos - anchorLocal.y * sin,
      y: center.y + anchorLocal.x * sin + anchorLocal.y * cos,
    }
    const local = toLocal(pointer, anchor)
    if (hasX) width = Math.max(minWidth, Math.abs(local.x))
    if (hasY) height = Math.max(minHeight, Math.abs(local.y))
    nextCenter = {
      x: anchor.x + (signX * width / 2) * cos - (signY * height / 2) * sin,
      y: anchor.y + (signX * width / 2) * sin + (signY * height / 2) * cos,
    }
  }

  if (options.preserveAspect && (hasX || hasY)) {
    const requestedScale = hasX && hasY
      ? Math.max(width / box.width, height / box.height)
      : hasX ? width / box.width : height / box.height
    const scale = Math.max(requestedScale, minWidth / box.width, minHeight / box.height)
    width = box.width * scale
    height = box.height * scale
    if (!options.center) {
      const anchorLocal = { x: -signX * box.width / 2, y: -signY * box.height / 2 }
      const anchor = {
        x: center.x + anchorLocal.x * cos - anchorLocal.y * sin,
        y: center.y + anchorLocal.x * sin + anchorLocal.y * cos,
      }
      nextCenter = {
        x: anchor.x + (signX * width / 2) * cos - (signY * height / 2) * sin,
        y: anchor.y + (signX * width / 2) * sin + (signY * height / 2) * cos,
      }
    }
  }

  return {
    x: nextCenter.x - width / 2,
    y: nextCenter.y - height / 2,
    width,
    height,
    ...(rotation ? { rotation } : {}),
  }
}

export function scaleCanvasTransformBoxes(
  boxes: ReadonlyMap<string, CanvasTransformBox>,
  bounds: CanvasSnapRect,
  handle: CanvasResizeHandle,
  pointer: CanvasPoint,
  options: { center?: boolean; preserveAspect?: boolean; minWidth?: number; minHeight?: number } = {},
): Map<string, CanvasTransformBox> {
  const minWidth = options.minWidth ?? 100
  const minHeight = options.minHeight ?? 60
  const minimumScaleX = Math.max(...[...boxes.values()].map((box) => minWidth / box.width), 0)
  const minimumScaleY = Math.max(...[...boxes.values()].map((box) => minHeight / box.height), 0)
  const target = resizeCanvasTransformBox(bounds, handle, pointer, {
    ...options,
    minWidth: Math.max(1, bounds.width * minimumScaleX),
    minHeight: Math.max(1, bounds.height * minimumScaleY),
  })
  const scaleX = target.width / Math.max(1, bounds.width)
  const scaleY = target.height / Math.max(1, bounds.height)
  const result = new Map<string, CanvasTransformBox>()
  for (const [id, box] of boxes) {
    result.set(id, {
      x: target.x + (box.x - bounds.x) * scaleX,
      y: target.y + (box.y - bounds.y) * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY,
      ...(box.rotation ? { rotation: box.rotation } : {}),
    })
  }
  return result
}

export function canvasRotationFromPointer(center: CanvasPoint, start: CanvasPoint, current: CanvasPoint, initialRotation = 0, snapStep = 1): number {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x)
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x)
  const delta = ((currentAngle - startAngle) * 180) / Math.PI
  const value = initialRotation + delta
  const snapped = Math.round(value / Math.max(0.1, snapStep)) * Math.max(0.1, snapStep)
  const normalized = ((snapped % 360) + 360) % 360
  return normalized > 180 ? normalized - 360 : normalized
}

export function computeCanvasSmartSnap(
  proposed: CanvasSnapRect,
  targets: CanvasSnapRect[],
  threshold: number,
  extraXTargets: number[] = [],
  extraYTargets: number[] = [],
): CanvasSmartSnapResult {
  const sourceX = [proposed.x, proposed.x + proposed.width / 2, proposed.x + proposed.width]
  const sourceY = [proposed.y, proposed.y + proposed.height / 2, proposed.y + proposed.height]
  const targetX = [...targets.flatMap((target) => [target.x, target.x + target.width / 2, target.x + target.width]), ...extraXTargets]
  const targetY = [...targets.flatMap((target) => [target.y, target.y + target.height / 2, target.y + target.height]), ...extraYTargets]
  const xSnap = nearestSnapDelta(sourceX, targetX, threshold)
  const ySnap = nearestSnapDelta(sourceY, targetY, threshold)
  let dx = xSnap?.delta ?? 0
  let dy = ySnap?.delta ?? 0
  let xGuide = xSnap?.target
  let yGuide = ySnap?.target
  const spacingGuides: CanvasSpacingGuide[] = []

  let adjusted = { ...proposed, x: proposed.x + dx, y: proposed.y + dy }
  if (!xSnap) {
    const spacing = equalSpacingSnap(adjusted, targets, 'x', threshold)
    if (spacing) {
      dx += spacing.delta
      adjusted = { ...adjusted, x: adjusted.x + spacing.delta }
      spacingGuides.push(...spacing.guides)
    }
  }
  if (!ySnap) {
    const spacing = equalSpacingSnap(adjusted, targets, 'y', threshold)
    if (spacing) {
      dy += spacing.delta
      adjusted = { ...adjusted, y: adjusted.y + spacing.delta }
      spacingGuides.push(...spacing.guides)
    }
  }

  const nearby = targets.filter((target) => {
    const dx = target.x + target.width / 2 - (adjusted.x + adjusted.width / 2)
    const dy = target.y + target.height / 2 - (adjusted.y + adjusted.height / 2)
    return Math.hypot(dx, dy) <= 480
  })
  return {
    delta: { x: dx, y: dy },
    ...(xGuide !== undefined ? { xGuide } : {}),
    ...(yGuide !== undefined ? { yGuide } : {}),
    spacingGuides,
    sameWidth: nearby.some((target) => Math.abs(target.width - adjusted.width) < 0.5),
    sameHeight: nearby.some((target) => Math.abs(target.height - adjusted.height) < 0.5),
  }
}

function nearestSnapDelta(sources: number[], targets: number[], threshold: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number; distance: number } | null = null
  for (const source of sources) {
    for (const target of targets) {
      const delta = target - source
      const distance = Math.abs(delta)
      if (distance > threshold || (best && distance >= best.distance)) continue
      best = { delta, target, distance }
    }
  }
  return best ? { delta: best.delta, target: best.target } : null
}

function equalSpacingSnap(
  proposed: CanvasSnapRect,
  targets: CanvasSnapRect[],
  axis: 'x' | 'y',
  threshold: number,
): { delta: number; guides: CanvasSpacingGuide[] } | null {
  if (axis === 'x') {
    const overlaps = targets.filter((target) => rangesOverlap(proposed.y, proposed.y + proposed.height, target.y, target.y + target.height, threshold))
    const left = overlaps.filter((target) => target.x + target.width <= proposed.x + threshold).sort((a, b) => (b.x + b.width) - (a.x + a.width))[0]
    const right = overlaps.filter((target) => target.x >= proposed.x + proposed.width - threshold).sort((a, b) => a.x - b.x)[0]
    if (!left || !right) return null
    const leftGap = proposed.x - (left.x + left.width)
    const rightGap = right.x - (proposed.x + proposed.width)
    const delta = (rightGap - leftGap) / 2
    if (leftGap < -threshold || rightGap < -threshold || Math.abs(delta) > threshold) return null
    const snappedLeft = proposed.x + delta
    const snappedRight = snappedLeft + proposed.width
    const distance = Math.max(0, Math.round((leftGap + rightGap) / 2))
    const cross = proposed.y + proposed.height / 2
    return {
      delta,
      guides: [
        { axis, from: left.x + left.width, to: snappedLeft, cross, distance },
        { axis, from: snappedRight, to: right.x, cross, distance },
      ],
    }
  }
  const overlaps = targets.filter((target) => rangesOverlap(proposed.x, proposed.x + proposed.width, target.x, target.x + target.width, threshold))
  const top = overlaps.filter((target) => target.y + target.height <= proposed.y + threshold).sort((a, b) => (b.y + b.height) - (a.y + a.height))[0]
  const bottom = overlaps.filter((target) => target.y >= proposed.y + proposed.height - threshold).sort((a, b) => a.y - b.y)[0]
  if (!top || !bottom) return null
  const topGap = proposed.y - (top.y + top.height)
  const bottomGap = bottom.y - (proposed.y + proposed.height)
  const delta = (bottomGap - topGap) / 2
  if (topGap < -threshold || bottomGap < -threshold || Math.abs(delta) > threshold) return null
  const snappedTop = proposed.y + delta
  const snappedBottom = snappedTop + proposed.height
  const distance = Math.max(0, Math.round((topGap + bottomGap) / 2))
  const cross = proposed.x + proposed.width / 2
  return {
    delta,
    guides: [
      { axis, from: top.y + top.height, to: snappedTop, cross, distance },
      { axis, from: snappedBottom, to: bottom.y, cross, distance },
    ],
  }
}

function rangesOverlap(a1: number, a2: number, b1: number, b2: number, padding: number): boolean {
  return a1 <= b2 + padding && a2 + padding >= b1
}

export function copyCanvasSelection(scene: CanvasScene, ids: string[]): CanvasElement[] {
  const chosen = new Set(ids)
  return scene.elements
    .filter((item) => chosen.has(item.id) || (item.type === 'arrow' && chosen.has(item.from) && chosen.has(item.to)))
    .map((item) => ({ ...item }))
}

export function pasteCanvasSelection(scene: CanvasScene, copied: CanvasElement[], offset = 32): { scene: CanvasScene; selectedIds: string[] } {
  const idMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  const groupCounts = new Map<string, number>()
  copied.forEach((item) => {
    if (item.type !== 'arrow' && item.groupId) groupCounts.set(item.groupId, (groupCounts.get(item.groupId) ?? 0) + 1)
  })
  const used: Array<Pick<CanvasElement, 'id'>> = [...scene.elements]
  const boxes = copied.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => {
    const id = nextCanvasElementId(item.type, used)
    idMap.set(item.id, id)
    let groupId = item.groupId && (groupCounts.get(item.groupId) ?? 0) > 1 ? item.groupId : undefined
    if (groupId) {
      if (!groupMap.has(groupId)) groupMap.set(groupId, nextCanvasGroupId(scene, [...groupMap.values()]))
      groupId = groupMap.get(groupId)
    }
    const pasted = {
      ...item,
      id,
      ...(groupId ? { groupId } : {}),
      x: clamp(item.x + offset, 0, scene.width - item.width),
      y: clamp(item.y + offset, 0, scene.height - item.height),
    }
    used.push(pasted)
    return pasted
  })
  const arrows = copied.filter((item): item is CanvasArrow => item.type === 'arrow').flatMap((item) => {
    if (item.start && item.end) {
      const pasted: CanvasArrow = {
        ...item,
        id: nextCanvasElementId('arrow', used),
        start: { x: clamp(item.start.x + offset, 0, scene.width), y: clamp(item.start.y + offset, 0, scene.height) },
        end: { x: clamp(item.end.x + offset, 0, scene.width), y: clamp(item.end.y + offset, 0, scene.height) },
        ...(item.points ? { points: item.points.map((point) => ({ x: clamp(point.x + offset, 0, scene.width), y: clamp(point.y + offset, 0, scene.height) })) } : {}),
        ...(item.labelPosition ? { labelPosition: { x: clamp(item.labelPosition.x + offset, 0, scene.width), y: clamp(item.labelPosition.y + offset, 0, scene.height) } } : {}),
      }
      used.push(pasted)
      return [pasted]
    }
    const from = idMap.get(item.from)
    const to = idMap.get(item.to)
    if (!from || !to) return []
    const pasted: CanvasArrow = { ...item, id: nextCanvasElementId('arrow', used), from, to }
    used.push(pasted)
    return [pasted]
  })
  const copiedGroups = [...groupMap.entries()].map(([oldId, newId]) => {
    const sourceGroup = scene.groups?.find((group) => group.id === oldId)
    if (!sourceGroup) return { id: newId }
    const remappedParent = sourceGroup.parentId ? groupMap.get(sourceGroup.parentId) : undefined
    return {
      ...sourceGroup,
      id: newId,
      label: sourceGroup.label ? `${sourceGroup.label} Copy` : undefined,
      ...(remappedParent ? { parentId: remappedParent } : { parentId: undefined }),
    }
  })
  return {
    scene: { ...scene, elements: [...scene.elements, ...boxes, ...arrows], groups: copiedGroups.length ? [...(scene.groups ?? []), ...copiedGroups] : scene.groups },
    selectedIds: boxes.map((item) => item.id),
  }
}

export function deleteCanvasSelection(scene: CanvasScene, ids: string[]): CanvasScene {
  const removed = new Set(ids)
  const elements = scene.elements.filter((item) => (
    !removed.has(item.id)
    && !(item.type === 'arrow' && (removed.has(item.from) || removed.has(item.to)))
  ))
  const groupById = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const usedGroups = new Set<string>()
  for (const item of elements) {
    if (item.type === 'arrow') continue
    let groupId = item.groupId
    const seen = new Set<string>()
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId)
      usedGroups.add(groupId)
      groupId = groupById.get(groupId)?.parentId
    }
  }
  return {
    ...scene,
    elements,
    groups: scene.groups?.filter((group) => usedGroups.has(group.id)),
  }
}

export function reconnectCanvasArrow(
  scene: CanvasScene,
  arrowId: string,
  endpoint: 'from' | 'to',
  nodeId: string,
  anchor?: CanvasArrow['fromAnchor'],
): CanvasScene {
  const nodes = new Set(scene.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
  if (!nodes.has(nodeId)) return scene
  const arrow = scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === arrowId)
  if (!arrow) return scene
  if (endpoint === 'from' && arrow.to === nodeId) return scene
  if (endpoint === 'to' && arrow.from === nodeId) return scene
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type !== 'arrow' || item.id !== arrowId) return item
      const next: CanvasArrow = {
        ...item,
        ...(endpoint === 'from' ? { from: nodeId, fromAnchor: anchor, fromPortRatio: undefined } : { to: nodeId, toAnchor: anchor, toPortRatio: undefined }),
        points: undefined,
        labelPosition: undefined,
        bundleKey: undefined,
      }
      return next
    }),
  }
}

export function reverseCanvasArrow(scene: CanvasScene, arrowId: string): CanvasScene {
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type !== 'arrow' || item.id !== arrowId) return item
      return {
        ...item,
        from: item.to,
        to: item.from,
        fromAnchor: item.toAnchor,
        toAnchor: item.fromAnchor,
        fromPortRatio: item.toPortRatio,
        toPortRatio: item.fromPortRatio,
        points: item.points?.slice().reverse(),
        bundleKey: undefined,
      }
    }),
  }
}

export function insertCanvasNodeOnArrow(scene: CanvasScene, nodeId: string, arrowId: string): { scene: CanvasScene; newArrowId?: string } {
  const node = scene.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === nodeId)
  const arrow = scene.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === arrowId)
  if (!node || !arrow || arrow.from === nodeId || arrow.to === nodeId) return { scene }
  const newArrowId = nextCanvasElementId('arrow', scene.elements)
  const first: CanvasArrow = {
    ...arrow,
    to: nodeId,
    toAnchor: undefined,
    toPortRatio: undefined,
    points: undefined,
    bundleKey: undefined,
    labelPosition: undefined,
  }
  const second: CanvasArrow = {
    ...arrow,
    id: newArrowId,
    from: nodeId,
    fromAnchor: undefined,
    fromPortRatio: undefined,
    label: undefined,
    labelPosition: undefined,
    points: undefined,
    bundleKey: undefined,
  }
  return {
    scene: {
      ...scene,
      elements: scene.elements.flatMap((item) => item.id === arrowId ? [first, second] : [item]),
    },
    newArrowId,
  }
}

export function alignCanvasSelection(scene: CanvasScene, ids: string[], axis: 'x' | 'y', grid = 16): CanvasScene {
  const chosen = scene.elements.filter((item): item is CanvasNode | CanvasNote => ids.includes(item.id) && item.type !== 'arrow' && !item.locked)
  if (chosen.length < 2) return scene
  const extent = axis === 'x'
    ? Math.max(...chosen.map((item) => item.width))
    : Math.max(...chosen.map((item) => item.height))
  const average = axis === 'x'
    ? chosen.reduce((sum, item) => sum + item.x + item.width / 2, 0) / chosen.length
    : chosen.reduce((sum, item) => sum + item.y + item.height / 2, 0) / chosen.length
  const limit = axis === 'x' ? scene.width : scene.height
  // 对齐的目标是共同中心线，因此只对中心吸附一次。逐项吸附边缘会让不同尺寸的节点重新错开。
  // 边界也按中心计算：最大尺寸的节点放得下，其余节点必然放得下，无需逐项 clamp。
  const target = clamp(snap(average, grid), extent / 2, Math.max(extent / 2, limit - extent / 2))
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow' || !ids.includes(item.id) || item.locked) return item
      return axis === 'x'
        ? { ...item, x: target - item.width / 2 }
        : { ...item, y: target - item.height / 2 }
    }),
  }
}

export function distributeCanvasSelection(scene: CanvasScene, ids: string[], axis: 'x' | 'y', grid = 16): CanvasScene {
  const chosen = scene.elements
    .filter((item): item is CanvasNode | CanvasNote => ids.includes(item.id) && item.type !== 'arrow' && !item.locked)
    .sort((a, b) => axis === 'x' ? a.x - b.x : a.y - b.y)
  if (chosen.length < 3) return scene

  const first = chosen[0]
  const last = chosen[chosen.length - 1]
  const firstCenter = axis === 'x' ? first.x + first.width / 2 : first.y + first.height / 2
  const lastCenter = axis === 'x' ? last.x + last.width / 2 : last.y + last.height / 2
  const step = (lastCenter - firstCenter) / (chosen.length - 1)
  const positions = new Map<string, number>()
  chosen.forEach((item, index) => {
    const center = firstCenter + step * index
    const value = axis === 'x' ? center - item.width / 2 : center - item.height / 2
    positions.set(item.id, snap(value, grid))
  })

  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') return item
      const next = positions.get(item.id)
      if (next === undefined) return item
      return axis === 'x'
        ? { ...item, x: clamp(next, 0, scene.width - item.width) }
        : { ...item, y: clamp(next, 0, scene.height - item.height) }
    }),
  }
}

export function separateCanvasSelection(scene: CanvasScene, ids: string[], padding = 24, grid = 16): CanvasScene {
  const selected = new Set(ids)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const positions = new Map(boxes.map((item) => [item.id, { x: item.x, y: item.y }]))
  const movable = boxes.filter((item) => selected.has(item.id) && !item.locked)
  if (!movable.length) return scene

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false
    for (const item of movable) {
      const position = positions.get(item.id)!
      for (const other of boxes) {
        if (other.id === item.id) continue
        const otherPosition = positions.get(other.id)!
        const left = position.x
        const right = position.x + item.width
        const top = position.y
        const bottom = position.y + item.height
        const otherLeft = otherPosition.x
        const otherRight = otherPosition.x + other.width
        const otherTop = otherPosition.y
        const otherBottom = otherPosition.y + other.height
        if (right + padding <= otherLeft || left >= otherRight + padding || bottom + padding <= otherTop || top >= otherBottom + padding) continue

        const candidates = [
          { axis: 'x' as const, delta: otherLeft - padding - right },
          { axis: 'x' as const, delta: otherRight + padding - left },
          { axis: 'y' as const, delta: otherTop - padding - bottom },
          { axis: 'y' as const, delta: otherBottom + padding - top },
        ].sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))

        const choice = candidates.find((candidate) => {
          const nextX = candidate.axis === 'x' ? position.x + candidate.delta : position.x
          const nextY = candidate.axis === 'y' ? position.y + candidate.delta : position.y
          return nextX >= 0 && nextY >= 0 && nextX + item.width <= scene.width && nextY + item.height <= scene.height
        })
        if (!choice) continue
        if (choice.axis === 'x') position.x = snap(position.x + choice.delta, grid)
        else position.y = snap(position.y + choice.delta, grid)
        changed = true
      }
    }
    if (!changed) break
  }

  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow' || !selected.has(item.id) || item.locked) return item
      const position = positions.get(item.id)
      return position ? { ...item, x: clamp(position.x, 0, scene.width - item.width), y: clamp(position.y, 0, scene.height - item.height) } : item
    }),
  }
}

export interface CanvasNeighborhoodReflowResult {
  scene: CanvasScene
  movedIds: string[]
}

export interface CanvasNeighborhoodLayoutResult {
  scene: CanvasScene
  movedIds: string[]
  scopeIds: string[]
  mode: Exclude<CanvasLayoutMode, 'grid'>
}

export function layoutCanvasNeighborhood(
  scene: CanvasScene,
  seedIds: Iterable<string>,
  depth = 1,
  maxNodes = 42,
  grid = 16,
): CanvasNeighborhoodLayoutResult {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const boxById = new Map(boxes.map((item) => [item.id, item]))
  const seeds = [...new Set(seedIds)].filter((id) => boxById.has(id))
  const adjacency = new Map(boxes.map((item) => [item.id, new Set<string>()]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  arrows.forEach((arrow) => {
    adjacency.get(arrow.from)?.add(arrow.to)
    adjacency.get(arrow.to)?.add(arrow.from)
  })

  const scope = new Set(seeds)
  let frontier = [...seeds]
  const safeDepth = Math.max(0, Math.min(3, Math.floor(depth)))
  for (let level = 0; level < safeDepth && scope.size < maxNodes; level += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (scope.has(neighbor)) continue
        scope.add(neighbor)
        next.push(neighbor)
        if (scope.size >= maxNodes) break
      }
      if (scope.size >= maxNodes) break
    }
    frontier = next
  }
  const scopeIds = [...scope]
  if (scopeIds.length < 2) return { scene, movedIds: [], scopeIds, mode: 'horizontal' }

  const scopedBoxes = scopeIds.map((id) => boxById.get(id)!).filter(Boolean)
  const spreadX = Math.max(...scopedBoxes.map((item) => item.x + item.width / 2)) - Math.min(...scopedBoxes.map((item) => item.x + item.width / 2))
  const spreadY = Math.max(...scopedBoxes.map((item) => item.y + item.height / 2)) - Math.min(...scopedBoxes.map((item) => item.y + item.height / 2))
  let horizontalVotes = 0
  let verticalVotes = 0
  arrows.forEach((arrow) => {
    if (!scope.has(arrow.from) || !scope.has(arrow.to)) return
    const from = boxById.get(arrow.from)
    const to = boxById.get(arrow.to)
    if (!from || !to) return
    const dx = Math.abs((to.x + to.width / 2) - (from.x + from.width / 2))
    const dy = Math.abs((to.y + to.height / 2) - (from.y + from.height / 2))
    if (dx >= dy) horizontalVotes += 1
    else verticalVotes += 1
  })
  const mode: 'horizontal' | 'vertical' = horizontalVotes === verticalVotes
    ? spreadX >= spreadY ? 'horizontal' : 'vertical'
    : horizontalVotes > verticalVotes ? 'horizontal' : 'vertical'

  const seedBoxes = seeds.map((id) => boxById.get(id)!).filter(Boolean)
  const beforeCenter = centerOfBoxes(seedBoxes)
  let arranged = layoutCanvasSelection(scene, scopeIds, mode, grid)
  const arrangedById = new Map(arranged.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const afterCenter = centerOfBoxes(seeds.map((id) => arrangedById.get(id)!).filter(Boolean))
  if (beforeCenter && afterCenter) {
    const dx = beforeCenter.x - afterCenter.x
    const dy = beforeCenter.y - afterCenter.y
    arranged = {
      ...arranged,
      elements: arranged.elements.map((item) => {
        if (item.type === 'arrow' || !scope.has(item.id) || item.locked) return item
        return {
          ...item,
          x: clamp(snap(item.x + dx, grid), 0, arranged.width - item.width),
          y: clamp(snap(item.y + dy, grid), 0, arranged.height - item.height),
        }
      }),
    }
  }
  const reflow = reflowCanvasNeighborhood(arranged, scopeIds, 24, grid, Math.min(32, maxNodes))
  arranged = reflow.scene
  const beforeById = new Map(boxes.map((item) => [item.id, item]))
  const movedIds = arranged.elements.flatMap((item) => {
    if (item.type === 'arrow') return []
    const before = beforeById.get(item.id)
    return before && (before.x !== item.x || before.y !== item.y) ? [item.id] : []
  })
  return { scene: arranged, movedIds, scopeIds, mode }
}

export function reflowCanvasNeighborhood(
  scene: CanvasScene,
  anchorIds: Iterable<string>,
  padding = 24,
  grid = 16,
  maxAffected = 48,
): CanvasNeighborhoodReflowResult {
  const anchors = new Set(anchorIds)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const byId = new Map(boxes.map((item) => [item.id, item]))
  const positions = new Map(boxes.map((item) => [item.id, { x: item.x, y: item.y }]))
  const active = [...anchors].filter((id) => byId.has(id))
  const activeSet = new Set(active)
  const moved = new Set<string>()
  const laneById = new Map((scene.lanes ?? []).map((lane) => [lane.id, lane]))

  for (let cursor = 0; cursor < active.length && moved.size < maxAffected; cursor += 1) {
    const sourceId = active[cursor]
    const source = byId.get(sourceId)
    const sourcePosition = positions.get(sourceId)
    if (!source || !sourcePosition) continue
    let sourceRect = { ...source, ...sourcePosition }

    for (const other of boxes) {
      if (other.id === sourceId) continue
      const otherPosition = positions.get(other.id)!
      let otherRect = { ...other, ...otherPosition }
      if (!boxOverlapWithPadding(sourceRect, otherRect, padding)) continue

      const sourcePinned = anchors.has(sourceId) || Boolean(source.locked)
      const otherPinned = anchors.has(other.id) || Boolean(other.locked)
      if (sourcePinned && otherPinned) continue

      const mover = sourcePinned ? other : otherPinned ? source : other
      const stationary = mover.id === source.id ? otherRect : sourceRect
      const moverPosition = positions.get(mover.id)!
      const next = nearestNonOverlappingPosition(scene, mover, moverPosition, stationary, padding, grid, laneById)
      if (!next || (next.x === moverPosition.x && next.y === moverPosition.y)) continue
      positions.set(mover.id, next)
      if (!anchors.has(mover.id)) moved.add(mover.id)
      if (!activeSet.has(mover.id) && active.length < anchors.size + maxAffected) {
        active.push(mover.id)
        activeSet.add(mover.id)
      }
      if (mover.id === source.id) sourceRect = { ...source, ...next }
      else otherRect = { ...other, ...next }
      if (moved.size >= maxAffected) break
    }
  }

  if (!moved.size) return { scene, movedIds: [] }
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((item) => {
        if (item.type === 'arrow' || !moved.has(item.id)) return item
        const position = positions.get(item.id)
        return position ? { ...item, x: position.x, y: position.y } : item
      }),
    },
    movedIds: [...moved],
  }
}

function nearestNonOverlappingPosition(
  scene: CanvasScene,
  mover: CanvasNode | CanvasNote,
  current: { x: number; y: number },
  stationary: Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>,
  padding: number,
  grid: number,
  laneById: Map<string, CanvasLane>,
): { x: number; y: number } | null {
  const rawCandidates = [
    { x: stationary.x - padding - mover.width, y: current.y },
    { x: stationary.x + stationary.width + padding, y: current.y },
    { x: current.x, y: stationary.y - padding - mover.height },
    { x: current.x, y: stationary.y + stationary.height + padding },
  ]
  const rank = (positions: Array<{ x: number; y: number }>) => positions
    .filter((position, index, all) => all.findIndex((item) => item.x === position.x && item.y === position.y) === index)
    .sort((left, right) => (
      Math.abs(left.x - current.x) + Math.abs(left.y - current.y)
      - Math.abs(right.x - current.x) - Math.abs(right.y - current.y)
    ))
  const snapped = rank(rawCandidates.map((position) => constrainCanvasPosition(scene, mover, position, grid, laneById)))
  const snappedFit = snapped.find((position) => !boxOverlapWithPadding({ ...mover, ...position }, stationary, padding))
  if (snappedFit) return snappedFit
  // A nearest-grid rounding can move a node a few pixels back into the safety
  // gap. Prefer the exact collision-free boundary over violating padding.
  const exact = rank(rawCandidates.map((position) => constrainCanvasPosition(scene, mover, position, 1, laneById)))
  return exact.find((position) => !boxOverlapWithPadding({ ...mover, ...position }, stationary, padding)) ?? null
}

function constrainCanvasPosition(
  scene: CanvasScene,
  item: CanvasNode | CanvasNote,
  position: { x: number; y: number },
  grid: number,
  laneById: Map<string, CanvasLane>,
) {
  let minX = 0
  let minY = 0
  let maxX = Math.max(0, scene.width - item.width)
  let maxY = Math.max(0, scene.height - item.height)
  const lane = item.laneId ? laneById.get(item.laneId) : undefined
  if (lane?.axis === 'vertical') {
    minX = Math.max(minX, lane.start + 8)
    maxX = Math.min(maxX, lane.start + lane.size - item.width - 8)
  } else if (lane?.axis === 'horizontal') {
    minY = Math.max(minY, lane.start + 8)
    maxY = Math.min(maxY, lane.start + lane.size - item.height - 8)
  }
  if (maxX < minX) { minX = 0; maxX = Math.max(0, scene.width - item.width) }
  if (maxY < minY) { minY = 0; maxY = Math.max(0, scene.height - item.height) }
  return {
    x: clamp(snap(position.x, grid), minX, maxX),
    y: clamp(snap(position.y, grid), minY, maxY),
  }
}

function boxOverlapWithPadding(
  left: Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>,
  right: Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>,
  padding: number,
) {
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y
}

function centerOfBoxes(boxes: Array<CanvasNode | CanvasNote>): { x: number; y: number } | null {
  if (!boxes.length) return null
  return {
    x: boxes.reduce((sum, item) => sum + item.x + item.width / 2, 0) / boxes.length,
    y: boxes.reduce((sum, item) => sum + item.y + item.height / 2, 0) / boxes.length,
  }
}

export function reorderCanvasSelection(scene: CanvasScene, ids: string[], direction: 'front' | 'back' | 'forward' | 'backward'): CanvasScene {
  const selected = new Set(ids)
  const arrows = scene.elements.filter((item) => item.type === 'arrow')
  const boxes = scene.elements.filter((item) => item.type !== 'arrow')
  const chosen = boxes.filter((item) => selected.has(item.id))
  if (chosen.length === 0) return scene
  const rest = boxes.filter((item) => !selected.has(item.id))
  if (direction === 'forward' || direction === 'backward') {
    const ordered = [...boxes]
    if (direction === 'forward') {
      for (let index = ordered.length - 2; index >= 0; index -= 1) {
        if (selected.has(ordered[index].id) && !selected.has(ordered[index + 1].id)) {
          ;[ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]]
        }
      }
    } else {
      for (let index = 1; index < ordered.length; index += 1) {
        if (selected.has(ordered[index].id) && !selected.has(ordered[index - 1].id)) {
          ;[ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]]
        }
      }
    }
    return { ...scene, elements: [...arrows, ...ordered] }
  }
  return {
    ...scene,
    elements: direction === 'front'
      ? [...arrows, ...rest, ...chosen]
      : [...arrows, ...chosen, ...rest],
  }
}

export function groupCanvasSelection(scene: CanvasScene, ids: string[]): { scene: CanvasScene; groupId?: string } {
  const chosen = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && ids.includes(item.id))
  if (chosen.length < 2) return { scene }
  const existing = chosen.map((item) => item.groupId).filter((value): value is string => Boolean(value))
  const groupId = existing.length === chosen.length && existing.every((value) => value === existing[0])
    ? existing[0]
    : nextCanvasGroupId(scene)
  return {
    groupId,
    scene: {
      ...scene,
      elements: scene.elements.map((item) => item.type !== 'arrow' && ids.includes(item.id) ? { ...item, groupId } : item),
      groups: upsertCanvasGroup(scene.groups, { id: groupId, label: scene.groups?.find((group) => group.id === groupId)?.label ?? `Group ${groupId.replace(/^group-/, '')}` }),
    },
  }
}

export function ungroupCanvasSelection(scene: CanvasScene, ids: string[]): CanvasScene {
  const groupIds = new Set(scene.elements
    .filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && ids.includes(item.id) && Boolean(item.groupId))
    .map((item) => item.groupId!))
  if (groupIds.size === 0) return scene
  const nextElements = scene.elements.map((item) => {
    if (item.type === 'arrow' || !item.groupId || !groupIds.has(item.groupId)) return item
    const { groupId: _groupId, ...rest } = item
    return rest
  })
  const stillUsed = new Set(nextElements.flatMap((item) => item.type !== 'arrow' && 'groupId' in item && item.groupId ? [item.groupId] : []))
  return {
    ...scene,
    elements: nextElements,
    groups: scene.groups?.filter((group) => !groupIds.has(group.id) || stillUsed.has(group.id)),
  }
}

export function updateCanvasGroup(scene: CanvasScene, groupId: string, patch: Partial<Omit<CanvasGroup, 'id'>>): CanvasScene {
  return { ...scene, groups: upsertCanvasGroup(scene.groups, { id: groupId, ...patch }) }
}

export type CanvasC4CollapseLevel = 'expanded' | 'container' | 'system'

export function setCanvasC4CollapseLevel(scene: CanvasScene, level: CanvasC4CollapseLevel): CanvasScene {
  if (!scene.groups?.length) return scene
  return {
    ...scene,
    groups: scene.groups.map((group) => {
      if (!group.c4Type) return group
      const collapsed = level === 'system'
        ? group.c4Type === 'software-system'
        : level === 'container'
          ? group.c4Type === 'container'
          : false
      if (collapsed) return { ...group, collapsed: true }
      if (!group.collapsed) return group
      const { collapsed: _collapsed, ...rest } = group
      return rest
    }),
  }
}

export function setCanvasGroupParent(scene: CanvasScene, groupId: string, parentId?: string): CanvasScene {
  if (parentId === groupId) return scene
  const groups = scene.groups ?? []
  if (!groups.some((group) => group.id === groupId)) return scene
  if (parentId && !groups.some((group) => group.id === parentId)) return scene
  if (parentId) {
    let current: string | undefined = parentId
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      if (current === groupId) return scene
      seen.add(current)
      current = groups.find((group) => group.id === current)?.parentId
    }
  }
  return {
    ...scene,
    groups: groups.map((group) => {
      if (group.id !== groupId) return group
      if (parentId) return { ...group, parentId }
      const { parentId: _parentId, ...rest } = group
      return rest
    }),
  }
}

export type CanvasLayoutMode = 'horizontal' | 'vertical' | 'grid'
export type CanvasArchitectureTemplate = 'web-service' | 'event-driven' | 'cache-aside'
export type CanvasTraceDirection = 'upstream' | 'downstream' | 'both'

export function insertCanvasArchitectureNodeTemplate(
  scene: CanvasScene,
  template: ArchitectureNodeTemplate,
  center?: { x: number; y: number },
  explicitGroupId?: string,
): { scene: CanvasScene; selectedIds: string[] } {
  const width = template.width ?? 188
  const height = template.height ?? 80
  const fallbackIndex = scene.elements.filter((item) => item.type !== 'arrow').length
  const target = center ?? {
    x: 150 + (fallbackIndex % 4) * 40 + width / 2,
    y: 140 + (fallbackIndex % 5) * 36 + height / 2,
  }
  const groupId = explicitGroupId && scene.groups?.some((group) => group.id === explicitGroupId)
    ? explicitGroupId
    : template.groupId && scene.groups?.some((group) => group.id === template.groupId)
      ? template.groupId
      : undefined
  const id = nextCanvasElementId('node', scene.elements)
  const node: CanvasNode = {
    id,
    type: 'node',
    x: clamp(target.x - width / 2, 0, Math.max(0, scene.width - width)),
    y: clamp(target.y - height / 2, 0, Math.max(0, scene.height - height)),
    width,
    height,
    text: template.label,
    subtitle: template.subtitle,
    icon: template.icon,
    ...(template.stencil ? { stencil: template.stencil } : {}),
    ...(template.iconRef ? { iconRef: template.iconRef } : {}),
    ...(template.tone ? { tone: template.tone } : {}),
    ...(groupId ? { groupId } : {}),
    emphasis: 'secondary',
  }
  return { scene: { ...scene, elements: [...scene.elements, node] }, selectedIds: [id] }
}

export interface CanvasTraceResult {
  nodeIds: string[]
  arrowIds: string[]
  distanceById: Record<string, number>
}

export function traceCanvasGraph(scene: CanvasScene, seedIds: string[], direction: CanvasTraceDirection, depth = 1): CanvasTraceResult {
  const nodes = new Set(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => item.id))
  const seeds = [...new Set(seedIds.filter((id) => nodes.has(id)))]
  const maxDepth = Math.max(1, Math.min(8, Math.floor(depth)))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const outgoing = new Map<string, Array<{ nodeId: string; arrowId: string }>>()
  const incoming = new Map<string, Array<{ nodeId: string; arrowId: string }>>()
  arrows.forEach((arrow) => {
    const out = outgoing.get(arrow.from) ?? []
    out.push({ nodeId: arrow.to, arrowId: arrow.id })
    outgoing.set(arrow.from, out)
    const inc = incoming.get(arrow.to) ?? []
    inc.push({ nodeId: arrow.from, arrowId: arrow.id })
    incoming.set(arrow.to, inc)
  })
  const distance = new Map<string, number>(seeds.map((id) => [id, 0]))
  const queue = [...seeds]
  const arrowIds = new Set<string>()

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const currentDepth = distance.get(current) ?? 0
    if (currentDepth >= maxDepth) continue
    const candidates = [
      ...(direction === 'downstream' || direction === 'both' ? outgoing.get(current) ?? [] : []),
      ...(direction === 'upstream' || direction === 'both' ? incoming.get(current) ?? [] : []),
    ]
    for (const candidate of candidates) {
      if (!nodes.has(candidate.nodeId)) continue
      arrowIds.add(candidate.arrowId)
      const nextDepth = currentDepth + 1
      if ((distance.get(candidate.nodeId) ?? Number.POSITIVE_INFINITY) <= nextDepth) continue
      distance.set(candidate.nodeId, nextDepth)
      queue.push(candidate.nodeId)
    }
  }

  const nodeIds = [...distance.keys()]
  // Include internal relationships between visible traced nodes, even when a shorter
  // traversal path reached those nodes through another edge.
  const tracedNodes = new Set(nodeIds)
  arrows.forEach((arrow) => {
    if (tracedNodes.has(arrow.from) && tracedNodes.has(arrow.to)) arrowIds.add(arrow.id)
  })
  return {
    nodeIds,
    arrowIds: [...arrowIds],
    distanceById: Object.fromEntries(distance),
  }
}

export function insertCanvasArchitectureTemplate(scene: CanvasScene, template: CanvasArchitectureTemplate): { scene: CanvasScene; selectedIds: string[] } {
  const used: CanvasElement[] = [...scene.elements]
  const existingBoxes = scene.elements.filter((item) => item.type !== 'arrow').length
  const originX = 120 + (existingBoxes % 3) * 48
  const originY = 120 + (existingBoxes % 4) * 42
  const added: CanvasElement[] = []
  const node = (text: string, x: number, y: number, icon: CanvasIcon, stencil?: CanvasStencil, subtitle?: string, c4Type: CanvasC4Type = 'container') => {
    const id = nextCanvasElementId('node', [...used, ...added])
    added.push({ id, type: 'node', x: originX + x, y: originY + y, width: 210, height: 92, text, icon, stencil, subtitle, c4Type, tone: 'default' })
    return id
  }
  const arrow = (from: string, to: string, label?: string) => {
    const id = nextCanvasElementId('arrow', [...used, ...added])
    added.push({ id, type: 'arrow', from, to, label, routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left' })
  }

  if (template === 'web-service') {
    const web = node('Web App', 0, 140, 'web', 'react', 'UI / Client')
    const api = node('API Gateway', 300, 140, 'api', undefined, 'HTTP / Auth')
    const service = node('Application Service', 600, 140, 'service', 'spring', 'Business Logic')
    const db = node('Database', 900, 40, 'database', 'postgres')
    const cache = node('Cache', 900, 240, 'cache', 'redis')
    arrow(web, api, 'HTTPS')
    arrow(api, service, 'request')
    arrow(service, db, 'read/write')
    arrow(service, cache, 'cache')
  } else if (template === 'event-driven') {
    const producer = node('Producer Service', 0, 140, 'service', 'spring')
    const broker = node('Event Bus', 330, 140, 'queue', 'kafka')
    const consumer = node('Consumer Service', 660, 60, 'service', 'spring')
    const worker = node('Async Worker', 660, 240, 'service')
    const store = node('State Store', 960, 140, 'database', 'postgres')
    arrow(producer, broker, 'publish')
    arrow(broker, consumer, 'consume')
    arrow(broker, worker, 'consume')
    arrow(consumer, store, 'persist')
    arrow(worker, store, 'persist')
  } else {
    const client = node('Client', 0, 140, 'web', undefined, undefined, 'person')
    const service = node('Application Service', 300, 140, 'service', 'spring')
    const cache = node('Cache', 620, 40, 'cache', 'redis')
    const db = node('Database', 620, 240, 'database', 'postgres')
    arrow(client, service, 'request')
    arrow(service, cache, 'lookup')
    arrow(service, db, 'fallback')
  }

  const nodeIds = added.filter((item) => item.type !== 'arrow').map((item) => item.id)
  return { scene: { ...scene, elements: [...scene.elements, ...added] }, selectedIds: nodeIds }
}

export function layoutCanvasScene(scene: CanvasScene, mode: CanvasLayoutMode, grid = 16): CanvasScene {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const mutable = boxes.filter((item) => !item.locked)
  if (mutable.length < 2) return scene

  if (scene.lanes?.length) return layoutCanvasWithinLanes(scene, mode, grid)

  if (mode === 'grid') {
    const columns = Math.max(2, Math.ceil(Math.sqrt(mutable.length)))
    const positions = new Map<string, { x: number; y: number }>()
    mutable.forEach((item, index) => {
      positions.set(item.id, {
        x: snap(96 + (index % columns) * 300, grid),
        y: snap(96 + Math.floor(index / columns) * 190, grid),
      })
    })
    return applyLayoutPositions(scene, positions)
  }

  const mutableIds = new Set(mutable.map((item) => item.id))
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  mutable.forEach((item) => {
    incoming.set(item.id, 0)
    outgoing.set(item.id, [])
  })
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow' || item.from === item.to || !mutableIds.has(item.from) || !mutableIds.has(item.to)) return
    incoming.set(item.to, (incoming.get(item.to) ?? 0) + 1)
    outgoing.get(item.from)?.push(item.to)
  })
  const layerById = new Map<string, number>()
  const queue = mutable.filter((item) => (incoming.get(item.id) ?? 0) === 0).map((item) => item.id)
  if (queue.length === 0) queue.push(mutable[0].id)
  queue.forEach((id) => layerById.set(id, 0))
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]
    const base = layerById.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      layerById.set(next, Math.max(layerById.get(next) ?? 0, base + 1))
      incoming.set(next, Math.max(0, (incoming.get(next) ?? 0) - 1))
      if ((incoming.get(next) ?? 0) === 0) queue.push(next)
    }
  }
  let fallbackLayer = Math.max(0, ...layerById.values()) + 1
  mutable.forEach((item) => {
    if (!layerById.has(item.id)) layerById.set(item.id, fallbackLayer++)
  })

  const layers = new Map<number, Array<CanvasNode | CanvasNote>>()
  mutable.forEach((item) => {
    const layer = layerById.get(item.id) ?? 0
    const entries = layers.get(layer) ?? []
    entries.push(item)
    layers.set(layer, entries)
  })
  const positions = new Map<string, { x: number; y: number }>()
  ;[...layers.entries()].sort(([a], [b]) => a - b).forEach(([layer, items]) => {
    items.sort((a, b) => a.y - b.y || a.x - b.x)
    items.forEach((item, index) => {
      positions.set(item.id, mode === 'horizontal'
        ? { x: snap(96 + layer * 330, grid), y: snap(96 + index * 170, grid) }
        : { x: snap(96 + index * 330, grid), y: snap(96 + layer * 170, grid) })
    })
  })
  return applyLayoutPositions(scene, positions)
}

export function layoutCanvasSelection(scene: CanvasScene, ids: string[], mode: CanvasLayoutMode, grid = 16): CanvasScene {
  const selected = new Set(ids)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && selected.has(item.id) && !item.locked)
  if (boxes.length < 2) return scene
  const minX = Math.min(...boxes.map((item) => item.x))
  const minY = Math.min(...boxes.map((item) => item.y))
  const subsetElements = scene.elements.filter((item) => (
    item.type !== 'arrow'
      ? selected.has(item.id)
      : selected.has(item.from) && selected.has(item.to)
  ))
  const arranged = layoutCanvasScene({ ...scene, elements: subsetElements, groups: undefined, lanes: undefined }, mode, grid)
  const arrangedBoxes = arranged.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrangedMinX = Math.min(...arrangedBoxes.map((item) => item.x))
  const arrangedMinY = Math.min(...arrangedBoxes.map((item) => item.y))
  const moved = new Map(arrangedBoxes.map((item) => [item.id, {
    x: clamp(item.x - arrangedMinX + minX, 0, scene.width - item.width),
    y: clamp(item.y - arrangedMinY + minY, 0, scene.height - item.height),
  }]))
  return applyLayoutPositions(scene, moved)
}

export function createCanvasLanePreset(scene: CanvasScene, axis: CanvasLaneAxis, count = 3): CanvasScene {
  const safeCount = Math.max(2, Math.min(6, Math.floor(count)))
  const extent = axis === 'horizontal' ? scene.height : scene.width
  const size = extent / safeCount
  const lanes: CanvasLane[] = Array.from({ length: safeCount }, (_, index) => ({
    id: `lane-${axis}-${index + 1}`,
    label: `Lane ${index + 1}`,
    axis,
    start: index * size,
    size,
    tone: index % 2 === 0 ? 'muted' : 'default',
  }))
  const elements = scene.elements.map((item) => {
    if (item.type === 'arrow') return item
    const center = axis === 'horizontal' ? item.y + item.height / 2 : item.x + item.width / 2
    const lane = lanes[Math.min(safeCount - 1, Math.max(0, Math.floor(center / size)))]
    return { ...item, laneId: lane.id }
  })
  return { ...scene, lanes, elements }
}

export function clearCanvasLanes(scene: CanvasScene): CanvasScene {
  return {
    ...scene,
    lanes: undefined,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow' || !item.laneId) return item
      const { laneId: _laneId, ...rest } = item
      return rest
    }),
  }
}

export function assignCanvasSelectionToLane(scene: CanvasScene, ids: string[], laneId?: string): CanvasScene {
  const allowed = laneId ? scene.lanes?.some((lane) => lane.id === laneId) : true
  if (!allowed) return scene
  const selected = new Set(ids)
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow' || !selected.has(item.id) || item.locked) return item
      if (laneId) return { ...item, laneId }
      const { laneId: _laneId, ...rest } = item
      return rest
    }),
  }
}

export function updateCanvasLane(scene: CanvasScene, laneId: string, patch: Partial<Omit<CanvasLane, 'id'>>): CanvasScene {
  if (!scene.lanes?.some((lane) => lane.id === laneId)) return scene
  return {
    ...scene,
    lanes: scene.lanes.map((lane) => lane.id === laneId ? { ...lane, ...patch, id: lane.id } : lane),
  }
}

export function expandCanvasGroupSelection(scene: CanvasScene, ids: string[]): string[] {
  const groups = new Set(scene.elements
    .filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && ids.includes(item.id) && Boolean(item.groupId))
    .map((item) => item.groupId!))
  if (groups.size === 0) return ids
  const result = new Set(ids)
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow' && item.groupId && groups.has(item.groupId)) result.add(item.id)
  })
  return [...result]
}

export function nextCanvasGroupId(scene: CanvasScene, reserved: string[] = []): string {
  const used = new Set([
    ...reserved,
    ...(scene.groups ?? []).map((group) => group.id),
    ...scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && Boolean(item.groupId)).map((item) => item.groupId!),
  ])
  for (let index = 1; index < 100_000; index += 1) {
    const id = `group-${index}`
    if (!used.has(id)) return id
  }
  return `group-${Date.now()}`
}

export function nextCanvasElementId(prefix: string, elements: Array<Pick<CanvasElement, 'id'>>): string {
  const used = new Set(elements.map((item) => item.id))
  for (let index = 1; index < 100_000; index += 1) {
    const id = `${prefix}-${index}`
    if (!used.has(id)) return id
  }
  return `${prefix}-${Date.now()}`
}

function snap(value: number, grid: number) {
  return Math.round(value / grid) * grid
}

function applyLayoutPositions(scene: CanvasScene, positions: Map<string, { x: number; y: number }>): CanvasScene {
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow' || item.locked) return item
      const position = positions.get(item.id)
      if (!position) return item
      return {
        ...item,
        x: clamp(position.x, 0, scene.width - item.width),
        y: clamp(position.y, 0, scene.height - item.height),
      }
    }),
  }
}

function layoutCanvasWithinLanes(scene: CanvasScene, mode: CanvasLayoutMode, grid: number): CanvasScene {
  const lanes = scene.lanes ?? []
  const positions = new Map<string, { x: number; y: number }>()
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && !item.locked)
  for (const lane of lanes) {
    const members = boxes.filter((item) => item.laneId === lane.id)
    if (!members.length) continue
    const columns = mode === 'grid' ? Math.max(1, Math.ceil(Math.sqrt(members.length))) : mode === 'horizontal' ? members.length : 1
    members.forEach((item, index) => {
      if (lane.axis === 'horizontal') {
        const usableWidth = Math.max(220, scene.width - 160)
        const cellWidth = usableWidth / Math.max(1, columns)
        const row = Math.floor(index / columns)
        const col = index % columns
        positions.set(item.id, {
          x: snap(80 + col * cellWidth + Math.max(0, (cellWidth - item.width) / 2), grid),
          y: snap(lane.start + 46 + row * 140, grid),
        })
      } else {
        const rows = mode === 'vertical' ? members.length : Math.max(1, Math.ceil(members.length / columns))
        const usableHeight = Math.max(160, scene.height - 120)
        const cellHeight = usableHeight / Math.max(1, rows)
        const col = mode === 'vertical' ? 0 : index % columns
        const row = mode === 'vertical' ? index : Math.floor(index / columns)
        positions.set(item.id, {
          x: snap(lane.start + 34 + col * 240, grid),
          y: snap(60 + row * cellHeight + Math.max(0, (cellHeight - item.height) / 2), grid),
        })
      }
    })
  }
  return applyLayoutPositions(scene, positions)
}

function upsertCanvasGroup(groups: CanvasGroup[] | undefined, next: CanvasGroup): CanvasGroup[] {
  const current = groups ?? []
  return current.some((group) => group.id === next.id)
    ? current.map((group) => group.id === next.id ? { ...group, ...next } : group)
    : [...current, next]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
