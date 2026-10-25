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
import { routeArchitectureEdges } from './architectureRouting.js'
export { routeArchitectureEdges, routeArchitectureArrowIds, routeArchitectureEdgesIncremental } from './architectureRouting.js'

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
