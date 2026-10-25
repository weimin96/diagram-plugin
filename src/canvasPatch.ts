import { routeArchitectureArrowIds, routeArchitectureEdgesIncremental } from './architectureRouting.js'
import { parseCanvasScene, serializeCanvasScene, type CanvasArrow, type CanvasElement, type CanvasNode, type CanvasNote, type CanvasPoint, type CanvasScene } from './canvas.js'
import { layoutCanvasNeighborhood } from './canvasOperations.js'
import { isCanvasIconRef } from './iconRegistry.js'
import { isCanvasShapeRef } from './shapeRegistry.js'

export interface CanvasPatchUpdateInput {
  id: string
  changes: Record<string, unknown>
}

export interface CanvasPatchAddInput {
  id: string
  type: 'node' | 'note' | 'arrow'
  properties: Record<string, unknown>
}

export interface CanvasSubgraphPatchInput {
  scopeElementIds: string[]
  updates?: CanvasPatchUpdateInput[]
  adds?: CanvasPatchAddInput[]
  removeIds?: string[]
  layout?: 'preserve' | 'local'
}

export interface CanvasSubgraphPatchResult {
  scene: CanvasScene
  declaredElementIds: string[]
  changedElementIds: string[]
  addedElementIds: string[]
  removedElementIds: string[]
  impactElementIds: string[]
  automaticElementIds: string[]
}

export interface CanvasPatchRebaseResult extends CanvasSubgraphPatchResult {
  rebased: true
}

export interface CanvasSubgraphContext {
  scopeElementIds: string[]
  scopeNodeIds: string[]
  directRelationshipIds: string[]
  contextElementIds: string[]
  elementIds: string[]
  elements: CanvasElement[]
  groups: CanvasScene['groups']
  lanes: CanvasScene['lanes']
  totalNodes: number
  totalArrows: number
  hiddenNodes: number
  hiddenArrows: number
}

const boxFields = new Set([
  'x', 'y', 'width', 'height', 'text', 'tone', 'shape', 'shapeRef', 'locked', 'groupId', 'sourcePaths', 'icon', 'stencil', 'iconRef',
  'subtitle', 'description', 'tags', 'laneId', 'c4Type', 'emphasis', 'fillColor', 'strokeColor', 'strokeWidth', 'opacity', 'cornerRadius',
  'rotation', 'textOnly', 'fontSize', 'fontWeight', 'textColor',
])
const arrowFields = new Set([
  'from', 'to', 'label', 'lineStyle', 'routing', 'fromAnchor', 'toAnchor', 'fromPortRatio', 'toPortRatio', 'points', 'labelPosition', 'emphasis', 'bundleKey',
  'start', 'end', 'markerEnd', 'strokeColor', 'strokeWidth', 'opacity',
])
const requiredBoxFields = new Set(['x', 'y', 'width', 'height', 'text'])
const requiredArrowFields = new Set(['from', 'to'])
const geometryFields = new Set(['x', 'y', 'width', 'height', 'rotation'])
const arrowRouteFields = ['routing', 'fromAnchor', 'toAnchor', 'fromPortRatio', 'toPortRatio', 'lineStyle', 'points', 'labelPosition', 'bundleKey'] as const

export function buildCanvasSubgraphPatch(base: CanvasScene, patch: CanvasSubgraphPatchInput): CanvasSubgraphPatchResult {
  base = normalizeStrict(base)
  const scope = new Set(patch.scopeElementIds)
  const baseById = new Map(base.elements.map((item) => [item.id, item]))
  const missingScope = [...scope].filter((id) => !baseById.has(id))
  if (missingScope.length) throw new Error(`Canvas patch 包含不存在的 scope 元素：${missingScope.join(', ')}`)

  const updates = patch.updates ?? []
  const adds = patch.adds ?? []
  const explicitRemovals = new Set(patch.removeIds ?? [])
  if (!updates.length && !adds.length && !explicitRemovals.size) throw new Error('Canvas patch 至少需要一个 update、add 或 remove。')
  assertUniqueIds(updates.map((item) => item.id), 'update')
  assertUniqueIds(adds.map((item) => item.id), 'add')
  assertUniqueIds([...explicitRemovals], 'remove')

  for (const update of updates) {
    if (!scope.has(update.id)) throw new Error(`Canvas patch 越界修改了 scope 外元素：${update.id}`)
    if (!baseById.has(update.id)) throw new Error(`Canvas patch 更新了不存在的元素：${update.id}`)
    if (explicitRemovals.has(update.id)) throw new Error(`Canvas patch 不能同时更新和删除元素：${update.id}`)
  }
  for (const id of explicitRemovals) {
    if (!scope.has(id)) throw new Error(`Canvas patch 越界删除了 scope 外元素：${id}`)
    if (!baseById.has(id)) throw new Error(`Canvas patch 删除了不存在的元素：${id}`)
  }
  for (const add of adds) {
    if (baseById.has(add.id)) throw new Error(`Canvas patch 新增元素 id 已存在：${add.id}`)
    if (scope.has(add.id)) throw new Error(`Canvas patch 新增元素不能复用 scope id：${add.id}`)
  }

  const updateById = new Map(updates.map((item) => [item.id, item]))
  const removedIds = new Set(explicitRemovals)
  for (const item of base.elements) {
    if (item.type === 'arrow') continue
    if (!removedIds.has(item.id)) continue
    base.elements.forEach((candidate) => {
      if (candidate.type === 'arrow' && (candidate.from === item.id || candidate.to === item.id)) removedIds.add(candidate.id)
    })
  }

  let elements: CanvasElement[] = base.elements.flatMap((item) => {
    if (removedIds.has(item.id)) return []
    const update = updateById.get(item.id)
    return update ? [applyElementChanges(item, update.changes)] : [item]
  })

  const working: CanvasScene = { ...base, elements }
  const addedBoxes: Array<CanvasNode | CanvasNote> = []
  const addedArrows: CanvasArrow[] = []
  for (const [index, add] of adds.entries()) {
    if (add.type === 'arrow') addedArrows.push(buildAddedArrow(add))
    else addedBoxes.push(buildAddedBox(working, add, index, [...scope]))
  }
  elements = [...elements, ...addedBoxes, ...addedArrows]
  let candidate: CanvasScene = { ...base, elements }
  validateElementReferences(candidate)

  const changedExistingNodeIds = updates.flatMap(({ id, changes }) => {
    const before = baseById.get(id)
    if (!before || before.type === 'arrow') return []
    return [...geometryFields].some((field) => Object.prototype.hasOwnProperty.call(changes, field)) ? [id] : []
  })
  const addedNodeIds = addedBoxes.map((item) => item.id)
  const declaredElementIds = [...new Set([
    ...updates.map((item) => item.id),
    ...adds.map((item) => item.id),
    ...explicitRemovals,
  ])]
  const declared = new Set(declaredElementIds)
  const automaticChangeLimit = Math.max(120, Math.min(400, declaredElementIds.length * 4 + 80))
  const explicitArrowIds = new Set<string>([
    ...updates.flatMap(({ id, changes }) => {
      const before = baseById.get(id)
      if (before?.type !== 'arrow') return []
      const endpointsChanged = Object.prototype.hasOwnProperty.call(changes, 'from') || Object.prototype.hasOwnProperty.call(changes, 'to')
      const keepsManualRoute = Object.prototype.hasOwnProperty.call(changes, 'points') || changes.routing === 'straight'
      return endpointsChanged && !keepsManualRoute ? [id] : []
    }),
    ...adds.flatMap((item) => item.type === 'arrow' && !Object.prototype.hasOwnProperty.call(item.properties, 'points') && item.properties.routing !== 'straight' ? [item.id] : []),
  ])

  if (patch.layout === 'local') {
    const seeds = [...new Set([
      ...updates.flatMap(({ id }) => baseById.get(id)?.type !== 'arrow' ? [id] : []),
      ...addedNodeIds,
    ])]
    if (seeds.length) candidate = layoutCanvasNeighborhood(candidate, seeds, 1, 24, 16).scene
  }

  if (candidate.architecture) {
    const movedNodeIds = new Set([...changedExistingNodeIds, ...addedNodeIds])
    const directAutomaticArrows = candidate.elements.filter((item) => item.type === 'arrow'
      && !declared.has(item.id)
      && (movedNodeIds.has(item.from) || movedNodeIds.has(item.to))).length
    if (directAutomaticArrows > automaticChangeLimit) {
      throw new Error(`Canvas patch 自动重排影响过大（至少 ${directAutomaticArrows} 条直接关系）；请扩大明确修改范围或改用整图 Proposal。`)
    }
    if (patch.layout === 'local') {
      const beforeNodes = new Map(base.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
      candidate.elements.forEach((item) => {
        if (item.type === 'arrow') return
        const before = beforeNodes.get(item.id)
        if (!before || before.x !== item.x || before.y !== item.y || before.width !== item.width || before.height !== item.height) movedNodeIds.add(item.id)
      })
    }
    if (movedNodeIds.size) candidate = routeArchitectureEdgesIncremental(candidate, movedNodeIds)
    if (explicitArrowIds.size) candidate = routeArchitectureArrowIds(candidate, explicitArrowIds)
  }

  const normalized = normalizeStrict(candidate)
  const resultById = new Map(normalized.elements.map((item) => [item.id, item]))
  const changedElementIds: string[] = []
  const addedElementIds: string[] = []
  const removedElementIds: string[] = []
  for (const item of base.elements) {
    const next = resultById.get(item.id)
    if (!next) removedElementIds.push(item.id)
    else if (JSON.stringify(item) !== JSON.stringify(next)) changedElementIds.push(item.id)
  }
  for (const item of normalized.elements) if (!baseById.has(item.id)) addedElementIds.push(item.id)

  const impactElementIds = [...new Set([...changedElementIds, ...addedElementIds, ...removedElementIds])]
  const automaticElementIds = impactElementIds.filter((id) => !declared.has(id))
  const automaticChangedExisting = changedElementIds.filter((id) => !declared.has(id))
  if (automaticChangedExisting.length > automaticChangeLimit) {
    throw new Error(`Canvas patch 自动重排影响过大（${automaticChangedExisting.length} 个已有元素）；请扩大明确修改范围或改用整图 Proposal。`)
  }
  return {
    scene: normalized,
    declaredElementIds,
    changedElementIds,
    addedElementIds,
    removedElementIds,
    impactElementIds,
    automaticElementIds,
  }
}

/**
 * Replays an incremental patch on top of a newer Canvas revision. Only fields
 * actually owned by the patch participate in conflict detection, so unrelated
 * edits (including other fields on the same element) are preserved. Automatic
 * layout/routing fields are protected as well because replaying them would
 * otherwise overwrite geometry authored after the proposal was created.
 */
export function rebaseCanvasSubgraphPatch(
  base: CanvasScene,
  current: CanvasScene,
  patch: CanvasSubgraphPatchInput,
  previousAutomaticElementIds: string[] = [],
): CanvasPatchRebaseResult {
  base = normalizeStrict(base)
  current = normalizeStrict(current)
  const baseById = new Map(base.elements.map((item) => [item.id, item]))
  const currentById = new Map(current.elements.map((item) => [item.id, item]))
  const conflicts = new Set<string>()

  for (const id of patch.scopeElementIds) {
    const before = baseById.get(id)
    if (before && !currentById.has(id)) conflicts.add(`${id}（已被删除）`)
  }

  for (const update of patch.updates ?? []) {
    const before = baseById.get(update.id)
    const latest = currentById.get(update.id)
    if (!before || !latest) {
      conflicts.add(`${update.id}（元素不存在）`)
      continue
    }
    if (before.type !== latest.type) {
      conflicts.add(`${update.id}.type`)
      continue
    }
    for (const [field, desiredRaw] of Object.entries(update.changes)) {
      const beforeValue = elementField(before, field)
      const latestValue = elementField(latest, field)
      const desiredValue = desiredRaw === null ? undefined : desiredRaw
      if (!sameValue(latestValue, beforeValue) && !sameValue(latestValue, desiredValue)) conflicts.add(`${update.id}.${field}`)
    }
    if (before.type === 'arrow') {
      const endpointsChanged = Object.prototype.hasOwnProperty.call(update.changes, 'from') || Object.prototype.hasOwnProperty.call(update.changes, 'to')
      if (endpointsChanged) {
        for (const field of arrowRouteFields) {
          if (Object.prototype.hasOwnProperty.call(update.changes, field)) continue
          if (!sameValue(elementField(latest, field), elementField(before, field))) conflicts.add(`${update.id}.${field}`)
        }
      }
    }
  }

  for (const id of patch.removeIds ?? []) {
    const before = baseById.get(id)
    const latest = currentById.get(id)
    if (!before || !latest) {
      conflicts.add(`${id}（删除目标已变化）`)
      continue
    }
    if (!sameValue(before, latest)) conflicts.add(`${id}（删除目标已修改）`)
  }

  for (const add of patch.adds ?? []) {
    if (currentById.has(add.id)) conflicts.add(`${add.id}（新增 id 已占用）`)
  }

  // Local layout owns geometry for the selected neighborhood. Preserve any
  // geometry/routing authored after the proposal by treating it as a conflict.
  const automatic = new Set(previousAutomaticElementIds)
  const layoutProtected = new Set<string>(patch.layout === 'local'
    ? [...patch.scopeElementIds, ...automatic]
    : [...automatic])
  for (const id of layoutProtected) {
    const before = baseById.get(id)
    const latest = currentById.get(id)
    if (!before || !latest || before.type !== latest.type) continue
    if (before.type === 'arrow') {
      for (const field of arrowRouteFields) {
        if (!sameValue(elementField(latest, field), elementField(before, field))) conflicts.add(`${id}.${field}`)
      }
    } else if (patch.layout === 'local') {
      for (const field of geometryFields) {
        if (!sameValue(elementField(latest, field), elementField(before, field))) conflicts.add(`${id}.${field}`)
      }
    }
  }

  if (conflicts.size) {
    const entries = [...conflicts]
    throw new Error(`Canvas patch 与最新画布存在并发冲突：${entries.slice(0, 12).join(', ')}${entries.length > 12 ? `…（共 ${entries.length} 项）` : ''}`)
  }

  return { ...buildCanvasSubgraphPatch(current, patch), rebased: true }
}

export function canvasPatchRebaseReviewIds(
  originalCandidate: CanvasScene,
  rebasedCandidate: CanvasScene,
  previousAutomaticElementIds: string[] = [],
  previousAddedElementIds: string[] = [],
): string[] {
  originalCandidate = normalizeStrict(originalCandidate)
  rebasedCandidate = normalizeStrict(rebasedCandidate)
  const originalById = new Map(originalCandidate.elements.map((item) => [item.id, item]))
  const rebasedById = new Map(rebasedCandidate.elements.map((item) => [item.id, item]))
  const review = new Set<string>()
  for (const id of previousAddedElementIds) {
    if (!sameValue(originalById.get(id), rebasedById.get(id))) review.add(id)
  }
  for (const id of previousAutomaticElementIds) {
    const before = originalById.get(id)
    const after = rebasedById.get(id)
    if (!before || !after || before.type !== after.type) {
      if (!sameValue(before, after)) review.add(id)
      continue
    }
    if (before.type === 'arrow') {
      if (arrowRouteFields.some((field) => !sameValue(elementField(before, field), elementField(after, field)))) review.add(id)
    } else if ([...geometryFields].some((field) => !sameValue(elementField(before, field), elementField(after, field)))) {
      review.add(id)
    }
  }
  return [...review]
}

export function buildCanvasSubgraphContext(scene: CanvasScene, scopeElementIds: string[], depth = 0, maxNodes = 160): CanvasSubgraphContext {
  scene = normalizeStrict(scene)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const boxById = new Map(boxes.map((item) => [item.id, item]))
  const arrowById = new Map(arrows.map((item) => [item.id, item]))
  const scope = [...new Set(scopeElementIds)]
  const missing = scope.filter((id) => !boxById.has(id) && !arrowById.has(id))
  if (missing.length) throw new Error(`Canvas subgraph 包含不存在的元素：${missing.join(', ')}`)

  const nodeIds = new Set<string>()
  const arrowIds = new Set<string>()
  const selectedNodeIds = new Set<string>()
  for (const id of scope) {
    const box = boxById.get(id)
    if (box) {
      nodeIds.add(box.id)
      selectedNodeIds.add(box.id)
    }
    const arrow = arrowById.get(id)
    if (arrow) {
      arrowIds.add(arrow.id)
      nodeIds.add(arrow.from)
      nodeIds.add(arrow.to)
    }
  }
  const scopeNodeIds = new Set(selectedNodeIds)
  const directRelationshipIds = new Set<string>([...arrowIds])
  for (const arrow of arrows) {
    if (scopeNodeIds.has(arrow.from) || scopeNodeIds.has(arrow.to)) directRelationshipIds.add(arrow.id)
  }
  const safeMaxNodes = Math.max(nodeIds.size, Math.min(240, Math.max(12, Math.floor(maxNodes))))
  const maxArrows = Math.max(arrowIds.size, Math.min(960, Math.max(80, safeMaxNodes * 4)))
  let frontier = new Set(nodeIds)
  const rounds = Math.max(1, Math.min(3, Math.floor(depth) + 1))
  const sortedArrows = arrows.slice().sort((left, right) => patchArrowPriority(right) - patchArrowPriority(left) || left.id.localeCompare(right.id))
  for (let round = 0; round < rounds && frontier.size; round += 1) {
    const next = new Set<string>()
    for (const arrow of sortedArrows) {
      if (arrowIds.size >= maxArrows) break
      const fromFrontier = frontier.has(arrow.from)
      const toFrontier = frontier.has(arrow.to)
      if (!fromFrontier && !toFrontier) continue
      const neighbor = fromFrontier ? arrow.to : arrow.from
      if (!nodeIds.has(neighbor) && nodeIds.size >= safeMaxNodes) continue
      arrowIds.add(arrow.id)
      if (!nodeIds.has(neighbor)) {
        nodeIds.add(neighbor)
        next.add(neighbor)
      }
    }
    frontier = next
  }
  for (const arrow of sortedArrows) {
    if (arrowIds.size >= maxArrows) break
    if (nodeIds.has(arrow.from) && nodeIds.has(arrow.to)) arrowIds.add(arrow.id)
  }

  const includedIds = new Set([...nodeIds, ...arrowIds])
  const elements = scene.elements.filter((item) => includedIds.has(item.id))
  const contextElementIds = elements.map((item) => item.id).filter((id) => !scope.includes(id) && !directRelationshipIds.has(id))
  const groupById = new Map((scene.groups ?? []).map((item) => [item.id, item]))
  const usedGroupIds = new Set<string>()
  for (const box of boxes) {
    if (!nodeIds.has(box.id) || !box.groupId) continue
    let groupId: string | undefined = box.groupId
    const seen = new Set<string>()
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId)
      usedGroupIds.add(groupId)
      groupId = groupById.get(groupId)?.parentId
    }
  }
  const usedLaneIds = new Set(boxes.filter((item) => nodeIds.has(item.id) && item.laneId).map((item) => item.laneId as string))
  return {
    scopeElementIds: scope,
    scopeNodeIds: [...scopeNodeIds],
    directRelationshipIds: [...directRelationshipIds].filter((id) => includedIds.has(id)),
    contextElementIds,
    elementIds: elements.map((item) => item.id),
    elements,
    groups: scene.groups?.filter((item) => usedGroupIds.has(item.id)),
    lanes: scene.lanes?.filter((item) => usedLaneIds.has(item.id)),
    totalNodes: boxes.length,
    totalArrows: arrows.length,
    hiddenNodes: Math.max(0, boxes.length - nodeIds.size),
    hiddenArrows: Math.max(0, arrows.length - arrowIds.size),
  }
}

export function mergeCanvasProposalSelection(
  baseSource: string,
  candidateSource: string,
  elementIds: string[],
  includeRelatedArrows = true,
): string {
  let base: CanvasScene
  let candidate: CanvasScene
  try {
    base = parseCanvasScene(baseSource)
    candidate = parseCanvasScene(candidateSource)
  } catch {
    throw new Error('部分接受仅支持结构有效的 Canvas Proposal。')
  }
  const selected = new Set(elementIds)
  const candidateById = new Map(candidate.elements.map((item) => [item.id, item]))
  const baseNodeIds = new Set(base.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
  for (const id of selected) {
    const item = candidateById.get(id)
    if (!item || item.type !== 'arrow') continue
    for (const endpoint of [item.from, item.to]) {
      if (baseNodeIds.has(endpoint) || selected.has(endpoint)) continue
      throw new Error(`部分接受关系 ${item.id} 还需要同时接受新增端点 ${endpoint}。`)
    }
  }
  const relatedArrowIds = new Set<string>()
  if (includeRelatedArrows) {
    for (const item of candidate.elements) {
      if (item.type === 'arrow' && (selected.has(item.id) || selected.has(item.from) || selected.has(item.to))) relatedArrowIds.add(item.id)
    }
    for (const item of base.elements) {
      if (item.type === 'arrow' && (selected.has(item.id) || selected.has(item.from) || selected.has(item.to))) relatedArrowIds.add(item.id)
    }
  }
  const affected = new Set([...selected, ...relatedArrowIds])
  const nextElements: CanvasElement[] = []
  const seen = new Set<string>()
  for (const item of base.elements) {
    if (!affected.has(item.id)) {
      nextElements.push(item)
      seen.add(item.id)
      continue
    }
    const replacement = candidateById.get(item.id)
    if (replacement) {
      nextElements.push(replacement)
      seen.add(item.id)
    }
  }
  for (const item of candidate.elements) {
    if (!affected.has(item.id) || seen.has(item.id)) continue
    nextElements.push(item)
    seen.add(item.id)
  }
  const liveNodeIds = new Set(nextElements.filter((item) => item.type !== 'arrow').map((item) => item.id))
  const sanitized = nextElements.filter((item) => item.type !== 'arrow' || (liveNodeIds.has(item.from) && liveNodeIds.has(item.to)))
  const groupIds = new Set(sanitized.flatMap((item) => item.type === 'arrow' || !item.groupId ? [] : [item.groupId]))
  const laneIds = new Set(sanitized.flatMap((item) => item.type === 'arrow' || !item.laneId ? [] : [item.laneId]))
  const groups = mergeMetadataById(base.groups, candidate.groups, groupIds)
  const lanes = mergeMetadataById(base.lanes, candidate.lanes, laneIds)
  let merged: CanvasScene = {
    ...base,
    elements: sanitized,
    groups: groups.length ? groups : undefined,
    lanes: lanes.length ? lanes : undefined,
  }
  if (merged.architecture) {
    const baseBoxes = new Map(base.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
    const movedNodeIds = new Set<string>()
    for (const item of merged.elements) {
      if (item.type === 'arrow') continue
      const before = baseBoxes.get(item.id)
      if (!before || before.x !== item.x || before.y !== item.y || before.width !== item.width || before.height !== item.height) movedNodeIds.add(item.id)
    }
    if (movedNodeIds.size) merged = routeArchitectureEdgesIncremental(merged, movedNodeIds)
  }
  return serializeCanvasScene(merged)
}

function applyElementChanges(item: CanvasElement, changes: Record<string, unknown>): CanvasElement {
  const allowed = item.type === 'arrow' ? arrowFields : boxFields
  const required = item.type === 'arrow' ? requiredArrowFields : requiredBoxFields
  const next = { ...item } as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.has(key)) throw new Error(`Canvas patch 不支持修改字段 ${item.id}.${key}`)
    if (item.type !== 'arrow' && item.locked && geometryFields.has(key)) throw new Error(`锁定节点不能由 AI patch 修改几何：${item.id}`)
    if (value === null) {
      if (required.has(key)) throw new Error(`Canvas patch 不能清除必填字段 ${item.id}.${key}`)
      delete next[key]
    } else {
      validatePatchField(item.type, key, value, item.id)
      next[key] = value
    }
  }
  if (item.type === 'arrow') {
    const endpointsChanged = ('from' in changes && changes.from !== item.from) || ('to' in changes && changes.to !== item.to)
    for (const endpoint of ['from', 'to'] as const) {
      const field = `${endpoint}PortRatio`
      if ((endpoint in changes && changes[endpoint] !== item[endpoint])
        || (`${endpoint}Anchor` in changes && changes[`${endpoint}Anchor`] !== item[`${endpoint}Anchor`])) {
        if (!(field in changes)) delete next[field]
      }
      const ratio = next[field]
      if (ratio !== undefined && !['top', 'right', 'bottom', 'left'].includes(String(next[`${endpoint}Anchor`]))) {
        throw new Error(`Canvas patch 精确端口需要明确的非 auto 锚点：${item.id}.${field}`)
      }
    }
    if (endpointsChanged) {
      if (!('points' in changes)) delete next.points
      if (!('labelPosition' in changes)) delete next.labelPosition
      if (!('bundleKey' in changes)) delete next.bundleKey
    }
  }
  return next as unknown as CanvasElement
}

function buildAddedBox(scene: CanvasScene, add: CanvasPatchAddInput, index: number, scopeIds: string[]): CanvasNode | CanvasNote {
  const properties = { ...add.properties }
  if (Object.prototype.hasOwnProperty.call(properties, 'x') !== Object.prototype.hasOwnProperty.call(properties, 'y')) {
    throw new Error(`Canvas patch 新节点坐标必须同时提供 x/y，或两者都省略：${add.id}`)
  }
  for (const [key, value] of Object.entries(properties)) {
    if (!boxFields.has(key)) throw new Error(`Canvas patch 新节点不支持字段 ${add.id}.${key}`)
    if (value !== null) validatePatchField(add.type, key, value, add.id)
  }
  const width = finitePositive(properties.width, 220)
  const height = finitePositive(properties.height, add.type === 'note' ? 120 : 96)
  const explicitX = finiteNumber(properties.x)
  const explicitY = finiteNumber(properties.y)
  const scopeBoxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && scopeIds.includes(item.id))
  const inheritedGroupId = Object.prototype.hasOwnProperty.call(properties, 'groupId') ? undefined : unanimousContextValue(scopeBoxes.map((item) => item.groupId))
  const inheritedLaneId = Object.prototype.hasOwnProperty.call(properties, 'laneId') ? undefined : unanimousContextValue(scopeBoxes.map((item) => item.laneId))
  const position = explicitX !== undefined && explicitY !== undefined
    ? { x: explicitX, y: explicitY }
    : findPatchPlacement(scene, scopeIds, width, height, index, typeof properties.laneId === 'string' ? properties.laneId : inheritedLaneId)
  return {
    id: add.id,
    type: add.type === 'note' ? 'note' : 'node',
    x: position.x,
    y: position.y,
    width,
    height,
    text: typeof properties.text === 'string' && properties.text.trim() ? properties.text : add.type === 'note' ? '新备注' : '新节点',
    ...(inheritedGroupId ? { groupId: inheritedGroupId } : {}),
    ...(inheritedLaneId ? { laneId: inheritedLaneId } : {}),
    ...optionalBoxProperties(properties),
  }
}

function buildAddedArrow(add: CanvasPatchAddInput): CanvasArrow {
  const properties = { ...add.properties }
  for (const [key, value] of Object.entries(properties)) {
    if (!arrowFields.has(key)) throw new Error(`Canvas patch 新关系不支持字段 ${add.id}.${key}`)
    if (value !== null) validatePatchField('arrow', key, value, add.id)
  }
  if (typeof properties.from !== 'string' || typeof properties.to !== 'string') throw new Error(`Canvas patch 新关系必须提供 from/to：${add.id}`)
  for (const endpoint of ['from', 'to'] as const) {
    if (properties[`${endpoint}PortRatio`] !== undefined && properties[`${endpoint}PortRatio`] !== null
      && !['top', 'right', 'bottom', 'left'].includes(String(properties[`${endpoint}Anchor`]))) {
      throw new Error(`Canvas patch 精确端口需要明确的非 auto 锚点：${add.id}.${endpoint}PortRatio`)
    }
  }
  return { id: add.id, type: 'arrow', ...properties } as CanvasArrow
}

function optionalBoxProperties(properties: Record<string, unknown>): Partial<CanvasNode> {
  const result: Record<string, unknown> = {}
  for (const key of boxFields) {
    if (requiredBoxFields.has(key) || key === 'x' || key === 'y' || key === 'width' || key === 'height') continue
    const value = properties[key]
    if (value !== undefined && value !== null) result[key] = value
  }
  return result as Partial<CanvasNode>
}

function findPatchPlacement(scene: CanvasScene, scopeIds: string[], width: number, height: number, offset: number, laneId?: string): CanvasPoint {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const scope = boxes.filter((item) => scopeIds.includes(item.id))
  const reference = scope.length ? scope : boxes
  const minX = reference.length ? Math.min(...reference.map((item) => item.x)) : 80
  const maxX = reference.length ? Math.max(...reference.map((item) => item.x + item.width)) : 80
  const minY = reference.length ? Math.min(...reference.map((item) => item.y)) : 80
  const maxY = reference.length ? Math.max(...reference.map((item) => item.y + item.height)) : 80
  const candidates: CanvasPoint[] = []
  for (let ring = 0; ring < 18; ring += 1) {
    const slot = offset + ring
    const col = slot % 5
    const row = Math.floor(slot / 5)
    candidates.push({ x: maxX + 64 + col * 24, y: minY + row * (height + 32) })
    candidates.push({ x: minX + col * (width + 32), y: maxY + 48 + row * 24 })
    candidates.push({ x: minX - width - 64 - col * 24, y: minY + row * (height + 32) })
    candidates.push({ x: minX + col * (width + 32), y: minY - height - 48 - row * 24 })
  }
  const lane = laneId ? scene.lanes?.find((item) => item.id === laneId) : undefined
  const minAllowedX = lane?.axis === 'vertical' ? lane.start + 12 : 0
  const maxAllowedX = lane?.axis === 'vertical' ? lane.start + lane.size - width - 12 : scene.width - width
  const minAllowedY = lane?.axis === 'horizontal' ? lane.start + 12 : 0
  const maxAllowedY = lane?.axis === 'horizontal' ? lane.start + lane.size - height - 12 : scene.height - height
  const safeMinX = Math.max(0, Math.min(minAllowedX, Math.max(0, scene.width - width)))
  const safeMaxX = Math.max(safeMinX, Math.min(Math.max(0, scene.width - width), maxAllowedX))
  const safeMinY = Math.max(0, Math.min(minAllowedY, Math.max(0, scene.height - height)))
  const safeMaxY = Math.max(safeMinY, Math.min(Math.max(0, scene.height - height), maxAllowedY))
  const normalized: CanvasPoint[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const point = {
      x: clamp(Math.round(candidate.x / 16) * 16, safeMinX, safeMaxX),
      y: clamp(Math.round(candidate.y / 16) * 16, safeMinY, safeMaxY),
    }
    const key = `${point.x}:${point.y}`
    if (!seen.has(key)) {
      seen.add(key)
      normalized.push(point)
    }
  }
  return normalized.find((point) => !boxes.some((item) => rectsOverlap({ ...point, width, height }, item))) ?? normalized[0] ?? { x: safeMinX, y: safeMinY }
}

function validateElementReferences(scene: CanvasScene): void {
  const ids = new Set<string>()
  for (const item of scene.elements) {
    if (ids.has(item.id)) throw new Error(`Canvas patch 产生重复元素 id：${item.id}`)
    ids.add(item.id)
  }
  const nodeIds = new Set(scene.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
  for (const item of scene.elements) {
    if (item.type !== 'arrow') continue
    if (!nodeIds.has(item.from) || !nodeIds.has(item.to)) throw new Error(`Canvas patch 关系端点不存在：${item.id}`)
    if (item.from === item.to) throw new Error(`Canvas patch 不允许自环关系：${item.id}`)
  }
  const groupIds = new Set((scene.groups ?? []).map((item) => item.id))
  const laneIds = new Set((scene.lanes ?? []).map((item) => item.id))
  scene.elements.forEach((item) => {
    if (item.type === 'arrow') return
    if (item.groupId && !groupIds.has(item.groupId)) throw new Error(`Canvas patch 引用了不存在的 group：${item.id} -> ${item.groupId}`)
    if (item.laneId && !laneIds.has(item.laneId)) throw new Error(`Canvas patch 引用了不存在的 lane：${item.id} -> ${item.laneId}`)
  })
}

function normalizeStrict(scene: CanvasScene): CanvasScene {
  validateElementReferences(scene)
  const normalized = parseCanvasScene(serializeCanvasScene(scene))
  const beforeIds = scene.elements.map((item) => item.id).sort()
  const afterIds = normalized.elements.map((item) => item.id).sort()
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) throw new Error('Canvas patch 包含无法通过协议校验的元素。')
  validateElementReferences(normalized)
  return normalized
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finitePositive(value: unknown, fallback: number): number {
  const number = finiteNumber(value)
  return number !== undefined && number > 0 ? number : fallback
}

function rectsOverlap(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }): boolean {
  const padding = 20
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y
}

function assertUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>()
  const duplicates = ids.filter((id) => seen.has(id) || !seen.add(id))
  if (duplicates.length) throw new Error(`Canvas patch ${label} 含重复 id：${[...new Set(duplicates)].join(', ')}`)
}

function validatePatchField(type: CanvasElement['type'], key: string, value: unknown, id: string): void {
  const fail = () => { throw new Error(`Canvas patch 字段值无效：${id}.${key}`) }
  if (type !== 'arrow') {
    if (key === 'x' || key === 'y') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail()
      return
    }
    if (key === 'width' || key === 'height') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail()
      return
    }
    if (key === 'text') {
      if (typeof value !== 'string') fail()
      return
    }
    if (key === 'tone') {
      if (!['default', 'accent', 'success', 'warning', 'danger', 'muted'].includes(String(value))) fail()
      return
    }
    if (key === 'shape') {
      if (!['rounded', 'square', 'pill'].includes(String(value))) fail()
      return
    }
    if (key === 'shapeRef') {
      if (!isCanvasShapeRef(value)) fail()
      return
    }
    if (key === 'locked') {
      if (typeof value !== 'boolean') fail()
      return
    }
    if (key === 'groupId' || key === 'laneId') {
      if (typeof value !== 'string' || !value.trim()) fail()
      return
    }
    if (key === 'sourcePaths') {
      if (!isStringArray(value, 12)) fail()
      return
    }
    if (key === 'icon') {
      if (!['user', 'web', 'api', 'gateway', 'service', 'worker', 'database', 'cache', 'queue', 'search', 'vector', 'cloud', 'file', 'auth', 'ai', 'mcp', 'scheduler', 'external'].includes(String(value))) fail()
      return
    }
    if (key === 'stencil') {
      if (!['spring', 'react', 'vue', 'postgres', 'mysql', 'redis', 'kafka', 'rabbitmq', 'docker', 'kubernetes', 'qdrant', 'opensearch', 'elasticsearch', 'mongodb', 'minio', 'nginx', 'grpc', 'oidc', 'openai', 'mcp'].includes(String(value))) fail()
      return
    }
    if (key === 'iconRef') {
      if (!isCanvasIconRef(value)) fail()
      return
    }
    if (key === 'subtitle') {
      if (typeof value !== 'string' || value.trim().length > 120) fail()
      return
    }
    if (key === 'description') {
      if (typeof value !== 'string' || value.trim().length > 1000) fail()
      return
    }
    if (key === 'tags') {
      if (!isStringArray(value, 12)) fail()
      return
    }
    if (key === 'c4Type') {
      if (!['person', 'software-system', 'container', 'component'].includes(String(value))) fail()
      return
    }
    if (key === 'emphasis') {
      if (!['primary', 'secondary', 'muted'].includes(String(value))) fail()
      return
    }
    if (key === 'fillColor' || key === 'strokeColor') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail()
      return
    }
    if (key === 'strokeWidth') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 12) fail()
      return
    }
    if (key === 'opacity') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail()
      return
    }
    if (key === 'cornerRadius') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 80) fail()
      return
    }
    if (key === 'rotation') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < -180 || value > 180) fail()
      return
    }
    if (key === 'textOnly') {
      if (type !== 'note' || typeof value !== 'boolean') fail()
      return
    }
    if (key === 'fontSize') {
      if (type !== 'note' || typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 96) fail()
      return
    }
    if (key === 'fontWeight') {
      if (type !== 'note' || ![400, 500, 600, 700].includes(Number(value))) fail()
      return
    }
    if (key === 'textColor') {
      if (type !== 'note' || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail()
      return
    }
    fail()
  }
  if (key === 'from' || key === 'to') {
    if (typeof value !== 'string' || !value.trim()) fail()
    return
  }
  if (key === 'label') {
    if (typeof value !== 'string') fail()
    return
  }
  if (key === 'lineStyle') {
    if (value !== 'solid' && value !== 'dashed' && value !== 'dotted') fail()
    return
  }
  if (key === 'routing') {
    if (value !== 'straight' && value !== 'orthogonal') fail()
    return
  }
  if (key === 'fromAnchor' || key === 'toAnchor') {
    if (!['auto', 'top', 'right', 'bottom', 'left'].includes(String(value))) fail()
    return
  }
  if (key === 'fromPortRatio' || key === 'toPortRatio') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail()
    return
  }
  if (key === 'points') {
    if (!Array.isArray(value) || value.length > 80 || !value.every(isFinitePoint)) fail()
    return
  }
  if (key === 'labelPosition') {
    if (!isFinitePoint(value)) fail()
    return
  }
  if (key === 'emphasis') {
    if (!['primary', 'secondary', 'muted'].includes(String(value))) fail()
    return
  }
  if (key === 'bundleKey') {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) fail()
    return
  }
  if (key === 'start' || key === 'end') {
    if (!isFinitePoint(value)) fail()
    return
  }
  if (key === 'markerEnd') {
    if (value !== 'none' && value !== 'arrow') fail()
    return
  }
  if (key === 'strokeColor') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail()
    return
  }
  if (key === 'strokeWidth') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 12) fail()
    return
  }
  if (key === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail()
    return
  }
  fail()
}

function patchArrowPriority(arrow: CanvasArrow): number {
  return arrow.emphasis === 'primary' ? 30 : arrow.emphasis === 'secondary' ? 20 : arrow.emphasis === 'muted' ? 5 : 12
}

function isStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string' && Boolean(item.trim()))
}

function isFinitePoint(value: unknown): value is CanvasPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
}

function unanimousContextValue(values: Array<string | undefined>): string | undefined {
  if (!values.length || values.some((value) => !value)) return undefined
  const first = values[0]
  return values.every((value) => value === first) ? first : undefined
}

function elementField(item: CanvasElement, field: string): unknown {
  return (item as unknown as Record<string, unknown>)[field]
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeMetadataById<T extends { id: string }>(base: T[] | undefined, candidate: T[] | undefined, usedIds: Set<string>): T[] {
  const candidateById = new Map((candidate ?? []).map((item) => [item.id, item]))
  const baseById = new Map((base ?? []).map((item) => [item.id, item]))
  return [...usedIds].flatMap((id) => {
    const item = candidateById.get(id) ?? baseById.get(id)
    return item ? [item] : []
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
