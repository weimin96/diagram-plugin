import type {
  CanvasArrow,
  CanvasArchitectureDensity,
  CanvasArchitectureTheme,
  CanvasArchitectureView,
  CanvasElement,
  CanvasEmphasis,
  CanvasGroup,
  CanvasGroupFrame,
  CanvasIcon,
  CanvasNode,
  CanvasNote,
  CanvasPoint,
  CanvasScene,
  CanvasStencil,
  CanvasTone,
} from './canvas.js'
import { anchorPoint, canvasArrowRoutePoints, canvasGroupFrames } from './canvas.js'

export type ArchitectureTheme = CanvasArchitectureTheme
export type ArchitectureComposition = 'layered' | 'hub-spoke' | 'event-driven' | 'data-platform' | 'agent-runtime' | 'cloud-native'
export type ArchitecturePartition = 'external' | 'experience' | 'application' | 'processing' | 'data'

export interface ArchitectureBeautifyOptions {
  theme?: ArchitectureTheme
  view?: CanvasArchitectureView
  density?: CanvasArchitectureDensity
  /** Candidate-layout evaluation only; normal architecture inference remains the default. */
  composition?: ArchitectureComposition
  /** Experimental initial peer ordering from actual inter-region dependencies. */
  peerOrder?: 'semantic' | 'dependency' | 'main-path'
  /** Optional candidate geometry; legacy coordinates remain the default. */
  alignedSpacing?: boolean
  /** Trial only: resolve global collisions in planned spatial order. */
  spatialOrder?: boolean
  /** Verified semantic intent takes priority over label-based role inference. */
  partitionOverrides?: ReadonlyMap<string, ArchitecturePartition>
  /** An explicitly confirmed directed business path, not an inferred longest path. */
  primaryPath?: readonly string[]
  repartition?: boolean
  relayout?: boolean
  reroute?: boolean
}

export interface ArchitectureBeautifyResult {
  scene: CanvasScene
  summary: {
    theme: ArchitectureTheme
    composition: ArchitectureComposition
    partitions: number
    enrichedNodes: number
    routedEdges: number
    primaryNodes: number
    bundledEdges: number
    view: CanvasArchitectureView
    density: CanvasArchitectureDensity
    resolvedDensity: Exclude<CanvasArchitectureDensity, 'auto'>
  }
}

const partitionOrder: ArchitecturePartition[] = ['external', 'experience', 'application', 'processing', 'data']
/** Placement clearance must match the collision check in applyArchitectureLayoutPositions. */
const architectureNodeClearance = 24

const partitionMeta: Record<ArchitecturePartition, { label: string; tone: CanvasTone }> = {
  external: { label: '外部与参与方', tone: 'muted' },
  experience: { label: '体验与入口', tone: 'accent' },
  application: { label: '核心应用', tone: 'default' },
  processing: { label: '处理与异步', tone: 'warning' },
  data: { label: '数据与检索', tone: 'success' },
}

const themeTones: Record<ArchitectureTheme, Record<ArchitecturePartition, CanvasTone>> = {
  enterprise: {
    external: 'muted',
    experience: 'accent',
    application: 'default',
    processing: 'warning',
    data: 'success',
  },
  technical: {
    external: 'muted',
    experience: 'default',
    application: 'default',
    processing: 'muted',
    data: 'default',
  },
  presentation: {
    external: 'muted',
    experience: 'accent',
    application: 'success',
    processing: 'warning',
    data: 'accent',
  },
  cloud: {
    external: 'muted',
    experience: 'accent',
    application: 'accent',
    processing: 'default',
    data: 'success',
  },
  editorial: {
    external: 'muted',
    experience: 'default',
    application: 'accent',
    processing: 'warning',
    data: 'default',
  },
  sketch: {
    external: 'muted',
    experience: 'default',
    application: 'default',
    processing: 'muted',
    data: 'default',
  },
}

export function inferArchitectureComposition(scene: CanvasScene, overrides?: ReadonlyMap<string, ArchitecturePartition>): ArchitectureComposition {
  const boxes = scene.elements
    .filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
    .map((item) => enrichArchitectureBox(item))
  const partitions = new Map(boxes.map((item) => [item.id, overrides?.get(item.id) ?? classifyArchitectureBox(item)]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  return detectArchitectureComposition(boxes, arrows, partitions)
}

function detectArchitectureComposition(
  boxes: Array<CanvasNode | CanvasNote>,
  arrows: CanvasArrow[],
  partitions: Map<string, ArchitecturePartition>,
): ArchitectureComposition {
  if (boxes.length < 3) return 'layered'
  const degree = new Map(boxes.map((item) => [item.id, 0]))
  arrows.forEach((arrow) => {
    degree.set(arrow.from, (degree.get(arrow.from) ?? 0) + 1)
    degree.set(arrow.to, (degree.get(arrow.to) ?? 0) + 1)
  })

  const ai = boxes.filter((item) => item.icon === 'ai' || item.stencil === 'openai')
  const mcp = boxes.filter((item) => item.icon === 'mcp' || item.stencil === 'mcp')
  const cloudInfra = boxes.filter((item) => item.stencil === 'kubernetes' || item.stencil === 'docker' || item.stencil === 'nginx')
  const queues = boxes.filter((item) => item.icon === 'queue' || item.stencil === 'kafka' || item.stencil === 'rabbitmq')
  const workers = boxes.filter((item) => item.icon === 'worker' || item.icon === 'scheduler')
  const processing = boxes.filter((item) => partitions.get(item.id) === 'processing')
  const data = boxes.filter((item) => partitions.get(item.id) === 'data')
  const sources = boxes.filter((item) => partitions.get(item.id) === 'external' || partitions.get(item.id) === 'experience')
  // A queue, scheduler and three storage products are common in ordinary
  // business platforms too. A data-pipeline diagram needs real evidence of
  // distinct transformation stages, not merely broad infrastructure counts.
  const transformations = processing.filter((item) =>
    /(流式|批处理|清洗|转换|etl|stream|batch|flink|spark|transform|pipeline)/i.test(item.text))
  const transformationWorkers = new Set(boxes.filter((item) => item.icon === 'worker').map((item) => item.id))
  const hasSequentialWorkerPipeline = transformationWorkers.size >= 2
    && arrows.some((edge) => transformationWorkers.has(edge.from) && transformationWorkers.has(edge.to))
    && arrows.some((edge) => (partitions.get(edge.from) === 'external' || partitions.get(edge.from) === 'experience')
      && transformationWorkers.has(edge.to))

  if (ai.length && mcp.length && Math.max(...ai.map((item) => degree.get(item.id) ?? 0), 0) >= 3) return 'agent-runtime'
  if (cloudInfra.length >= 2 && boxes.filter((item) => partitions.get(item.id) === 'application').length >= 2) return 'cloud-native'
  // A Kafka bus alone must not turn a complete ingest/process/store pipeline
  // into an event-only diagram. Prefer its data-platform semantics when the
  // independent processing and storage tiers are both present.
  if (processing.length >= 2 && data.length >= 3 && sources.length >= 1
    && (transformations.length >= 2 || hasSequentialWorkerPipeline)) return 'data-platform'
  if (queues.length && workers.length && queues.some((item) => (degree.get(item.id) ?? 0) >= 2)) return 'event-driven'

  const degrees = boxes.map((item) => degree.get(item.id) ?? 0)
  const maxDegree = Math.max(...degrees, 0)
  const averageDegree = degrees.reduce((sum, value) => sum + value, 0) / Math.max(1, degrees.length)
  if (maxDegree >= 4 && maxDegree >= Math.max(4, averageDegree * 1.8)) return 'hub-spoke'
  return 'layered'
}

export function beautifyArchitectureScene(scene: CanvasScene, options: ArchitectureBeautifyOptions = {}): ArchitectureBeautifyResult {
  const theme = options.theme ?? 'enterprise'
  const view = options.view ?? scene.architecture?.view ?? 'detail'
  const density = options.density ?? scene.architecture?.density ?? 'auto'
  const repartition = options.repartition !== false
  const relayout = options.relayout !== false
  const reroute = options.reroute !== false
  const originalBoxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const originalById = new Map(originalBoxes.map((item) => [item.id, item]))
  const semanticBoxes = originalBoxes.map((item) => enrichArchitectureBox(item))
  const partitionById = new Map(semanticBoxes.map((item) => [item.id, options.partitionOverrides?.get(item.id) ?? classifyArchitectureBox(item)]))
  const activePartitions = partitionOrder.filter((partition) => semanticBoxes.some((item) => partitionById.get(item.id) === partition))
  const composition = options.composition ?? detectArchitectureComposition(
    semanticBoxes,
    scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow'),
    partitionById,
  )
  const resolvedDensity = resolveArchitectureLayoutDensity(density, semanticBoxes.length, composition)
  const partitionGroups = repartition ? buildArchitectureGroups(scene, activePartitions, theme) : scene.groups

  let enrichedNodes = 0
  let elements: CanvasElement[] = scene.elements.map((item) => {
    if (item.type === 'arrow') return item
    const semantic = semanticBoxes.find((candidate) => candidate.id === item.id) ?? item
    const partition = partitionById.get(item.id) ?? 'application'
    const tone = themeTones[theme][partition]
    const autoGroupId = `arch-${partition}`
    const shouldAssignAutoGroup = repartition && (!item.groupId || item.groupId === 'arch-system' || item.groupId.startsWith('arch-'))
    const changed = semantic.icon !== item.icon
      || semantic.stencil !== item.stencil
      || item.tone !== tone
      || (shouldAssignAutoGroup && item.groupId !== autoGroupId)
      || (repartition && Boolean(item.laneId?.startsWith('arch-')))
    if (changed) enrichedNodes += 1
    return {
      ...semantic,
      tone,
      shape: semantic.shape ?? 'rounded',
      ...(shouldAssignAutoGroup ? { groupId: autoGroupId } : {}),
      ...(repartition && item.laneId?.startsWith('arch-') ? { laneId: undefined } : {}),
    }
  })

  let width = scene.width
  let height = scene.height

  let next: CanvasScene = {
    ...scene,
    width,
    height,
    elements,
    ...(repartition ? {
      groups: partitionGroups,
      ...(scene.lanes?.some((lane) => !lane.id.startsWith('arch-'))
        ? { lanes: scene.lanes.filter((lane) => !lane.id.startsWith('arch-')) }
        : { lanes: undefined }),
    } : {}),
    architecture: {
      theme,
      ...(theme === 'presentation' ? { presentation: true } : {}),
      view,
      density,
      ...(scene.architecture?.scenario ? { scenario: scene.architecture.scenario } : {}),
    },
  }

  if (relayout && repartition) next = layoutArchitectureTopology(
    next, partitionById, theme, resolvedDensity, composition,
    options.peerOrder === 'dependency', options.peerOrder === 'main-path' ? options.primaryPath : undefined,
    options.alignedSpacing === true, options.spatialOrder === true,
  )
  next = applyArchitectureTheme(next, theme, partitionById)
  next = applyArchitectureEmphasis(next, partitionById, options.primaryPath)
  if (reroute) next = routeArchitectureEdges(next)

  // Keep locked boxes exactly where the author placed them, even when the rest
  // of the architecture is re-partitioned.
  if (relayout) {
    next = {
      ...next,
      elements: next.elements.map((item) => {
        if (item.type === 'arrow' || !item.locked) return item
        const before = originalById.get(item.id)
        return before ? { ...item, x: before.x, y: before.y, width: before.width, height: before.height } : item
      }),
    }
  }

  return {
    scene: next,
    summary: {
      theme,
      composition,
      partitions: activePartitions.length,
      enrichedNodes,
      routedEdges: reroute ? next.elements.filter((item) => item.type === 'arrow').length : 0,
      primaryNodes: next.elements.filter((item) => item.type !== 'arrow' && item.emphasis === 'primary').length,
      bundledEdges: next.elements.filter((item) => item.type === 'arrow' && Boolean(item.bundleKey)).length,
      view,
      density,
      resolvedDensity,
    },
  }
}

export function applyArchitectureTheme(
  scene: CanvasScene,
  theme: ArchitectureTheme,
  knownPartitions?: Map<string, ArchitecturePartition>,
): CanvasScene {
  const partitions = knownPartitions ?? new Map(
    scene.elements
      .filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
      .map((item) => [item.id, classifyArchitectureBox(item)]),
  )
  return {
    ...scene,
    lanes: scene.lanes?.map((lane) => {
      const partition = partitionFromLaneId(lane.id)
      return partition ? { ...lane, tone: themeTones[theme][partition] } : lane
    }),
    groups: scene.groups?.map((group) => {
      const memberPartitions = scene.elements.flatMap((item) => item.type !== 'arrow' && item.groupId === group.id ? [partitions.get(item.id)] : []).filter(Boolean) as ArchitecturePartition[]
      const partition = dominantPartition(memberPartitions)
      return partition ? { ...group, tone: themeTones[theme][partition] } : group
    }),
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') return item
      const partition = partitions.get(item.id) ?? partitionFromLaneId(item.laneId ?? '') ?? 'application'
      return { ...item, tone: themeTones[theme][partition] }
    }),
  }
}

export function applyArchitectureEmphasis(
  scene: CanvasScene,
  knownPartitions?: Map<string, ArchitecturePartition>,
  explicitPath?: readonly string[],
): CanvasScene {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  if (!boxes.length) return scene
  const partitions = knownPartitions ?? new Map(boxes.map((item) => [item.id, classifyArchitectureBox(item)]))
  const boxById = new Map(boxes.map((item) => [item.id, item]))
  const outgoing = new Map<string, CanvasArrow[]>()
  const incoming = new Map<string, CanvasArrow[]>()
  arrows.forEach((arrow) => {
    outgoing.set(arrow.from, [...(outgoing.get(arrow.from) ?? []), arrow])
    incoming.set(arrow.to, [...(incoming.get(arrow.to) ?? []), arrow])
  })
  const weight = (item: CanvasNode | CanvasNote) => architectureNodeWeight(item)
    + (outgoing.get(item.id)?.length ?? 0) * 3
    + (incoming.get(item.id)?.length ?? 0) * 2

  const roots = boxes
    .filter((item) => isArchitectureEntry(item) || (incoming.get(item.id)?.length ?? 0) === 0)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, 7)
  const sinks = boxes
    .filter((item) => partitions.get(item.id) === 'data' || (outgoing.get(item.id)?.length ?? 0) === 0)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, 9)

  let bestPath: { nodeIds: string[]; arrowIds: string[]; score: number } | undefined
  for (const root of roots) {
    for (const sink of sinks) {
      if (root.id === sink.id) continue
      const path = directedArchitecturePath(root.id, sink.id, outgoing)
      if (!path) continue
      const score = path.nodeIds.reduce((sum, id) => sum + weight(boxById.get(id) ?? root), 0)
        + new Set(path.nodeIds.map((id) => partitions.get(id))).size * 10
        + (partitions.get(sink.id) === 'data' ? 14 : 0)
        - Math.max(0, path.nodeIds.length - 6) * 5
      if (!bestPath || score > bestPath.score) bestPath = { ...path, score }
    }
  }

  const primaryNodes = new Set(explicitPath ?? bestPath?.nodeIds ?? [])
  const primaryArrows = new Set(explicitPath ? arrows.filter((arrow) => explicitPath.some((id, index) =>
    index < explicitPath.length - 1 && arrow.from === id && arrow.to === explicitPath[index + 1])).map((arrow) => arrow.id) : bestPath?.arrowIds ?? [])
  if (!explicitPath && primaryNodes.size < Math.min(3, boxes.length)) {
    boxes
      .slice()
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, Math.max(2, Math.ceil(boxes.length * 0.22)))
      .forEach((item) => primaryNodes.add(item.id))
  }
  const adjacentToPrimary = new Set<string>()
  arrows.forEach((arrow) => {
    if (primaryNodes.has(arrow.from)) adjacentToPrimary.add(arrow.to)
    if (primaryNodes.has(arrow.to)) adjacentToPrimary.add(arrow.from)
  })

  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') {
        const emphasis: CanvasEmphasis = primaryArrows.has(item.id)
          ? 'primary'
          : primaryNodes.has(item.from) || primaryNodes.has(item.to)
            ? 'secondary'
            : 'muted'
        return { ...item, emphasis }
      }
      const emphasis: CanvasEmphasis = primaryNodes.has(item.id)
        ? 'primary'
        : adjacentToPrimary.has(item.id) || weight(item) >= 11
          ? 'secondary'
          : 'muted'
      return { ...item, emphasis }
    }),
  }
}

export function routeArchitectureEdges(scene: CanvasScene): CanvasScene {
  return routeArchitectureEdgeSubset(scene)
}

export function routeArchitectureArrowIds(scene: CanvasScene, arrowIds: Iterable<string>): CanvasScene {
  const only = new Set(arrowIds)
  if (!only.size) return scene
  const arrowCount = scene.elements.filter((item) => item.type === 'arrow').length
  if (only.size > Math.max(48, arrowCount * 0.45)) return routeArchitectureEdgeSubset(scene)
  return routeArchitectureEdgeSubset(scene, only)
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

function routeArchitectureEdgeSubset(scene: CanvasScene, only?: Set<string>): CanvasScene {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const groupFrames = new Map(canvasGroupFrames(scene).map((frame) => [frame.id, frame]))
  const groups = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const routed = new Map<string, CanvasArrow>()
  const occupied: RouteSegment[] = []
  const fanout = countArrowEndpoints(arrows, 'from')
  const fanin = countArrowEndpoints(arrows, 'to')
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
    const result = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups)
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
      const fallback = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups)
      if (fallback) routed.set(arrow.id, fallback)
    }
  }

  for (const arrow of remainingRouteOrder) {
    const result = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups)
    if (result) routed.set(arrow.id, result)
  }

  if (!only && groupedFanoutIds.size) {
    const bundled = routeDownwardGroupFanouts(arrows.filter((arrow) => groupedFanoutIds.has(arrow.id)), boxes, occupied)
    for (const [id, arrow] of bundled) routed.set(id, arrow)
    for (const arrow of arrows) {
      if (!groupedFanoutIds.has(arrow.id) || routed.has(arrow.id)) continue
      const fallback = routeArchitectureArrow(arrow, boxes, occupied, fanout, fanin, groupFrames, groups)
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
  const routingDx = fromFrame && toFrame ? (toFrame.x + toFrame.width / 2) - (fromFrame.x + fromFrame.width / 2) : dx
  const routingDy = fromFrame && toFrame ? (toFrame.y + toFrame.height / 2) - (fromFrame.y + fromFrame.height / 2) : dy
  const pairs = preferredAnchorPairs(routingDx, routingDy)
  let best: { score: number; fromAnchor: 'top' | 'right' | 'bottom' | 'left'; toAnchor: 'top' | 'right' | 'bottom' | 'left'; route: CanvasPoint[] } | undefined
  for (const [fromAnchor, toAnchor] of pairs) {
    const start = fixedAnchorPoint(from, fromAnchor)
    const end = fixedAnchorPoint(to, toAnchor)
    const route = findOrthogonalRoute(start, end, obstacles, occupied, bundleKey, fromAnchor, toAnchor)
    const score = scoreRoute(route, obstacles, occupied, bundleKey)
      + (fromAnchor === pairs[0][0] && toAnchor === pairs[0][1] ? 0 : 42)
    if (!best || score < best.score) best = { score, fromAnchor, toAnchor, route }
    if (bundleKey?.startsWith('from:') || bundleKey?.startsWith('to:')) {
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
      const route = findOrthogonalRoute(start, end, nodeObstacles, occupied, bundleKey, fromAnchor, toAnchor)
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
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const start = anchorPoint(from, arrow.fromAnchor, arrow.points?.[0] ?? toCenter)
  const end = anchorPoint(to, arrow.toAnchor, arrow.points?.at(-1) ?? fromCenter)
  return canvasArrowRoutePoints(start, end, arrow)
}

type RouteRect = { x: number; y: number; width: number; height: number }
type RouteSegment = { a: CanvasPoint; b: CanvasPoint; bundleKey?: string }
type RouteCorridorHints = { x: number[]; y: number[] }

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

function expandRect(box: RouteRect, margin: number): RouteRect {
  return { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 }
}

function findOrthogonalRoute(
  start: CanvasPoint,
  end: CanvasPoint,
  obstacles: RouteRect[],
  occupied: RouteSegment[],
  bundleKey: string | undefined,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
  hints?: RouteCorridorHints,
): CanvasPoint[] {
  const margin = 24
  const xCandidates = uniqueNumbers([
    ...(hints?.x ?? []),
    ...uniqueNumbers([
    (start.x + end.x) / 2,
    start.x + Math.sign(end.x - start.x || 1) * 56,
    end.x - Math.sign(end.x - start.x || 1) * 56,
    ...obstacles.flatMap((item) => [item.x - margin, item.x + item.width + margin]),
    ]).sort((a, b) => Math.abs(a - (start.x + end.x) / 2) - Math.abs(b - (start.x + end.x) / 2)).slice(0, 28),
  ])
  const yCandidates = uniqueNumbers([
    ...(hints?.y ?? []),
    ...uniqueNumbers([
    (start.y + end.y) / 2,
    start.y + Math.sign(end.y - start.y || 1) * 48,
    end.y - Math.sign(end.y - start.y || 1) * 48,
    ...obstacles.flatMap((item) => [item.y - margin, item.y + item.height + margin]),
    ]).sort((a, b) => Math.abs(a - (start.y + end.y) / 2) - Math.abs(b - (start.y + end.y) / 2)).slice(0, 28),
  ])

  // A single shared X or Y corridor is not enough when an intermediate node
  // blocks the direct path and the destination column is itself stacked with
  // neighboring nodes. Add a bounded two-corridor search so the route can go
  // above/below the blocker, advance through a clear vertical channel, then
  // enter the destination from the side. Keep the cross-product deliberately
  // small because this runs once per relationship.
  const doglegXs = boundedCorridorCandidates(xCandidates, 10)
  const doglegYs = boundedCorridorCandidates(yCandidates, 10)
  const doglegs: CanvasPoint[][] = []
  for (const x of doglegXs) {
    for (const y of doglegYs) {
      doglegs.push(
        [start, { x: start.x, y }, { x, y }, { x, y: end.y }, end],
        [start, { x, y: start.y }, { x, y }, { x: end.x, y }, end],
      )
    }
  }

  const candidates: CanvasPoint[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    ...xCandidates.map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...yCandidates.map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ...doglegs,
  ]
  let best = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const simplified = simplifyRoute(candidate)
    if (!routeRespectsAnchors(simplified, fromAnchor, toAnchor)) continue
    const score = scoreRoute(simplified, obstacles, occupied, bundleKey, bestScore)
    if (score < bestScore) {
      best = simplified
      bestScore = score
    }
  }

  // If every cheap candidate still cuts an obstacle, the topology needs two
  // independent corridors (for example: exit a vertically stacked source
  // column, pass above a middle blocker, then enter a stacked target column).
  // Search this deeper shape only on collision fallback so normal routing stays
  // inexpensive.
  if (bestScore >= 100_000 || routeCrossesOccupied(best, occupied, bundleKey)) {
    for (const firstX of doglegXs) {
      for (const secondX of doglegXs) {
        if (firstX === secondX) continue
        for (const y of doglegYs) {
          const candidate = simplifyRoute([
            start,
            { x: firstX, y: start.y },
            { x: firstX, y },
            { x: secondX, y },
            { x: secondX, y: end.y },
            end,
          ])
          if (!routeRespectsAnchors(candidate, fromAnchor, toAnchor)) continue
          const score = scoreRoute(candidate, obstacles, occupied, bundleKey, bestScore)
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
    }
    for (const firstY of doglegYs) {
      for (const secondY of doglegYs) {
        if (firstY === secondY) continue
        for (const x of doglegXs) {
          const candidate = simplifyRoute([
            start,
            { x: start.x, y: firstY },
            { x, y: firstY },
            { x, y: secondY },
            { x: end.x, y: secondY },
            end,
          ])
          if (!routeRespectsAnchors(candidate, fromAnchor, toAnchor)) continue
          const score = scoreRoute(candidate, obstacles, occupied, bundleKey, bestScore)
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
    }
  }
  return best
}

function routeRespectsAnchors(
  route: CanvasPoint[],
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
): boolean {
  if (route.length < 2) return true
  const start = route[0]
  const first = route[1]
  const beforeEnd = route[route.length - 2]
  const end = route[route.length - 1]
  const leavesSource = fromAnchor === 'right' ? first.x >= start.x
    : fromAnchor === 'left' ? first.x <= start.x
      : fromAnchor === 'bottom' ? first.y >= start.y
        : first.y <= start.y
  const approachesTarget = toAnchor === 'right' ? beforeEnd.x >= end.x
    : toAnchor === 'left' ? beforeEnd.x <= end.x
      : toAnchor === 'bottom' ? beforeEnd.y >= end.y
        : beforeEnd.y <= end.y
  return leavesSource && approachesTarget
}

function boundedCorridorCandidates(values: number[], preferredCount: number): number[] {
  if (!values.length) return []
  return uniqueNumbers([
    ...values.slice(0, preferredCount),
    Math.min(...values),
    Math.max(...values),
  ])
}

function scoreRoute(route: CanvasPoint[], obstacles: RouteRect[], occupied: RouteSegment[], bundleKey?: string, upperBound = Infinity): number {
  let length = 0
  let collisions = 0
  let overlapPenalty = 0
  let crossingPenalty = 0
  const bendsPenalty = Math.max(0, route.length - 2) * 22
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    length += Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y)
    // Every subsequent cost term is nonnegative. Once the partial score
    // cannot beat the best route, the exact remainder cannot change the
    // winner; avoid scoring thousands of known-losing candidates.
    if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    for (const rect of obstacles) {
      if (!segmentIntersectsRect(segment, rect)) continue
      collisions += 1
      if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    }
    for (const used of occupied) {
      const overlap = segmentOverlap(segment, used)
      overlapPenalty += overlap * (bundleKey && used.bundleKey === bundleKey ? 0.08 : 4)
      if (segmentsCross(segment, used) && (!bundleKey || used.bundleKey !== bundleKey)) {
        const groupBus = bundleKey?.startsWith('group:') || used.bundleKey?.startsWith('group:')
        crossingPenalty += groupBus ? 2200 : 960
      }
      if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    }
  }
  return length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty
}

function routeCrossesOccupied(route: CanvasPoint[], occupied: RouteSegment[], bundleKey?: string): boolean {
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    if (occupied.some((used) => segmentsCross(segment, used) && (!bundleKey || used.bundleKey !== bundleKey))) return true
  }
  return false
}

function segmentIntersectsRect(segment: RouteSegment, rect: RouteRect): boolean {
  const minX = Math.min(segment.a.x, segment.b.x)
  const maxX = Math.max(segment.a.x, segment.b.x)
  const minY = Math.min(segment.a.y, segment.b.y)
  const maxY = Math.max(segment.a.y, segment.b.y)
  if (segment.a.y === segment.b.y) {
    const y = segment.a.y
    return y > rect.y && y < rect.y + rect.height && maxX > rect.x && minX < rect.x + rect.width
  }
  if (segment.a.x === segment.b.x) {
    const x = segment.a.x
    return x > rect.x && x < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height
  }
  const inside = (point: CanvasPoint) => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height
  if (inside(segment.a) || inside(segment.b)) return true
  const topLeft = { x: rect.x, y: rect.y }
  const topRight = { x: rect.x + rect.width, y: rect.y }
  const bottomLeft = { x: rect.x, y: rect.y + rect.height }
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height }
  return lineSegmentsIntersect(segment.a, segment.b, topLeft, topRight)
    || lineSegmentsIntersect(segment.a, segment.b, topRight, bottomRight)
    || lineSegmentsIntersect(segment.a, segment.b, bottomRight, bottomLeft)
    || lineSegmentsIntersect(segment.a, segment.b, bottomLeft, topLeft)
}

function lineSegmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
  const cross = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
}

function segmentOverlap(left: RouteSegment, right: RouteSegment): number {
  const leftHorizontal = left.a.y === left.b.y
  const rightHorizontal = right.a.y === right.b.y
  if (leftHorizontal !== rightHorizontal) return 0
  if (leftHorizontal) {
    if (Math.abs(left.a.y - right.a.y) > 8) return 0
    return intervalOverlap(left.a.x, left.b.x, right.a.x, right.b.x)
  }
  if (Math.abs(left.a.x - right.a.x) > 8) return 0
  return intervalOverlap(left.a.y, left.b.y, right.a.y, right.b.y)
}

function segmentsCross(left: RouteSegment, right: RouteSegment): boolean {
  const leftHorizontal = left.a.y === left.b.y
  const rightHorizontal = right.a.y === right.b.y
  if (leftHorizontal === rightHorizontal) return false
  const horizontal = leftHorizontal ? left : right
  const vertical = leftHorizontal ? right : left
  const hx1 = Math.min(horizontal.a.x, horizontal.b.x)
  const hx2 = Math.max(horizontal.a.x, horizontal.b.x)
  const vy1 = Math.min(vertical.a.y, vertical.b.y)
  const vy2 = Math.max(vertical.a.y, vertical.b.y)
  return vertical.a.x > hx1 && vertical.a.x < hx2 && horizontal.a.y > vy1 && horizontal.a.y < vy2
}

function intervalOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)))
}

function simplifyRoute(points: CanvasPoint[]): CanvasPoint[] {
  const deduped = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  return deduped.filter((point, index) => {
    if (index === 0 || index === deduped.length - 1) return true
    const before = deduped[index - 1]
    const after = deduped[index + 1]
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
  })
}

function addOccupiedSegments(route: CanvasPoint[], occupied: RouteSegment[], bundleKey?: string) {
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index]
    const b = route[index + 1]
    if (a.x !== b.x && a.y !== b.y) continue
    occupied.push({ a, b, bundleKey })
  }
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value)))]
}

function buildArchitectureGroups(
  scene: CanvasScene,
  active: ArchitecturePartition[],
  theme: ArchitectureTheme,
): CanvasGroup[] {
  const retained = (scene.groups ?? []).filter((group) => {
    if (!group.id.startsWith('arch-')) return true
    return group.id === 'arch-system' && group.description !== 'Architecture system boundary'
  })
  const existingSystem = retained.find((group) => group.c4Type === 'software-system')
  const groups = [...retained]
  for (const partition of active) {
    const id = `arch-${partition}`
    groups.push({
      id,
      label: partitionMeta[partition].label,
      kind: 'boundary',
      tone: themeTones[theme][partition],
      ...(partition !== 'external' && existingSystem ? { parentId: existingSystem.id } : {}),
    })
  }
  return groups
}

function layoutArchitectureTopology(
  scene: CanvasScene,
  partitions: Map<string, ArchitecturePartition>,
  theme: ArchitectureTheme,
  density: Exclude<CanvasArchitectureDensity, 'auto'>,
  composition: ArchitectureComposition,
  dependencyOrder = false,
  mainPath?: readonly string[],
  alignedSpacing = false,
  spatialOrder = false,
): CanvasScene {
  const metrics = architectureTopologyMetrics(theme, density, alignedSpacing)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const sourceOrder = new Map(boxes.map((item, index) => [item.id, index]))
  const connectionDegree = new Map(boxes.map((item) => [item.id, 0]))
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow') return
    connectionDegree.set(item.from, (connectionDegree.get(item.from) ?? 0) + 1)
    connectionDegree.set(item.to, (connectionDegree.get(item.to) ?? 0) + 1)
  })
  const byId = new Map(boxes.map((item) => [item.id, item]))
  const pathRanks = new Map(mainPath?.map((id, index) => [id, index]) ?? [])
  // Cross-region dependency-aware barycenters. Ordering is decided before
  // assigning positions and never uses generated coordinates or input array
  // order as a graph invariant. Weakly connected nodes keep semantic order.
  const affinity = new Map<string, { sum: number; weight: number }>()
  if (dependencyOrder) {
    for (const edge of scene.elements) {
      if (edge.type !== 'arrow') continue
      const source = byId.get(edge.from), target = byId.get(edge.to)
      if (!source || !target || partitions.get(source.id) === partitions.get(target.id)) continue
      for (const [id, opposite, weight] of [[source.id, target, 1], [target.id, source, 2]] as const) {
        const prev = affinity.get(id) ?? { sum: 0, weight: 0 }
        prev.sum += architectureSortKey(opposite) * weight
        prev.weight += weight
        affinity.set(id, prev)
      }
    }
  }
  const members = new Map<ArchitecturePartition, Array<CanvasNode | CanvasNote>>()
  for (const partition of partitionOrder) {
    const placementMode = architectureCompositionPartitionPlacement(composition, partition)
    members.set(partition, boxes
      .filter((item) => partitions.get(item.id) === partition && !item.locked)
      .sort((a, b) => mainPath && (pathRanks.has(a.id) || pathRanks.has(b.id))
        ? (pathRanks.get(a.id) ?? Infinity) - (pathRanks.get(b.id) ?? Infinity)
        : dependencyOrder && affinity.has(a.id) && affinity.has(b.id)
        ? (affinity.get(a.id)!.sum / affinity.get(a.id)!.weight - affinity.get(b.id)!.sum / affinity.get(b.id)!.weight)
          || architectureSortKey(a) - architectureSortKey(b) || a.id.localeCompare(b.id, 'en')
        : placementMode === 'center'
        ? (connectionDegree.get(b.id) ?? 0) - (connectionDegree.get(a.id) ?? 0) || architectureSortKey(a) - architectureSortKey(b) || (sourceOrder.get(a.id) ?? 0) - (sourceOrder.get(b.id) ?? 0)
        : architectureSortKey(a) - architectureSortKey(b) || a.y - b.y || a.x - b.x))
  }

  const layouts = new Map<ArchitecturePartition, ArchitectureClusterLayout>()
  for (const partition of partitionOrder) {
    const items = members.get(partition) ?? []
    if (!items.length) continue
    layouts.set(partition, measureArchitectureCluster(partition, items.length, metrics, composition))
  }

  const topPartitions = (['external', 'experience', 'application'] as ArchitecturePartition[]).filter((partition) => layouts.has(partition))
  const topWidth = architectureRowWidth(topPartitions, layouts, metrics.clusterGap)
  const processingWidth = layouts.get('processing')?.width ?? 0
  const dataWidth = layouts.get('data')?.width ?? 0
  const rowWidth = Math.max(topWidth, processingWidth, dataWidth)
  const topHeight = Math.max(0, ...topPartitions.map((partition) => layouts.get(partition)?.height ?? 0))
  const processingHeight = layouts.get('processing')?.height ?? 0
  const dataHeight = layouts.get('data')?.height ?? 0
  const positionById = new Map<string, { x: number; y: number }>()

  const placePartition = (partition: ArchitecturePartition, x: number, y: number) => {
    const layout = layouts.get(partition)
    const items = members.get(partition) ?? []
    if (!layout) return
    const centerWeighted = architectureCompositionPartitionPlacement(composition, partition) === 'center'
    const slots = centerWeighted
      ? architectureCenterOutSlots(layout.columns, layout.rows, items.length)
      : items.map((_, index) => index)
    items.forEach((item, index) => {
      const slot = slots[index] ?? index
      const col = slot % layout.columns
      const row = Math.floor(slot / layout.columns)
      const rowStart = row * layout.columns
      const rowCount = Math.min(layout.columns, items.length - rowStart)
      const rowOffset = centerWeighted ? 0 : Math.max(0, (layout.columns - rowCount) * metrics.columnStep / 2)
      positionById.set(item.id, {
        x: metrics.canvasMargin + x + metrics.groupPaddingX + rowOffset + col * metrics.columnStep,
        y: y + metrics.groupHeader + row * metrics.rowStep,
      })
    })
  }

  if (composition !== 'layered') {
    const rows = architectureCompositionRows(composition)
      .map((row) => row.filter((partition) => layouts.has(partition)))
      .filter((row) => row.length > 0)
    const rowWidths = rows.map((row) => architectureRowWidth(row, layouts, metrics.clusterGap))
    const compositionWidth = Math.max(0, ...rowWidths)
    const placedPartitions = new Map<ArchitecturePartition, { x: number; width: number }>()
    let compositionY = metrics.canvasMargin
    rows.forEach((row, rowIndex) => {
      const rowHeight = Math.max(0, ...row.map((partition) => layouts.get(partition)?.height ?? 0))
      let rowX = Math.max(0, (compositionWidth - rowWidths[rowIndex]) / 2)
      if (composition === 'cloud-native' && rowIndex === 0 && row.includes('external')) rowX = 0
      if (composition === 'data-platform' && rowIndex === 0 && row.length === 1 && row[0] === 'experience') {
        rowX = Math.max(0, compositionWidth - rowWidths[rowIndex])
      }
      if ((composition === 'agent-runtime' || composition === 'event-driven') && row.length === 1) {
        const anchorPartition = composition === 'event-driven' && row[0] === 'data' ? 'processing' : 'application'
        const anchor = placedPartitions.get(anchorPartition)
        if (anchor) rowX = Math.max(0, Math.min(compositionWidth - rowWidths[rowIndex], anchor.x + anchor.width / 2 - rowWidths[rowIndex] / 2))
      }
      row.forEach((partition) => {
        const layout = layouts.get(partition)
        if (!layout) return
        placePartition(partition, rowX, compositionY)
        placedPartitions.set(partition, { x: rowX, width: layout.width })
        rowX += layout.width + metrics.clusterGap
      })
      compositionY += rowHeight + metrics.rowGap
    })
    return applyArchitectureLayoutPositions(
      scene,
      boxes,
      positionById,
      compositionWidth + metrics.canvasMargin * 2,
      Math.max(metrics.canvasMargin, compositionY - metrics.rowGap) + metrics.canvasMargin,
      metrics,
      spatialOrder,
    )
  }

  let cursorX = Math.max(0, (rowWidth - topWidth) / 2)
  let applicationCenter = rowWidth / 2
  for (const partition of topPartitions) {
    const layout = layouts.get(partition)
    if (!layout) continue
    placePartition(partition, cursorX, metrics.canvasMargin)
    if (partition === 'application') applicationCenter = cursorX + layout.width / 2
    cursorX += layout.width + metrics.clusterGap
  }

  let nextRowY = metrics.canvasMargin + topHeight
  if (processingWidth > 0) {
    nextRowY += metrics.rowGap
    const start = Math.max(0, Math.min(rowWidth - processingWidth, applicationCenter - processingWidth / 2))
    placePartition('processing', start, nextRowY)
    nextRowY += processingHeight
  }
  if (dataWidth > 0) {
    nextRowY += metrics.rowGap
    const start = Math.max(0, Math.min(rowWidth - dataWidth, applicationCenter - dataWidth / 2))
    placePartition('data', start, nextRowY)
    nextRowY += dataHeight
  }

  return applyArchitectureLayoutPositions(
    scene,
    boxes,
    positionById,
    rowWidth + metrics.canvasMargin * 2,
    Math.max(metrics.canvasMargin + topHeight, nextRowY) + metrics.canvasMargin,
    metrics,
    spatialOrder,
  )
}

function architectureCompositionRows(composition: Exclude<ArchitectureComposition, 'layered'>): ArchitecturePartition[][] {
  if (composition === 'hub-spoke') return [
    ['external', 'experience'],
    ['application'],
    ['processing', 'data'],
  ]
  if (composition === 'agent-runtime') return [
    ['external', 'experience'],
    ['application', 'data'],
    ['processing'],
  ]
  if (composition === 'event-driven') return [
    ['external', 'experience', 'application'],
    ['processing'],
    ['data'],
  ]
  if (composition === 'data-platform') return [
    ['experience'],
    ['external', 'processing', 'data', 'application'],
  ]
  return [
    ['external', 'experience'],
    ['application', 'processing'],
    ['data'],
  ]
}

function architectureCompositionPartitionPlacement(
  composition: ArchitectureComposition,
  partition: ArchitecturePartition,
): 'standard' | 'center' {
  if (composition === 'event-driven' && partition === 'processing') return 'center'
  if ((composition === 'hub-spoke' || composition === 'agent-runtime') && partition === 'application') return 'center'
  return 'standard'
}

function architectureCenterOutSlots(columns: number, rows: number, count: number): number[] {
  const centerX = (columns - 1) / 2
  const centerY = (rows - 1) / 2
  return Array.from({ length: columns * rows }, (_, index) => index)
    .sort((left, right) => {
      const leftCol = left % columns
      const leftRow = Math.floor(left / columns)
      const rightCol = right % columns
      const rightRow = Math.floor(right / columns)
      const leftDistance = Math.abs(leftCol - centerX) + Math.abs(leftRow - centerY)
      const rightDistance = Math.abs(rightCol - centerX) + Math.abs(rightRow - centerY)
      return leftDistance - rightDistance || leftRow - rightRow || leftCol - rightCol
    })
    .slice(0, count)
}

function applyArchitectureLayoutPositions(
  scene: CanvasScene,
  boxes: Array<CanvasNode | CanvasNote>,
  positionById: Map<string, { x: number; y: number }>,
  unlockedWidth: number,
  unlockedHeight: number,
  metrics: ReturnType<typeof architectureTopologyMetrics>,
  spatialOrder = false,
): CanvasScene {
  const locked = boxes.filter((item) => item.locked)
  const lockedRight = Math.max(0, ...locked.map((item) => item.x + item.width + metrics.canvasMargin))
  const lockedBottom = Math.max(0, ...locked.map((item) => item.y + item.height + metrics.canvasMargin))
  const occupied = locked.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height }))
  const placements = new Map<string, CanvasNode | CanvasNote>()
  const placementOrder = boxes.filter((item) => !item.locked && positionById.has(item.id))
  if (spatialOrder) placementOrder.sort((a, b) => {
    const left = positionById.get(a.id)!, right = positionById.get(b.id)!
    return left.y - right.y || left.x - right.x || a.id.localeCompare(b.id, 'en')
  })
  for (const item of placementOrder) {
    const position = positionById.get(item.id)
    if (!position) continue
    const placed = {
      ...item,
      x: position.x,
      y: position.y,
      width: Math.max(metrics.nodeMinWidth, Math.min(metrics.nodeMaxWidth, item.width)),
      height: Math.max(metrics.nodeMinHeight, Math.min(metrics.nodeMaxHeight, item.height)),
    }
    let collisions: typeof occupied
    do {
      collisions = occupied.filter((box) => placed.x < box.x + box.width + architectureNodeClearance
        && placed.x + placed.width + architectureNodeClearance > box.x
        && placed.y < box.y + box.height + architectureNodeClearance
        && placed.y + placed.height + architectureNodeClearance > box.y)
      if (collisions.length) placed.y = Math.max(...collisions.map((box) => box.y + box.height + architectureNodeClearance))
    } while (collisions.length)
    occupied.push(placed)
    placements.set(item.id, placed)
  }
  const elements = scene.elements.map((item) => placements.get(item.id) ?? item)
  return {
    ...scene,
    width: Math.max(960, unlockedWidth, lockedRight, ...occupied.map((item) => item.x + item.width + metrics.canvasMargin)),
    height: Math.max(620, unlockedHeight, lockedBottom, ...occupied.map((item) => item.y + item.height + metrics.canvasMargin)),
    elements,
  }
}

interface ArchitectureClusterLayout {
  columns: number
  rows: number
  width: number
  height: number
}

function measureArchitectureCluster(
  partition: ArchitecturePartition,
  count: number,
  metrics: ReturnType<typeof architectureTopologyMetrics>,
  composition: ArchitectureComposition = 'layered',
): ArchitectureClusterLayout {
  const maxColumns = composition === 'data-platform' && partition === 'data' ? 2
    : partition === 'external' ? 1
    : partition === 'experience' ? 2
      : partition === 'application' ? 3
        : partition === 'processing' ? 3
          : 4
  const columns = Math.max(1, Math.min(maxColumns, count))
  const rows = Math.max(1, Math.ceil(count / columns))
  return {
    columns,
    rows,
    width: metrics.groupPaddingX * 2 + metrics.nodeMaxWidth + Math.max(0, columns - 1) * metrics.columnStep,
    height: metrics.groupHeader + metrics.groupPaddingBottom + metrics.nodeMaxHeight + Math.max(0, rows - 1) * metrics.rowStep,
  }
}

function architectureRowWidth(
  partitions: ArchitecturePartition[],
  layouts: Map<ArchitecturePartition, ArchitectureClusterLayout>,
  gap: number,
): number {
  return partitions.reduce((total, partition) => total + (layouts.get(partition)?.width ?? 0), 0)
    + Math.max(0, partitions.length - 1) * gap
}

function resolveArchitectureLayoutDensity(
  density: CanvasArchitectureDensity,
  nodeCount: number,
  composition: ArchitectureComposition = 'layered',
): Exclude<CanvasArchitectureDensity, 'auto'> {
  if (density !== 'auto') return density
  if (nodeCount >= 46) return 'dense'
  if (nodeCount >= 10 && (composition === 'event-driven' || composition === 'data-platform' || composition === 'agent-runtime' || composition === 'cloud-native')) return 'compact'
  if (nodeCount >= 22) return 'compact'
  return 'comfortable'
}

function architectureTopologyMetrics(
  theme: ArchitectureTheme,
  density: Exclude<CanvasArchitectureDensity, 'auto'>,
  alignedSpacing = false,
) {
  const presentation = theme === 'presentation'
  if (density === 'dense') {
    return {
      canvasMargin: 42,
      clusterGap: presentation ? 44 : 38,
      rowGap: presentation ? 48 : 42,
      groupPaddingX: 24,
      groupHeader: 48,
      groupPaddingBottom: 22,
      columnStep: alignedSpacing ? 150 + architectureNodeClearance : 166,
      rowStep: alignedSpacing ? 68 + architectureNodeClearance : 88,
      nodeMinWidth: 132,
      nodeMaxWidth: 150,
      nodeMinHeight: 58,
      nodeMaxHeight: 68,
    }
  }
  if (density === 'compact') {
    return {
      canvasMargin: 50,
      clusterGap: presentation ? 54 : 48,
      rowGap: presentation ? 56 : 50,
      groupPaddingX: 28,
      groupHeader: 52,
      groupPaddingBottom: 26,
      columnStep: alignedSpacing ? 170 + architectureNodeClearance : 188,
      rowStep: 98,
      nodeMinWidth: 146,
      nodeMaxWidth: 170,
      nodeMinHeight: 62,
      nodeMaxHeight: 74,
    }
  }
  return {
    canvasMargin: 58,
    clusterGap: presentation ? 64 : 56,
    rowGap: presentation ? 64 : 58,
    groupPaddingX: 32,
    groupHeader: 56,
    groupPaddingBottom: 30,
    columnStep: alignedSpacing ? 188 + architectureNodeClearance : 210,
    rowStep: 110,
    nodeMinWidth: 158,
    nodeMaxWidth: 188,
    nodeMinHeight: 66,
    nodeMaxHeight: 80,
  }
}

function enrichArchitectureBox<T extends CanvasNode | CanvasNote>(item: T): T {
  const inferredStencil = item.stencil ?? inferStencil(item.text, item.subtitle)
  const inferredIcon = item.icon ?? iconForStencil(inferredStencil) ?? inferIcon(item.text, item.subtitle)
  return {
    ...item,
    ...(inferredStencil ? { stencil: inferredStencil } : {}),
    ...(inferredIcon ? { icon: inferredIcon } : {}),
  }
}

function classifyArchitectureBox(item: CanvasNode | CanvasNote): ArchitecturePartition {
  const semanticText = `${item.text} ${item.subtitle ?? ''}`.toLowerCase()
  if (item.icon === 'user' || item.icon === 'external') return 'external'
  if ((item.icon === 'auth' || item.icon === 'ai' || item.icon === 'mcp') && /\b(provider|third[- ]party|external|vendor)\b|第三方|外部供应商|外部服务/.test(semanticText)) return 'external'
  if (item.icon === 'web') return 'experience'
  if (item.icon === 'queue' || item.icon === 'worker' || item.icon === 'scheduler') return 'processing'
  if (item.icon === 'database' || item.icon === 'cache' || item.icon === 'file' || item.icon === 'search' || item.icon === 'vector') return 'data'
  if (item.icon === 'api' || item.icon === 'gateway' || item.icon === 'service' || item.icon === 'cloud' || item.icon === 'auth' || item.icon === 'ai' || item.icon === 'mcp') return 'application'
  if (item.stencil === 'react' || item.stencil === 'vue') return 'experience'
  if (item.stencil === 'kafka' || item.stencil === 'rabbitmq') return 'processing'
  if (['postgres', 'mysql', 'redis', 'qdrant', 'opensearch', 'elasticsearch', 'mongodb', 'minio'].includes(item.stencil ?? '')) return 'data'
  return 'application'
}

function inferStencil(text: string, subtitle?: string): CanvasStencil | undefined {
  const value = `${text} ${subtitle ?? ''}`.toLowerCase()
  const entries: Array<[CanvasStencil, RegExp]> = [
    ['spring', /\bspring(?:\s*boot)?\b/],
    ['react', /\breact\b/],
    ['vue', /\bvue(?:\.js)?\b/],
    ['postgres', /\bpostgres(?:ql)?\b/],
    ['mysql', /\bmysql\b/],
    ['redis', /\bredis\b/],
    ['kafka', /\bkafka\b/],
    ['rabbitmq', /\brabbit\s*mq\b|\brabbitmq\b/],
    ['docker', /\bdocker\b/],
    ['kubernetes', /\bkubernetes\b|\bk8s\b/],
    ['qdrant', /\bqdrant\b/],
    ['opensearch', /\bopensearch\b/],
    ['elasticsearch', /\belasticsearch\b|\belastic\s+search\b/],
    ['mongodb', /\bmongo(?:db)?\b/],
    ['minio', /\bminio\b|\bs3\b/],
    ['nginx', /\bnginx\b/],
    ['grpc', /\bgrpc\b/],
    ['oidc', /\boidc\b|\bopenid\s+connect\b/],
    ['openai', /\bopenai\b|\bllm\b|\bembedding provider\b|大模型|模型服务/],
    ['mcp', /\bmcp\b|model context protocol/],
  ]
  return entries.find(([, pattern]) => pattern.test(value))?.[0]
}

function inferIcon(text: string, subtitle?: string): CanvasIcon | undefined {
  const value = `${text} ${subtitle ?? ''}`.toLowerCase()
  if (/\b(browser|frontend|front-end|web app|ui)\b|前端|浏览器/.test(value)) return 'web'
  if (/\b(gateway|reverse proxy|proxy)\b|网关|反向代理/.test(value)) return 'gateway'
  if (/\b(api|rest|graphql)\b|接口/.test(value)) return 'api'
  if (/\bmcp\b|model context protocol/.test(value)) return 'mcp'
  if (/\b(worker|processor|parser|indexer|sync worker|consumer)\b|任务|解析|索引|采集/.test(value)) return 'worker'
  if (/\b(scheduler|cron|schedule|timer)\b|调度|定时/.test(value)) return 'scheduler'
  if (/\b(agent|llm|model runtime|embedding provider|ai runtime)\b|大模型|智能体|模型服务/.test(value)) return 'ai'
  if (/\b(service|runtime|application)\b|服务/.test(value)) return 'service'
  if (/\b(cache)\b|缓存/.test(value)) return 'cache'
  if (/\b(queue|topic|broker|event bus|mq)\b|队列|消息/.test(value)) return 'queue'
  if (/\b(qdrant|vector db|vector store|vector index)\b|向量库|向量检索/.test(value)) return 'vector'
  if (/\b(opensearch|elasticsearch|search index|search engine)\b|搜索引擎|全文检索|搜索索引/.test(value)) return 'search'
  if (/\b(database|db|sql)\b|数据库/.test(value)) return 'database'
  if (/\b(file|blob|object storage|storage)\b|文件|对象存储/.test(value)) return 'file'
  if (/\b(user|person|client)\b|用户|员工/.test(value)) return 'user'
  if (/\b(auth|identity|oidc|oauth|sso)\b|认证|身份/.test(value)) return 'auth'
  if (/\b(provider|external|third[- ]party)\b|外部|第三方/.test(value)) return 'external'
  return undefined
}

function architectureNodeWeight(item: CanvasNode | CanvasNote): number {
  const iconWeight: Partial<Record<CanvasIcon, number>> = {
    gateway: 15,
    api: 14,
    service: 13,
    worker: 12,
    ai: 12,
    mcp: 11,
    auth: 10,
    web: 9,
    queue: 9,
    search: 9,
    vector: 9,
    database: 8,
    cache: 7,
    file: 6,
    user: 5,
    external: 4,
    scheduler: 6,
    cloud: 6,
  }
  const c4Weight = item.c4Type === 'software-system' ? 5 : item.c4Type === 'container' ? 4 : item.c4Type === 'component' ? 2 : 0
  return (item.icon ? iconWeight[item.icon] ?? 5 : 5) + c4Weight
}

function isArchitectureEntry(item: CanvasNode | CanvasNote): boolean {
  return item.icon === 'user'
    || item.icon === 'web'
    || item.icon === 'gateway'
    || item.icon === 'api'
    || item.icon === 'external'
    || item.icon === 'auth'
}

function directedArchitecturePath(
  startId: string,
  targetId: string,
  outgoing: Map<string, CanvasArrow[]>,
): { nodeIds: string[]; arrowIds: string[] } | undefined {
  const queue = [startId]
  const seen = new Set([startId])
  const previous = new Map<string, { nodeId: string; arrowId: string }>()
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === targetId) break
    for (const arrow of outgoing.get(current) ?? []) {
      if (seen.has(arrow.to)) continue
      seen.add(arrow.to)
      previous.set(arrow.to, { nodeId: current, arrowId: arrow.id })
      queue.push(arrow.to)
    }
  }
  if (!seen.has(targetId)) return undefined
  const nodeIds = [targetId]
  const arrowIds: string[] = []
  let current = targetId
  while (current !== startId) {
    const step = previous.get(current)
    if (!step) return undefined
    arrowIds.push(step.arrowId)
    current = step.nodeId
    nodeIds.push(current)
  }
  nodeIds.reverse()
  arrowIds.reverse()
  return { nodeIds, arrowIds }
}

function iconForStencil(stencil?: CanvasStencil): CanvasIcon | undefined {
  if (!stencil) return undefined
  if (stencil === 'react' || stencil === 'vue') return 'web'
  if (stencil === 'spring') return 'service'
  if (stencil === 'redis') return 'cache'
  if (stencil === 'kafka' || stencil === 'rabbitmq') return 'queue'
  if (stencil === 'qdrant') return 'vector'
  if (stencil === 'opensearch' || stencil === 'elasticsearch') return 'search'
  if (stencil === 'postgres' || stencil === 'mysql' || stencil === 'mongodb') return 'database'
  if (stencil === 'minio') return 'file'
  if (stencil === 'docker' || stencil === 'kubernetes') return 'cloud'
  if (stencil === 'nginx') return 'gateway'
  if (stencil === 'oidc') return 'auth'
  if (stencil === 'openai') return 'ai'
  if (stencil === 'mcp') return 'mcp'
  if (stencil === 'grpc') return 'api'
  return undefined
}

function architectureSortKey(item: CanvasNode | CanvasNote): number {
  if (item.icon === 'user' || item.icon === 'external') return 0
  if (item.icon === 'web') return 10
  if (item.icon === 'gateway' || item.icon === 'api' || item.icon === 'auth' || item.icon === 'mcp') return 20
  if (item.icon === 'service' || item.icon === 'ai') return 30
  if (item.icon === 'worker' || item.icon === 'scheduler' || item.icon === 'queue') return 40
  if (item.icon === 'cache') return 50
  if (item.icon === 'search' || item.icon === 'vector') return 60
  if (item.icon === 'database') return 70
  if (item.icon === 'file') return 80
  return 80
}

function partitionFromLaneId(laneId: string): ArchitecturePartition | undefined {
  return partitionOrder.find((partition) => laneId === `arch-${partition}`)
}

function dominantPartition(values: ArchitecturePartition[]): ArchitecturePartition | undefined {
  if (!values.length) return undefined
  const counts = new Map<ArchitecturePartition, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
}
