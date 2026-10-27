import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js'
import { CANVAS_PORT_MIN_SEPARATION_PX, canvasArrowBoxRoute, canvasGroupFrames, type CanvasArrow, type CanvasNode, type CanvasPoint, type CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureDesign.js'
import { canvasNativeOrthogonalRoute } from './canvas-native-route.js'

const engine = new ELK()
export type ElkBenchmarkVariant = 'flat' | 'compound' | 'native' | 'native-compound'
export type ElkLayoutConfig = {
  direction?: 'RIGHT' | 'DOWN'
  nodeSpacing?: number
  layerSpacing?: number
  /** ELK Layered graph-level wrapping; only used by isolated experiments. */
  wrapping?: 'OFF' | 'SINGLE_EDGE' | 'MULTI_EDGE'
  aspectRatio?: number
  /** Isolated, two-pass native route experiment. The caller provides the
   * first-pass node geometry and ELK allocates independent, fixed-side ports. */
  portSideMode?: 'relative'
  /** Newly generated layouts only: grow node height to hold every real
   * side port. This changes geometry and is NOT an editable-scene relayout. */
  growGeneratedPortHeight?: boolean
  /** Only allow a rigid whole-scene translation matching ALL pinned nodes
   * inside the original Canvas; never perform a partial pinned ELK relayout. */
  rigidLockedPlacement?: boolean
  /** Experimental frame-only transformation: preserve every route/port and
   * node dimension, trim redundant outer ELK padding to 30px. */
  compactBounds?: boolean
}

type Shape = { id: string; x?: number; y?: number; width?: number; height?: number; children?: Shape[] }

function collectPositions(shapes: readonly Shape[] | undefined, map = new Map<string, { x: number; y: number }>(), x = 0, y = 0) {
  for (const shape of shapes ?? []) {
    const absoluteX = x + (shape.x ?? 0)
    const absoluteY = y + (shape.y ?? 0)
    map.set(shape.id, { x: absoluteX, y: absoluteY })
    collectPositions(shape.children, map, absoluteX, absoluteY)
  }
  return map
}

function collectNativeEdges(graph: ElkNode, positions: Map<string, CanvasPoint>) {
  const result = new Map<string, { edge: ElkExtendedEdge; offset: CanvasPoint }>()
  function walk(node: ElkNode) {
    for (const edge of node.edges ?? []) {
      if (result.has(edge.id)) throw new Error(`Duplicate ELK edge: ${edge.id}`)
      // INCLUDE_CHILDREN stores edge sections relative to edge.container,
      // not necessarily the root edges array or either endpoint node.
      const owner = edge.container ?? node.id
      const offset = positions.get(owner)
      if (!offset) throw new Error(`Unknown ELK edge coordinate container: ${owner}`)
      result.set(edge.id, { edge, offset })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(graph)
  return result
}

function translateElkGeometry(scene: CanvasScene, dx: number, dy: number): CanvasScene {
  const move = (point: CanvasPoint): CanvasPoint => ({ x: point.x + dx, y: point.y + dy })
  return {
    ...scene,
    elements: scene.elements.map((item) => item.type === 'arrow' ? {
      ...item,
      points: item.points?.map(move),
      start: item.start ? move(item.start) : undefined,
      end: item.end ? move(item.end) : undefined,
      labelPosition: item.labelPosition ? move(item.labelPosition) : undefined,
    } : { ...item, x: item.x + dx, y: item.y + dy }),
  }
}

/** A translation, not scaling or layout: never improve fit by shrinking
 * authored text or geometry. Include the complete routed arrow envelopes,
 * not just the node bounds, so exterior paths remain inside the Canvas. */
export function compactElkSceneBounds(scene: CanvasScene, padding = 30): CanvasScene {
  if (!Number.isFinite(padding) || padding < 0) throw new Error('Invalid Canvas padding')
  if (scene.lanes?.length || scene.elements.some((item) => item.type === 'note')) {
    throw new Error('ELK boundary compaction supports only node/edge architecture scenes')
  }
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const points = [...nodes.values()].flatMap((item) => [
    { x: item.x, y: item.y }, { x: item.x + item.width, y: item.y + item.height },
  ])
  // Auto-generated group frames extend beyond their member node rectangles,
  // including their top title band. Omitting them clips the boundary/header
  // while all nodes and arrows superficially pass the usual collision gate.
  for (const frame of canvasGroupFrames(scene)) {
    points.push({ x: frame.x, y: frame.y },
      { x: frame.x + frame.width, y: frame.y + frame.height })
  }
  for (const arrow of scene.elements) {
    if (arrow.type !== 'arrow') continue
    const source = nodes.get(arrow.from), target = nodes.get(arrow.to)
    if (!source || !target) throw new Error(`Unknown ELK relation endpoint: ${arrow.id}`)
    points.push(...canvasArrowBoxRoute(source, target, arrow))
    if (arrow.labelPosition) points.push(arrow.labelPosition)
  }
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Invalid ELK geometry for boundary compaction')
  }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const dx = padding - minX, dy = padding - minY
  return {
    ...translateElkGeometry(scene, dx, dy),
    width: Math.ceil(maxX - minX + padding * 2),
    height: Math.ceil(maxY - minY + padding * 2),
  }
}

/** Feasibility check for an EXACT original Canvas size and untouched locked
 * coordinates. Rigid translation is the only permitted adaptation: an ELK
 * result that needs squeezing or contradicts two locked nodes is rejected. */
export function placeElkWithinOriginalCanvas(
  original: CanvasScene, candidate: CanvasScene, padding = 30,
): CanvasScene | null {
  const packed = compactElkSceneBounds(candidate, padding)
  if (packed.width > original.width || packed.height > original.height) return null
  const packedNodes = new Map(packed.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const locked = original.elements.filter((item): item is CanvasNode => item.type === 'node' && !!item.locked)
  const dx = locked.length
    ? locked[0].x - (packedNodes.get(locked[0].id)?.x ?? Infinity)
    : Math.floor((original.width - packed.width) / 2)
  const dy = locked.length
    ? locked[0].y - (packedNodes.get(locked[0].id)?.y ?? Infinity)
    : Math.floor((original.height - packed.height) / 2)
  if (!Number.isFinite(dx) || !Number.isFinite(dy)
    || dx < 0 || dy < 0
    || dx + packed.width > original.width || dy + packed.height > original.height
    || locked.some((node) => {
      const next = packedNodes.get(node.id)
      return !next || next.x + dx !== node.x || next.y + dy !== node.y
    })) return null
  return { ...translateElkGeometry(packed, dx, dy),
    width: original.width, height: original.height }
}

/** Experimental non-scaling fit: redistribute only empty horizontal gutters
 * between complete node-width intervals. Each node retains its exact size;
 * every routed polyline receives the same monotone X transform, so a route
 * cannot be detached from its own port. Full-scene gates still decide adoption.
 * Locked/manual geometry is never subjected to this free-space compression. */
export function fitElkCorridorsWithinOriginalCanvas(original: CanvasScene, candidate: CanvasScene): CanvasScene | null {
  const packed = compactElkSceneBounds(candidate)
  const direct = placeElkWithinOriginalCanvas(original, packed)
  if (direct) return direct
  if (packed.height > original.height || packed.width <= original.width
    || packed.elements.some((item) => item.type !== 'arrow' && item.locked)) return null

  const intervals = packed.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map(({ x, width }) => ({ from: x, to: x + width }))
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const occupied: typeof intervals = []
  for (const interval of intervals) {
    const last = occupied.at(-1)
    if (last && last.to >= interval.from) last.to = Math.max(last.to, interval.to)
    else occupied.push({ ...interval })
  }
  const gaps = occupied.slice(1).map((interval, index) => ({
    from: occupied[index].to, to: interval.from,
    free: Math.max(0, interval.from - occupied[index].to - CANVAS_PORT_MIN_SEPARATION_PX),
  }))
  const required = packed.width - original.width
  const capacity = gaps.reduce((sum, gap) => sum + gap.free, 0)
  if (!capacity || capacity < required) return null

  let outstanding = required
  const cuts = gaps.map((gap) => {
    const allocated = Math.min(outstanding, gap.free, Math.floor(required * gap.free / capacity))
    outstanding -= allocated
    return allocated
  })
  for (let index = 0; index < gaps.length && outstanding > 0; index++) {
    const extra = Math.min(outstanding, gaps[index].free - cuts[index])
    cuts[index] += extra
    outstanding -= extra
  }
  if (outstanding) return null

  const compressedX = (x: number) => Math.round(x - gaps.reduce((sum, gap, index) => sum
    + (x >= gap.to ? cuts[index]
      : x > gap.from ? cuts[index] * (x - gap.from) / (gap.to - gap.from) : 0), 0))
  const moved: CanvasScene = {
    ...packed,
    elements: packed.elements.map((item) => item.type === 'arrow' ? {
      ...item,
      points: item.points?.map((point) => ({ ...point, x: compressedX(point.x) })),
      start: item.start && { ...item.start, x: compressedX(item.start.x) },
      end: item.end && { ...item.end, x: compressedX(item.end.x) },
      labelPosition: item.labelPosition && { ...item.labelPosition, x: compressedX(item.labelPosition.x) },
    } : { ...item, x: compressedX(item.x) }),
  }
  return placeElkWithinOriginalCanvas(original, moved)
}

/** Prototype adapter: geometry only. Existing CanvasScene is never changed in place. */
export async function layoutWithElk(scene: CanvasScene, variant: ElkBenchmarkVariant, config: ElkLayoutConfig = {}): Promise<CanvasScene> {
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = scene.elements.filter((item) => item.type === 'arrow')
  if (!nodes.length) throw new Error('No Canvas nodes to lay out')
  const nativeRoutes = variant === 'native' || variant === 'native-compound'
  if (config.portSideMode && !nativeRoutes) {
    throw new Error('ELK fixed-side ports require native edge geometry')
  }
  if (config.portSideMode && config.wrapping === 'MULTI_EDGE') {
    // elkjs@0.12.0 throws an internal TypeError on valid fan-out graphs with
    // this combination. Reject the invalid experiment before invoking ELK.
    throw new Error('ELK fixed-side ports cannot use MULTI_EDGE wrapping in elkjs@0.12.0')
  }
  if (config.growGeneratedPortHeight && config.portSideMode !== 'relative') {
    throw new Error('ELK generated-node port sizing requires relative fixed-side ports')
  }
  if (config.growGeneratedPortHeight && nodes.some((node) => node.locked)) {
    throw new Error('ELK generated-node port sizing cannot change locked author geometry')
  }
  if (config.rigidLockedPlacement && !nativeRoutes) {
    throw new Error('Rigid locked placement requires native ELK edge geometry')
  }
  if (nativeRoutes && nodes.some((node) => node.locked) && !config.rigidLockedPlacement) {
    throw new Error('ELK native import cannot preserve locked Canvas node coordinates')
  }
  const compound = variant === 'compound' || variant === 'native-compound'
  const nodeIds = new Set(nodes.map((item) => item.id))
  const seedPositions = new Map(nodes.map((node) => [node.id, node]))
  const inputPorts = new Map<string, Array<{
    id: string; width: number; height: number; layoutOptions: { 'elk.port.side': string }
  }>>()
  const portEdges = config.portSideMode ? arrows.map((edge, index) => {
    const sourcePort = `elk-source-${index}`
    const targetPort = `elk-target-${index}`
    const source = seedPositions.get(edge.from), target = seedPositions.get(edge.to)
    if (!source || !target) throw new Error(`Invalid relation endpoint: ${edge.id}`)
    const sourceOnLeft = source.x + source.width / 2 < target.x + target.width / 2
    inputPorts.set(edge.from, [...(inputPorts.get(edge.from) ?? []), {
      id: sourcePort, width: 0, height: 0,
      layoutOptions: { 'elk.port.side': sourceOnLeft ? 'EAST' : 'WEST' },
    }])
    inputPorts.set(edge.to, [...(inputPorts.get(edge.to) ?? []), {
      id: targetPort, width: 0, height: 0,
      layoutOptions: { 'elk.port.side': sourceOnLeft ? 'WEST' : 'EAST' },
    }])
    return { sourcePort, targetPort }
  }) : []
  const children = nodes.map((node) => ({ id: node.id, width: node.width,
    height: config.growGeneratedPortHeight
      ? Math.max(node.height, (1 + Math.max(
        inputPorts.get(node.id)?.filter((port) => port.layoutOptions['elk.port.side'] === 'EAST').length ?? 0,
        inputPorts.get(node.id)?.filter((port) => port.layoutOptions['elk.port.side'] === 'WEST').length ?? 0,
      )) * CANVAS_PORT_MIN_SEPARATION_PX)
      : node.height,
    ...(config.portSideMode ? {
      ports: inputPorts.get(node.id) ?? [],
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE', 'elk.spacing.portPort': '14' },
    } : {}),
  }))
  const edges = arrows.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge, index) => ({ id: edge.id,
      sources: [!config.portSideMode ? edge.from : portEdges[index].sourcePort],
      targets: [!config.portSideMode ? edge.to : portEdges[index].targetPort],
    }))
  if (edges.length !== arrows.length) throw new Error('Invalid relation endpoint')

  const groups = new Map<string, typeof children>()
  const others: typeof children = []
  if (compound) {
    const inputNodes = new Map(nodes.map((node) => [node.id, node]))
    for (const child of children) {
      const groupId = inputNodes.get(child.id)?.groupId
      if (!groupId) others.push(child)
      else groups.set(groupId, [...(groups.get(groupId) ?? []), child])
    }
  }
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': config.direction ?? 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(config.nodeSpacing ?? 64),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(config.layerSpacing ?? 90),
      ...(config.wrapping ? { 'elk.layered.wrapping.strategy': config.wrapping } : {}),
      ...(config.aspectRatio ? { 'elk.aspectRatio': String(config.aspectRatio) } : {}),
      'elk.padding': '[top=35,left=35,bottom=35,right=35]',
      ...(compound ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    },
    children: !compound
      ? children
      : [
        ...others,
        ...[...groups.entries()].map(([id, entries]) => ({
          id,
          children: entries,
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': config.direction ?? 'DOWN',
            'elk.padding': '[top=40,left=25,bottom=25,right=25]',
            'elk.spacing.nodeNode': '40',
          },
        })),
      ],
    edges,
  }
  // We only exercise ELK in an explicitly invoked dev benchmark. No runtime
  // engine switch, bundled worker, persisted schema change or production migration.
  const layout = await engine.layout(graph)
  const absolute = collectPositions(layout.children, new Map([['root', { x: 0, y: 0 }]]))
  const margin = 30
  const width = Math.ceil((layout.width ?? 1200) + 2 * margin)
  const height = Math.ceil((layout.height ?? 800) + 2 * margin)
  const sizedNodes = new Map(children.map((node) => [node.id, node.height]))
  const relocated = new Map(nodes.map((node) => {
    const position = absolute.get(node.id)
    return [node.id, {
      ...node,
      ...(config.growGeneratedPortHeight ? { height: sizedNodes.get(node.id)! } : {}),
      x: position ? Math.round(position.x + margin) : node.x,
      y: position ? Math.round(position.y + margin) : node.y,
    }] as const
  }))
  const elkEdges = nativeRoutes ? collectNativeEdges(layout, absolute) : undefined
  const repositioned: CanvasScene = {
    ...scene,
    width,
    height,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') {
        const clean: CanvasArrow = { ...item, routing: 'orthogonal', points: undefined,
          fromAnchor: undefined, toAnchor: undefined, bundleKey: undefined, start: undefined, end: undefined }
        if (!nativeRoutes) return clean
        const record = elkEdges!.get(item.id)
        const edge = record?.edge
        const sections = edge?.sections
        const from = relocated.get(item.from), to = relocated.get(item.to)
        if (!from || !to || !record || !sections?.length || sections.length !== 1) {
          throw new Error(`Missing or unsupported ELK native edge sections for ${item.id}`)
        }
        const section = sections[0]
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
          .map((point) => ({ x: Math.round(point.x + record.offset.x + margin), y: Math.round(point.y + record.offset.y + margin) }))
        if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
          throw new Error(`Invalid ELK edge points for ${item.id}`)
        }
        return {
          ...clean,
          ...canvasNativeOrthogonalRoute(from, to, points),
          labelPosition: undefined,
        }
      }
      // In opt-in rigid-lock mode all nodes use the same tentative ELK
      // geometry; the final whole-scene translation restores every pin.
      // Preserving a locked node here would misalign it with native edges.
      return absolute.has(item.id) && (!item.locked || config.rigidLockedPlacement)
        ? relocated.get(item.id) ?? item
        : item
    }),
  }
  // Reuse the project's canonical editable routing model. This isolates the
  // ordering/positioning contribution of ELK without inventing new arrow semantics.
  const routed = nativeRoutes ? repositioned : routeArchitectureEdges(repositioned)
  if (config.rigidLockedPlacement) {
    const placed = placeElkWithinOriginalCanvas(scene, routed)
    if (!placed) throw new Error('ELK native result cannot preserve original Canvas size and all locked nodes')
    return placed
  }
  return config.compactBounds ? compactElkSceneBounds(routed) : routed
}
