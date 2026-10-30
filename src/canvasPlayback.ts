import { canvasGroupFrames, canvasCollapsedOwners, canvasIconLabel, canvasStencilLabel, canvasIconRefLabel, c4Label, type CanvasScene, type CanvasNode, type CanvasNote, type CanvasArrow, type CanvasPoint, type CanvasGroupFrame, type CanvasElement, type CanvasIcon, type CanvasStencil, type CanvasIconRef, type CanvasC4Type } from './canvas.js'

export type CanvasPlaybackPhase = 'planning' | 'transitioning' | 'placing' | 'typing' | 'selecting' | 'grouping' | 'styling' | 'connecting' | 'arranging' | 'finishing'

export type CanvasPlaybackAction =
  | { kind: 'box'; id: string; added: boolean; before?: CanvasNode | CanvasNote; rough?: CanvasPoint; regionKey: string }
  | { kind: 'arrange'; ids: string[]; regionKey: string }
  | { kind: 'boundary'; groupId: string; regionKey: string; beforeRect?: { x: number; y: number; width: number; height: number } }
  | { kind: 'style'; id: string; rows: Array<{ label: string; value: string }>; regionKey: string }
  | { kind: 'arrow'; id: string; added: boolean; before?: CanvasArrow; regionKey: string }
  | { kind: 'delete'; element: CanvasElement; regionKey: string }

export type CanvasPlaybackRegion = {
  key: string
  label: string
  elementIds: string[]
  center: CanvasPoint
  width: number
  height: number
}

export function buildCanvasPlaybackPlan(previous: CanvasScene | undefined, next: CanvasScene, mode: 'create' | 'update'): {
  initialVisibleIds: string[]
  initialVisibleGroupIds: string[]
  initialPositionOverrides: Record<string, CanvasPoint>
  initialBoxOverrides: Record<string, CanvasNode | CanvasNote>
  initialArrowOverrides: Record<string, CanvasArrow>
  initialGroupFrameOverrides: Record<string, CanvasGroupFrame>
  ghostElements: CanvasElement[]
  actions: CanvasPlaybackAction[]
  regions: CanvasPlaybackRegion[]
} {
  const previousById = new Map(previous?.elements.map((item) => [item.id, item]) ?? [])
  const nextById = new Map(next.elements.map((item) => [item.id, item]))
  const nextIds = new Set(next.elements.map((item) => item.id))
  const removedElements = previous?.elements.filter((item) => !nextIds.has(item.id)) ?? []
  const previousGroups = new Map(previous?.groups?.map((group) => [group.id, group]) ?? [])
  const previousGroupFrames = new Map((previous ? canvasGroupFrames(previous) : []).map((group) => [group.id, group]))
  const changed = new Set<string>()
  const added = new Set<string>()
  for (const item of next.elements) {
    const before = previousById.get(item.id)
    if (!before) added.add(item.id)
    else if (JSON.stringify(before) !== JSON.stringify(item)) changed.add(item.id)
  }
  const orderedBoxes = playbackBoxOrder(next)
  const regionByBoxId = new Map<string, string>()
  const regions = buildCanvasPlaybackRegions(next)
  regions.forEach((region) => region.elementIds.forEach((id) => regionByBoxId.set(id, region.key)))
  const collapsedOwners = canvasCollapsedOwners(next)
  const regionOrderIndex = new Map(regions.map((region, index) => [region.key, index]))
  const arrowRegionKey = (arrow: CanvasArrow) => {
    const fromRegion = regionByBoxId.get(arrow.from)
    const toRegion = regionByBoxId.get(arrow.to)
    if (!fromRegion) return toRegion ?? 'canvas'
    if (!toRegion) return fromRegion
    return (regionOrderIndex.get(toRegion) ?? -1) >= (regionOrderIndex.get(fromRegion) ?? -1) ? toRegion : fromRegion
  }
  const changedArrows = next.elements.filter((item): item is CanvasArrow => (
    item.type === 'arrow'
    && (added.has(item.id) || changed.has(item.id))
    && !collapsedOwners.has(item.from)
    && !collapsedOwners.has(item.to)
  ))
  const nextGroups = new Map((next.groups ?? []).map((group) => [group.id, group]))
  const nextGroupFrames = new Map(canvasGroupFrames(next).map((group) => [group.id, group]))
  const initialPositionOverrides: Record<string, CanvasPoint> = {}
  const initialBoxOverrides: Record<string, CanvasNode | CanvasNote> = {}
  const initialArrowOverrides: Record<string, CanvasArrow> = {}
  const initialGroupFrameOverrides: Record<string, CanvasGroupFrame> = {}
  next.elements.forEach((item) => {
    const before = previousById.get(item.id)
    if (!before || !changed.has(item.id)) return
    if (item.type === 'arrow') {
      if (before.type === 'arrow') initialArrowOverrides[item.id] = before
      return
    }
    if (before.type !== 'arrow') {
      initialBoxOverrides[item.id] = before
      if (before.x !== item.x || before.y !== item.y) initialPositionOverrides[item.id] = { x: before.x, y: before.y }
    }
  })
  for (const [groupId, beforeFrame] of previousGroupFrames) {
    const afterFrame = nextGroupFrames.get(groupId)
    const before = previousGroups.get(groupId)
    const after = nextGroups.get(groupId)
    if (!afterFrame || !after) continue
    const changedMetadata = JSON.stringify(before) !== JSON.stringify(after)
    const changedFrame = beforeFrame.x !== afterFrame.x || beforeFrame.y !== afterFrame.y || beforeFrame.width !== afterFrame.width || beforeFrame.height !== afterFrame.height
    if (changedMetadata || changedFrame) initialGroupFrameOverrides[groupId] = beforeFrame
  }

  const actions: CanvasPlaybackAction[] = []
  for (const region of regions) {
    const regionIds = new Set(region.elementIds)
    const boxIds = orderedBoxes.filter((id) => regionIds.has(id) && !collapsedOwners.has(id) && (added.has(id) || changed.has(id)))
    const addedBoxes = boxIds.filter((id) => added.has(id))
    const roughById = new Map<string, CanvasPoint>()
    addedBoxes.forEach((id, index) => {
      const candidate = nextById.get(id)
      const item = candidate && candidate.type !== 'arrow' ? candidate : undefined
      if (item) roughById.set(id, playbackRoughPosition(next, region, index, addedBoxes.length, item))
    })

    for (const id of boxIds) {
      const before = previousById.get(id)
      actions.push({
        kind: 'box',
        id,
        added: added.has(id),
        regionKey: region.key,
        ...(roughById.has(id) ? { rough: roughById.get(id) } : {}),
        ...(before && before.type !== 'arrow' ? { before } : {}),
      })
    }

    const arrangeIds = boxIds.filter((id) => {
      if (added.has(id)) return true
      const before = previousById.get(id)
      const after = nextById.get(id)
      return Boolean(before && before.type !== 'arrow' && after && after.type !== 'arrow' && (before.x !== after.x || before.y !== after.y))
    })
    if (arrangeIds.length) {
      actions.push({ kind: 'arrange', ids: arrangeIds, regionKey: region.key })
    }

    if (region.key.startsWith('group:')) {
      const groupId = region.key.slice('group:'.length)
      const group = nextGroups.get(groupId)
      const before = previousGroups.get(groupId)
      const beforeFrame = previousGroupFrames.get(groupId)
      const afterFrame = nextGroupFrames.get(groupId)
      const frameChanged = Boolean(beforeFrame && afterFrame && (
        beforeFrame.x !== afterFrame.x || beforeFrame.y !== afterFrame.y || beforeFrame.width !== afterFrame.width || beforeFrame.height !== afterFrame.height
      ))
      if (group && (!before || JSON.stringify(before) !== JSON.stringify(group) || frameChanged)) {
        actions.push({
          kind: 'boundary',
          groupId,
          regionKey: region.key,
          ...(beforeFrame ? { beforeRect: { x: beforeFrame.x, y: beforeFrame.y, width: beforeFrame.width, height: beforeFrame.height } } : {}),
        })
      }
    }

    for (const id of boxIds) {
      const candidate = nextById.get(id)
      const after = candidate && candidate.type !== 'arrow' ? candidate : undefined
      if (!after) continue
      const before = previousById.get(id)
      const rows = playbackStyleRows(before && before.type !== 'arrow' ? before : undefined, after)
      if (rows.length) actions.push({ kind: 'style', id, rows, regionKey: region.key })
    }

    changedArrows
      .filter((arrow) => arrowRegionKey(arrow) === region.key)
      .forEach((arrow) => {
        const before = previousById.get(arrow.id)
        actions.push({
          kind: 'arrow',
          id: arrow.id,
          added: added.has(arrow.id),
          regionKey: region.key,
          ...(before?.type === 'arrow' ? { before } : {}),
        })
      })
  }

  const knownRegionKeys = new Set(regions.map((region) => region.key))
  changedArrows
    .filter((arrow) => !knownRegionKeys.has(arrowRegionKey(arrow)))
    .forEach((arrow) => {
      const before = previousById.get(arrow.id)
      actions.push({ kind: 'arrow', id: arrow.id, added: added.has(arrow.id), regionKey: 'canvas', ...(before?.type === 'arrow' ? { before } : {}) })
    })

  let deletionRegion: CanvasPlaybackRegion | undefined
  if (removedElements.length) {
    const previousBoxes = previous?.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow') ?? []
    const removedBoxes = removedElements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
    const relatedBoxes = removedBoxes.length
      ? removedBoxes
      : previousBoxes.filter((box) => removedElements.some((item) => item.type === 'arrow' && (item.from === box.id || item.to === box.id)))
    if (relatedBoxes.length) {
      const left = Math.min(...relatedBoxes.map((item) => item.x))
      const top = Math.min(...relatedBoxes.map((item) => item.y))
      const right = Math.max(...relatedBoxes.map((item) => item.x + item.width))
      const bottom = Math.max(...relatedBoxes.map((item) => item.y + item.height))
      deletionRegion = {
        key: 'cleanup',
        label: '清理旧结构',
        elementIds: relatedBoxes.map((item) => item.id),
        center: { x: (left + right) / 2, y: (top + bottom) / 2 },
        width: right - left,
        height: bottom - top,
      }
    } else {
      deletionRegion = { key: 'cleanup', label: '清理旧结构', elementIds: [], center: { x: next.width / 2, y: next.height / 2 }, width: 480, height: 320 }
    }
    removedElements
      .filter((item) => item.type === 'arrow')
      .forEach((element) => actions.push({ kind: 'delete', element, regionKey: 'cleanup' }))
    removedElements
      .filter((item) => item.type !== 'arrow')
      .forEach((element) => actions.push({ kind: 'delete', element, regionKey: 'cleanup' }))
  }
  const hidden = mode === 'create'
    ? new Set(next.elements.map((item) => item.id))
    : added
  const regionOrder = [...new Set(actions.map((action) => action.regionKey))]
  const regionMap = new Map(regions.map((region) => [region.key, region]))
  return {
    initialVisibleIds: next.elements.filter((item) => !hidden.has(item.id)).map((item) => item.id),
    initialVisibleGroupIds: mode === 'create' ? [] : [...previousGroups.keys()],
    initialPositionOverrides,
    initialBoxOverrides,
    initialArrowOverrides,
    initialGroupFrameOverrides,
    ghostElements: removedElements,
    actions,
    regions: regionOrder.flatMap((key) => {
      const region = regionMap.get(key)
      return region ? [region] : []
    }).concat(deletionRegion ? [deletionRegion] : []),
  }
}

function buildCanvasPlaybackRegions(scene: CanvasScene): CanvasPlaybackRegion[] {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const groups = new Map<string, Array<CanvasNode | CanvasNote>>()
  const labels = new Map<string, string>()
  const groupMeta = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const laneMeta = new Map((scene.lanes ?? []).map((lane) => [lane.id, lane]))
  for (const box of boxes) {
    let key: string
    let label: string
    if (box.groupId && groupMeta.has(box.groupId)) {
      key = `group:${box.groupId}`
      label = groupMeta.get(box.groupId)?.label || '系统区域'
    } else if (box.laneId && laneMeta.has(box.laneId)) {
      key = `lane:${box.laneId}`
      label = laneMeta.get(box.laneId)?.label || '泳道区域'
    } else {
      const column = Math.floor((box.x + box.width / 2) / 760)
      const row = Math.floor((box.y + box.height / 2) / 520)
      key = `area:${column}:${row}`
      label = boxes.length <= 8 ? '核心画布' : `区域 ${row + 1}-${column + 1}`
    }
    const members = groups.get(key) ?? []
    members.push(box)
    groups.set(key, members)
    labels.set(key, label)
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const left = Math.min(...members.map((item) => item.x))
      const top = Math.min(...members.map((item) => item.y))
      const right = Math.max(...members.map((item) => item.x + item.width))
      const bottom = Math.max(...members.map((item) => item.y + item.height))
      return {
        key,
        label: labels.get(key) ?? '画布区域',
        elementIds: members.map((item) => item.id),
        center: { x: (left + right) / 2, y: (top + bottom) / 2 },
        width: right - left,
        height: bottom - top,
      }
    })
    .sort((left, right) => left.center.x - right.center.x || left.center.y - right.center.y)
}

function playbackBoxOrder(scene: CanvasScene): string[] {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const boxById = new Map(boxes.map((item) => [item.id, item]))
  const boxIds = new Set(boxes.map((item) => item.id))
  const incoming = new Map(boxes.map((item) => [item.id, 0]))
  const outgoing = new Map(boxes.map((item) => [item.id, [] as string[]]))
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow' || !boxIds.has(item.from) || !boxIds.has(item.to) || item.from === item.to) return
    incoming.set(item.to, (incoming.get(item.to) ?? 0) + 1)
    outgoing.get(item.from)?.push(item.to)
  })
  const byPosition = (a: string, b: string) => {
    const left = boxById.get(a)!
    const right = boxById.get(b)!
    return left.x - right.x || left.y - right.y
  }
  const queue = boxes.filter((item) => (incoming.get(item.id) ?? 0) === 0).map((item) => item.id).sort(byPosition)
  const result: string[] = []
  const resultIds = new Set<string>()
  let queueIndex = 0
  while (queueIndex < queue.length) {
    const id = queue[queueIndex++]
    if (resultIds.has(id)) continue
    result.push(id)
    resultIds.add(id)
    for (const next of outgoing.get(id) ?? []) {
      incoming.set(next, Math.max(0, (incoming.get(next) ?? 0) - 1))
      if ((incoming.get(next) ?? 0) === 0) {
        queue.push(next)
      }
    }
  }
  boxes.map((item) => item.id).filter((id) => !resultIds.has(id)).sort(byPosition).forEach((id) => result.push(id))
  return result
}

export function playbackActionTarget(scene: CanvasScene, action: CanvasPlaybackAction): CanvasPoint | null {
  if (action.kind === 'delete') {
    if (action.element.type !== 'arrow') return center(action.element)
    return null
  }
  if (action.kind === 'arrange') {
    const bounds = playbackBoundsForIds(scene, action.ids)
    return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null
  }
  if (action.kind === 'boundary') {
    const frame = canvasGroupFrames(scene).find((group) => group.id === action.groupId)
    return frame ? { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 } : null
  }
  if (action.kind === 'style') {
    const item = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === action.id)
    return item ? center(item) : null
  }
  const item = scene.elements.find((candidate) => candidate.id === action.id)
  if (!item) return null
  if (item.type !== 'arrow') {
    // The activity marker tracks the saved result, not speculative rough layout
    // positions that the model never actually wrote.
    return center(item)
  }
  const from = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === item.from)
  const to = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === item.to)
  if (!from || !to) return null
  return { x: (center(from).x + center(to).x) / 2, y: (center(from).y + center(to).y) / 2 }
}

function playbackRoughPosition(scene: CanvasScene, region: CanvasPlaybackRegion, index: number, total: number, item: CanvasNode | CanvasNote): CanvasPoint {
  const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(total))))
  const rows = Math.max(1, Math.ceil(total / columns))
  const col = index % columns
  const row = Math.floor(index / columns)
  const cellWidth = Math.max(220, Math.min(300, (region.width + 260) / columns))
  const cellHeight = Math.max(120, Math.min(180, (region.height + 180) / rows))
  const totalWidth = columns * cellWidth
  const totalHeight = rows * cellHeight
  const x = region.center.x - totalWidth / 2 + col * cellWidth + (cellWidth - item.width) / 2
  const y = region.center.y - totalHeight / 2 + row * cellHeight + (cellHeight - item.height) / 2
  return {
    x: clamp(x + 34, 0, Math.max(0, scene.width - item.width)),
    y: clamp(y + 26, 0, Math.max(0, scene.height - item.height)),
  }
}

export function playbackBoundsForIds(scene: CanvasScene, ids: string[], overrides?: Map<string, CanvasPoint>): { x: number; y: number; width: number; height: number } | null {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && ids.includes(item.id))
  if (!boxes.length) return null
  const left = Math.min(...boxes.map((item) => overrides?.get(item.id)?.x ?? item.x))
  const top = Math.min(...boxes.map((item) => overrides?.get(item.id)?.y ?? item.y))
  const right = Math.max(...boxes.map((item) => (overrides?.get(item.id)?.x ?? item.x) + item.width))
  const bottom = Math.max(...boxes.map((item) => (overrides?.get(item.id)?.y ?? item.y) + item.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function playbackStyleRows(before: CanvasNode | CanvasNote | undefined, after: CanvasNode | CanvasNote): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const add = (label: string, previous: unknown, next: unknown, format = (value: unknown) => String(value ?? '默认')) => {
    if (previous !== next && next !== undefined) rows.push({ label, value: format(next) })
  }
  add('语义色', before?.tone, after.tone)
  add('形状', before?.shape, after.shape)
  add('图形', before?.shapeRef, after.shapeRef)
  add('角色', before?.icon, after.icon, (value) => canvasIconLabel(value as CanvasIcon))
  add('技术栈', before?.stencil, after.stencil, (value) => canvasStencilLabel(value as CanvasStencil))
  add('图标', before?.iconRef, after.iconRef, (value) => canvasIconRefLabel(value as CanvasIconRef))
  add('C4', before?.c4Type, after.c4Type, (value) => c4Label(value as CanvasC4Type))
  add('副标题', before?.subtitle, after.subtitle)
  if (JSON.stringify(before?.tags ?? []) !== JSON.stringify(after.tags ?? []) && after.tags?.length) rows.push({ label: '标签', value: after.tags.slice(0, 3).join(' · ') })
  return rows.slice(0, 6)
}

export function playbackInspectorOptions(label: string, selected: string): string[] {
  const options = label === '语义色'
    ? ['default', 'accent', 'success', 'warning', 'danger', 'muted']
    : label === '形状'
      ? ['rounded', 'square', 'pill']
      : label === '图形'
        ? ['basic:rectangle', 'basic:ellipse', 'basic:diamond', 'flowchart:process', 'flowchart:decision', 'flowchart:terminator']
      : label === '角色'
        ? ['User', 'Web', 'API', 'Service', 'Database', 'Cache', 'Queue', 'External']
        : label === '技术栈'
          ? ['Spring', 'React', 'Vue', 'Postgres', 'Redis', 'Kafka', 'Kubernetes']
          : label === 'C4'
            ? ['Person', 'Software System', 'Container', 'Component']
            : [selected]
  return [...new Set([selected, ...options])].slice(0, 6)
}

export function playbackActionIntent(scene: CanvasScene, action: CanvasPlaybackAction): string {
  if (action.kind === 'delete') {
    return action.element.type === 'arrow'
      ? `删除 ${action.element.label ? truncate(action.element.label, 22) : '旧连接'}`
      : `删除 ${truncate(action.element.text, 22)}`
  }
  if (action.kind === 'arrange') return '整理当前区域布局'
  if (action.kind === 'boundary') {
    const group = scene.groups?.find((item) => item.id === action.groupId)
    return `创建 ${truncate(group?.label || '系统', 20)} 边界`
  }
  if (action.kind === 'style') return '调整节点属性'
  if (action.kind === 'box') {
    const item = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === action.id)
    if (!item) return '调整节点'
    if (action.added) return `添加 ${truncate(item.text, 22)}`
    const moved = action.before && (action.before.x !== item.x || action.before.y !== item.y)
    if (moved) return `整理 ${truncate(item.text, 22)} 位置`
    return `更新 ${truncate(item.text, 22)}`
  }
  const item = scene.elements.find((candidate): candidate is CanvasArrow => candidate.type === 'arrow' && candidate.id === action.id)
  if (!item) return '连接关系'
  const from = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === item.from)
  const to = scene.elements.find((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.id === item.to)
  if (from && to) return `连接 ${truncate(from.text, 12)} → ${truncate(to.text, 12)}`
  return item.label ? `连接 ${truncate(item.label, 22)}` : '连接节点关系'
}

export function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length)
  let index = 0
  while (index < max && left[index] === right[index]) index += 1
  return index
}

export function playbackPhaseLabel(phase: CanvasPlaybackPhase | undefined): string {
  if (phase === 'planning') return '规划区域'
  if (phase === 'transitioning') return '切换区域'
  if (phase === 'placing') return '放置节点'
  if (phase === 'typing') return '输入内容'
  if (phase === 'selecting') return '框选元素'
  if (phase === 'grouping') return '创建边界'
  if (phase === 'styling') return '调整属性'
  if (phase === 'connecting') return '连接关系'
  if (phase === 'arranging') return '整理布局'
  if (phase === 'finishing') return '完成收尾'
  return '准备绘制'
}


function center(item: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>): CanvasPoint {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}
