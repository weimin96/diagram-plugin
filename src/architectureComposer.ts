import { beautifyArchitectureScene, inferArchitectureComposition, routeArchitectureArrowIds, routeArchitectureEdges, type ArchitectureComposition, type ArchitecturePartition, type ArchitectureTheme } from './architectureDesign.js'
import { assessCanvasVisualQuality, type CanvasVisualQualityAssessment } from './canvasQuality.js'
import type { DiagramVisualStyle } from './diagramVisualStyles.js'
import { canvasArrowBoxRoute, canvasSharedSourceStem, type CanvasArchitectureDensity, type CanvasArchitectureScenario, type CanvasIcon, type CanvasNode, type CanvasScene, type CanvasStencil } from './canvas.js'
import { assessArchitecturePresentation, recommendArchitectureTitleScale } from './architecturePresentationQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import { planArchitectureVisual } from './architectureVisualPlan.js'

/** Intent is the authoritative input; pixel coordinates are exclusively assigned by the layout engine. */
export interface ArchitectureIntentGraph {
  title: string
  theme?: ArchitectureTheme
  density?: CanvasArchitectureDensity
  style?: DiagramVisualStyle
  /** A stated user scenario, never inferred from pixel geometry. */
  visualScenario?: CanvasArchitectureScenario
  /** Ordered, verified directed relationships; unknown path means automatic inference. */
  primaryPath?: string[]
  nodes: Array<{
    id: string
    text: string
    icon?: CanvasIcon
    stencil?: CanvasStencil
    subtitle?: string
    description?: string
    sourcePaths?: string[]
    /** Verified functional region, not a guessed position or arbitrary visual group. */
    partition?: ArchitecturePartition
  }>
  relations: Array<{
    from: string
    to: string
    label?: string
    asynchronous?: boolean
  }>
}

export interface ArchitectureLayoutAssessment {
  /** Geometry and readability heuristic, NOT a subjective aesthetic or semantic correctness score. */
  structuralScore: number
  layout: ArchitectureComposition
  density: Exclude<CanvasArchitectureDensity, 'auto'>
  issueCount: number
  aspectRatio: number
  longDetours: number
  detourPenalty: number
}

/** Layout selection penalty from measurable presentation defects, not aesthetic judgment.
 * Only scored after the candidate has completed the existing routing pipeline. */
export function architecturePresentationSelectionPenalty(
  presentation: ReturnType<typeof assessArchitecturePresentation>,
  route: ReturnType<typeof assessArchitectureRouteDiagnostics>,
): number {
  const fontPenalty = Math.min(12, Math.max(0, 11 - presentation.estimatedTitlePxAtFit) * 5)
  const boundaryPenalty = Math.min(6, route.frameOverlapArea / 14000)
  const intrusionPenalty = Math.min(7, route.unrelatedFrameIntrusionLength / 150)
  return Math.round((fontPenalty + boundaryPenalty + intrusionPenalty) * 10) / 10
}

function architectureDetourMetrics(scene: CanvasScene) {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((node) => [node.id, node]))
  let longDetours = 0
  let detourPenalty = 0
  for (const arrow of scene.elements) {
    if (arrow.type !== 'arrow') continue
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to) continue
    const points = canvasArrowBoxRoute(from, to, arrow)
    const length = points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0)
    const direct = Math.abs((from.x + from.width / 2) - (to.x + to.width / 2))
      + Math.abs((from.y + from.height / 2) - (to.y + to.height / 2))
    const ratio = length / Math.max(80, direct)
    if (ratio <= 1.8) continue
    longDetours += 1
    detourPenalty += Math.min(12, (ratio - 1.8) * 4)
  }
  return { longDetours, detourPenalty: Math.round(detourPenalty * 10) / 10 }
}

function evaluateArchitectureLayout(scene: CanvasScene, quality: CanvasVisualQualityAssessment, composition: ArchitectureComposition, density: Exclude<CanvasArchitectureDensity, 'auto'>): ArchitectureLayoutAssessment {
  const m = quality.metrics
  const ratio = scene.width / Math.max(1, scene.height)
  const geometryPenalty = m.nodeOverlaps * 18 + m.edgeNodeIntersections * 12
    + m.edgeCrossings * 5 + m.edgeOverlaps * 2.5
    + m.labelNodeIntersections * 9 + m.labelOverlaps * 6 + m.labelOverflows * 6
  const hierarchyPenalty = quality.issues.filter((issue) =>
    ['flat-architecture', 'isolated-architecture-hubs', 'repetitive-card-grid', 'decorative-architecture-lanes'].includes(issue.code)).length * 8
  const readabilityPenalty = m.longLabels * 2.5
    + (ratio < 0.65 ? (0.65 - ratio) * 15 : ratio > 2.3 ? (ratio - 2.3) * 11 : 0)
    + (density === 'dense' && m.nodes < 35 ? 7 : density === 'compact' && m.nodes < 10 ? 3 : 0)
  // Reserve the top 10 points for real rendered-image visual review.
  const detours = architectureDetourMetrics(scene)
  const structuralScore = Math.max(0, Math.min(90, Math.round((90 - geometryPenalty - hierarchyPenalty - readabilityPenalty - detours.detourPenalty) * 10) / 10))
  return { structuralScore, layout: composition, density, issueCount: quality.issues.length, aspectRatio: Math.round(ratio * 100) / 100, ...detours }
}

/**
 * Shift one interior orthogonal corridor; keep endpoint anchors and all nodes
 * fixed. This resolves collinear overlaps that the standard A* rerouter can
 * repeat, without introducing a second layout engine.
 */
function nudgeArchitectureCorridors(scene: CanvasScene, arrowId: string): CanvasScene[] {
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
function bypassArchitectureBlockingNode(scene: CanvasScene, arrowId: string, blockerId: string): CanvasScene[] {
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
function annotateSourceFanoutTrunks(scene: CanvasScene): CanvasScene {
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

/** Only reroute implicated edges, and accept strictly improving results; never move authored nodes. */
function refineArchitectureRoutes(
  initialScene: CanvasScene,
  composition: ArchitectureComposition,
  density: Exclude<CanvasArchitectureDensity, 'auto'>,
) {
  let scene = initialScene
  let quality = assessCanvasVisualQuality(scene)
  let evaluation = evaluateArchitectureLayout(scene, quality, composition, density)
  let reroutedEdges = 0
  const issueCodes = new Set(['edge-crossing', 'edge-overlap', 'edge-through-node', 'excessive-edge-detour'])
  // Bounded local search: not an extra AI pass and no repeated full-scene relayout.
  for (let round = 0; round < 4; round += 1) {
    const blockers = new Map<string, string[]>()
    for (const issue of quality.issues) {
      if (issue.code !== 'edge-through-node') continue
      const [edgeId, blockerId] = issue.elementIds
      blockers.set(edgeId, [...(blockers.get(edgeId) ?? []), blockerId])
    }
    const affectedIds = [...new Set(quality.issues
      .filter((issue) => issueCodes.has(issue.code))
      .flatMap((issue) => issue.elementIds))].filter((id) => scene.elements.some((item) => item.type === 'arrow' && item.id === id)).slice(0, 10)
    if (!affectedIds.length) break
    let best: { scene: CanvasScene; quality: CanvasVisualQualityAssessment; evaluation: ArchitectureLayoutAssessment } | undefined
    for (const id of affectedIds) {
      const bypass = (blockers.get(id) ?? []).flatMap((blockerId) => bypassArchitectureBlockingNode(scene, id, blockerId))
      for (const candidate of [...bypass, routeArchitectureArrowIds(scene, [id]), ...nudgeArchitectureCorridors(scene, id)]) {
        const nextQuality = assessCanvasVisualQuality(candidate)
        if (nextQuality.metrics.edgeNodeIntersections > quality.metrics.edgeNodeIntersections
          || nextQuality.metrics.nodeOverlaps > quality.metrics.nodeOverlaps) continue
        const nextEvaluation = evaluateArchitectureLayout(candidate, nextQuality, composition, density)
        const previous = best?.evaluation ?? evaluation
        if (nextEvaluation.structuralScore > previous.structuralScore
          || (nextEvaluation.structuralScore === previous.structuralScore && nextQuality.issues.length < (best?.quality.issues.length ?? quality.issues.length))) {
          best = { scene: candidate, quality: nextQuality, evaluation: nextEvaluation }
        }
      }
    }
    if (!best) break
    scene = best.scene
    quality = best.quality
    evaluation = best.evaluation
    reroutedEdges += 1
  }
  return { scene, quality, evaluation, reroutedEdges }
}

/** Swap nearby peers within a single auto-generated partition, never the user's authored geometry. */
function refineArchitectureNodeOrder(
  initial: ReturnType<typeof refineArchitectureRoutes>,
  composition: ArchitectureComposition,
  density: Exclude<CanvasArchitectureDensity, 'auto'>,
  protectedNodes: ReadonlySet<string> = new Set(),
) {
  let best = initial
  let reorderedPairs = 0
  // Quadratic local search is only useful for modest topology sizes.
  if (initial.scene.elements.filter((item) => item.type === 'node').length > 30) {
    return { ...initial, reorderedPairs }
  }
  // Limit graph search to three passes of at most sixteen swaps. A swap changes
  // only the positions of two unlocked nodes within the same semantic group.
  for (let pass = 0; pass < 3; pass += 1) {
    const conflicts = best.quality.issues.filter(({ code }) =>
      code === 'edge-crossing' || code === 'edge-overlap' || code === 'excessive-edge-detour')
    if (!conflicts.length) break
    const scene = best.scene
    const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const edges = new Map(scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.id, item]))
    const focused = [...new Set(conflicts.flatMap(({ elementIds }) => elementIds)
      .flatMap((id) => {
        const edge = edges.get(id)
        return edge ? [edge.from, edge.to] : []
      }))].slice(0, 9)
    const candidates: Array<[string, string]> = []
    const seen = new Set<string>()
    for (const id of focused) {
      const node = byId.get(id)
      if (!node?.groupId?.startsWith('arch-') || node.locked || protectedNodes.has(node.id)) continue
      const peers = nodes.filter((peer) =>
        peer.id !== node.id && peer.groupId === node.groupId && !peer.locked && !protectedNodes.has(peer.id)
        && peer.width === node.width && peer.height === node.height)
        .sort((a, b) => Math.abs(a.x - node.x) + Math.abs(a.y - node.y)
          - Math.abs(b.x - node.x) - Math.abs(b.y - node.y)
          || a.id.localeCompare(b.id))
        .slice(0, 4)
      for (const peer of peers) {
        const key = [node.id, peer.id].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push([node.id, peer.id])
        if (candidates.length >= 16) break
      }
      if (candidates.length >= 16) break
    }
    let improved: typeof best | undefined
    for (const [firstId, secondId] of candidates) {
      const first = byId.get(firstId)!, second = byId.get(secondId)!
      const swapped: CanvasScene = {
        ...scene,
        elements: scene.elements.map((element) => {
          if (element.id === firstId) return { ...element, x: second.x, y: second.y }
          if (element.id === secondId) return { ...element, x: first.x, y: first.y }
          return element
        }),
      }
      const routed = routeArchitectureEdges(swapped)
      const quality = assessCanvasVisualQuality(routed)
      if (quality.metrics.nodeOverlaps || quality.metrics.edgeNodeIntersections
        || quality.metrics.labelNodeIntersections) continue
      const evaluation = evaluateArchitectureLayout(routed, quality, composition, density)
      if (evaluation.structuralScore <= (improved?.evaluation.structuralScore ?? best.evaluation.structuralScore)) continue
      improved = { scene: routed, quality, evaluation, reroutedEdges: best.reroutedEdges }
    }
    if (!improved) break
    best = improved
    reorderedPairs += 1
  }
  return { ...best, reorderedPairs }
}

function composeArchitectureGraphCandidate(
  intent: ArchitectureIntentGraph, peerOrder: 'semantic' | 'dependency' | 'main-path',
  relationIds?: readonly string[],
  alignedSpacing = false,
  spatialOrder = false,
) {
  const ids = new Set<string>()
  for (const node of intent.nodes) {
    if (ids.has(node.id)) throw new Error(`架构节点 ID 重复：${node.id}`)
    ids.add(node.id)
  }
  for (const relation of intent.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      throw new Error(`架构关系引用不存在的节点：${relation.from} → ${relation.to}`)
    }
  }
  if (intent.primaryPath !== undefined) {
    const path = intent.primaryPath
    if (path.length < 2 || new Set(path).size !== path.length || path.some((id) => !ids.has(id))) {
      throw new Error('架构主链必须由至少两个不重复的已存在节点组成')
    }
    for (let index = 1; index < path.length; index += 1) {
      if (!intent.relations.some((edge) => edge.from === path[index - 1] && edge.to === path[index])) {
        throw new Error(`架构主链缺少实际有向关系：${path[index - 1]} → ${path[index]}`)
      }
    }
  }
  const partitionOverrides = new Map(intent.nodes.flatMap((node) => node.partition ? [[node.id, node.partition] as const] : []))
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: intent.title,
    width: 1600, height: 1000, workbench: 'architecture',
    style: intent.style ?? ({
      enterprise: 'nord', technical: 'blueprint', presentation: 'graphite',
      cloud: 'nord', editorial: 'graphite', sketch: 'warm',
    } satisfies Record<ArchitectureTheme, DiagramVisualStyle>)[intent.theme ?? 'enterprise'],
    elements: [
      ...intent.nodes.map(({ partition: _partition, ...node }) => ({
        ...node, type: 'node' as const, x: 0, y: 0, width: 204, height: 84,
      })),
      ...intent.relations.map((relation, index) => ({
        // The tool schema reserves a letter as the first character of a node ID.
        // A distinct prefix prevents a generated edge from colliding with a node.
        id: relationIds?.[index] ?? `__relation-${index + 1}`,
        type: 'arrow' as const,
        from: relation.from,
        to: relation.to,
        ...(relation.label ? { label: relation.label } : {}),
        ...(relation.asynchronous ? { lineStyle: 'dashed' as const } : {}),
      })),
    ],
    architecture: {
      theme: intent.theme ?? 'enterprise', view: 'detail', density: intent.density ?? 'auto',
      ...(intent.visualScenario ? { scenario: intent.visualScenario } : {}),
    },
  }
  const inferred = inferArchitectureComposition(scene, partitionOverrides)
  const autoDensity = intent.nodes.length >= 46 ? 'dense'
    : intent.nodes.length >= 22 || (intent.nodes.length >= 10 && ['event-driven', 'data-platform', 'agent-runtime', 'cloud-native'].includes(inferred))
      ? 'compact' : 'comfortable'
  const densityCandidates: Array<Exclude<CanvasArchitectureDensity, 'auto'>> = intent.density && intent.density !== 'auto'
    ? [intent.density]
    : [...new Set([autoDensity, autoDensity === 'comfortable' ? 'compact' : 'comfortable'])] as Array<Exclude<CanvasArchitectureDensity, 'auto'>>
  // Keep the semantic intent, but consider one additional topology when the
  // initial event/data/cloud silhouette produces excessive routing detours.
  // The inferred composition retains a six-point tie-breaking preference.
  const compositionCandidates: ArchitectureComposition[] =
    ['event-driven', 'data-platform', 'cloud-native'].includes(inferred)
      ? [inferred, 'layered', 'hub-spoke']
      : inferred === 'hub-spoke' || inferred === 'agent-runtime'
        ? [inferred, 'layered']
        : [inferred]
  const candidates = compositionCandidates.flatMap((composition) => densityCandidates.map((density) => {
    const result = beautifyArchitectureScene(scene, {
      theme: intent.theme, density, composition, peerOrder,
      partitionOverrides, primaryPath: intent.primaryPath, alignedSpacing, spatialOrder,
    })
    const quality = assessCanvasVisualQuality(result.scene)
    const evaluation = evaluateArchitectureLayout(result.scene, quality, composition, density)
    // Respect the inferred topology when structural metrics do not justify a different layout.
    const selectionScore = evaluation.structuralScore - (composition === inferred ? 0 : 6)
      - (density === autoDensity ? 0 : 1)
    return { ...result, quality, evaluation, selectionScore }
  }))
  candidates.sort((a, b) => b.selectionScore - a.selectionScore
    || a.quality.issues.length - b.quality.issues.length
    || a.summary.composition.localeCompare(b.summary.composition))
  // Comparing only pre-refinement layouts can select a worse final diagram.
  // Refine the best candidate for each distinct topology (max 3) and select
  // according to the actual post-routing quality, not the preliminary score.
  const shortlisted = candidates
    .filter((candidate, index) => candidates.findIndex((other) =>
      other.summary.composition === candidate.summary.composition) === index)
    .slice(0, 3)
  const refined = shortlisted.map((candidate) => {
    const result = refineArchitectureRoutes(candidate.scene, candidate.summary.composition, candidate.summary.resolvedDensity)
    const visualPenalty = architecturePresentationSelectionPenalty(
      assessArchitecturePresentation(result.scene),
      assessArchitectureRouteDiagnostics(result.scene),
    )
    const structuralSelectionScore = result.evaluation.structuralScore
      - (candidate.summary.composition === inferred ? 0 : 6)
      - (candidate.summary.resolvedDensity === autoDensity ? 0 : 1)
    return {
      ...candidate,
      ...result,
      visualPenalty,
      structuralSelectionScore,
      selectionScore: structuralSelectionScore - visualPenalty,
    }
  })
  // Readability may decide between near-equivalent layouts, but cannot buy a
  // substantially worse graph by trading away crossings or routed quality.
  const bestStructuralSelectionScore = Math.max(...refined.map((item) => item.structuralSelectionScore))
  const eligible = refined.filter((item) => item.structuralSelectionScore >= bestStructuralSelectionScore - 1)
  eligible.sort((a, b) => b.selectionScore - a.selectionScore
    || a.quality.issues.length - b.quality.issues.length
    || a.summary.composition.localeCompare(b.summary.composition))
  const { selectionScore: _selectionScore, structuralSelectionScore: _structuralSelectionScore, visualPenalty: _visualPenalty, ...selected } = eligible[0]
  const ordered = refineArchitectureNodeOrder(selected, selected.summary.composition, selected.summary.resolvedDensity,
    peerOrder === 'main-path' ? new Set(intent.primaryPath) : undefined)
  // Reordering can reintroduce node intersections after the first routing
  // pass. Repair only those hard geometry failures, not the whole graph again.
  const postOrderRepair = ordered.quality.metrics.edgeNodeIntersections > 0
    ? refineArchitectureRoutes(ordered.scene, selected.summary.composition, selected.summary.resolvedDensity)
    : undefined
  const repaired = postOrderRepair
    ? { ...ordered, ...postOrderRepair, reroutedEdges: ordered.reroutedEdges + postOrderRepair.reroutedEdges }
    : ordered
  const titleScale = recommendArchitectureTitleScale(repaired.scene)
  const finalScene: CanvasScene = annotateSourceFanoutTrunks(titleScale > 1
    ? { ...repaired.scene, architecture: { ...repaired.scene.architecture!, titleScale } }
    : repaired.scene)
  const finalQuality = assessCanvasVisualQuality(finalScene)
  const finalEvaluation = evaluateArchitectureLayout(finalScene, finalQuality, selected.summary.composition, selected.summary.resolvedDensity)
  const presentation = assessArchitecturePresentation(finalScene)
  const routeDiagnostics = assessArchitectureRouteDiagnostics(finalScene)
  const visualPlan = planArchitectureVisual(finalScene, inferred, finalQuality, presentation, routeDiagnostics)
  // Prefer the existing non-destructive overview projection for genuinely
  // crowded diagrams. Detail stays fully available, no edges are deleted.
  const publishedScene = visualPlan.recommendedView === 'overview'
    ? { ...finalScene, architecture: { ...finalScene.architecture!, view: 'overview' as const } }
    : finalScene
  const refinedByLayout = new Map(refined.map((candidate) =>
    [`${candidate.summary.composition}:${candidate.summary.resolvedDensity}`, candidate.evaluation]))
  return {
    ...selected, ...repaired, scene: publishedScene, quality: finalQuality, evaluation: finalEvaluation,
    semanticComposition: inferred,
    presentation, routeDiagnostics, visualPlan,
    candidates: candidates.map(({ evaluation, summary }) =>
      summary.composition === selected.summary.composition && summary.resolvedDensity === selected.summary.resolvedDensity
        ? finalEvaluation
        : refinedByLayout.get(`${summary.composition}:${summary.resolvedDensity}`) ?? evaluation),
  }
}

const composeArchitectureGraphCore = (intent: ArchitectureIntentGraph, relationIds?: readonly string[]) =>
  composeArchitectureGraphCandidate(intent, 'semantic', relationIds)

/** Count reversals of verified main-path nodes within the same visual region.
 * The region layout is top-to-bottom then left-to-right; across-region order
 * is decided by the topology and must not be silently reinterpreted here. */
function mainPathRegionInversions(scene: CanvasScene, mainPath: readonly string[]): number {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((node) => [node.id, node]))
  let inversions = 0
  for (let i = 0; i < mainPath.length; i += 1) {
    const first = nodes.get(mainPath[i])
    if (!first) continue
    for (let j = i + 1; j < mainPath.length; j += 1) {
      const second = nodes.get(mainPath[j])
      if (!second || !first.groupId || first.groupId !== second.groupId) continue
      if (first.y > second.y + 5 || (Math.abs(first.y - second.y) <= 5 && first.x > second.x)) inversions += 1
    }
  }
  return inversions
}

/**
 * AI clients do not guarantee node/relationship enumeration order. On small
 * graphs with unresolved visual defects, compare the existing composition with
 * two stable-order candidates. This is an end-to-end layout comparison, not a
 * cheap geometry reorder: every candidate runs the same full routing/refinement
 * and must preserve all original IDs and relationships.
 */
function composeArchitectureGraphOriginal(intent: ArchitectureIntentGraph) {
  const baseline = composeArchitectureGraphCore(intent)
  const n = intent.nodes.length
  const m = intent.relations.length
  const primaryPath = intent.primaryPath
  const pathInversions = primaryPath ? mainPathRegionInversions(baseline.scene, primaryPath) : 0
  // The historical grid has columns slightly narrower than the collision
  // clearance. A properly spaced candidate can avoid unnecessary row shifts,
  // but only adopt it when the full routed result is measurably safer or it
  // restores the confirmed path order without sacrificing graph quality.
  if (n <= 24 && m <= 35 && (pathInversions > 0
    || (baseline.semanticComposition === 'data-platform' && baseline.quality.metrics.edgeCrossings > 0))) {
    const aligned = composeArchitectureGraphCandidate(intent,
      pathInversions > 0 ? 'main-path' : 'semantic', undefined, true)
    const before = baseline.quality.metrics, after = aligned.quality.metrics
    const improvedPath = primaryPath && pathInversions > 0
      && mainPathRegionInversions(aligned.scene, primaryPath) < pathInversions
      && aligned.evaluation.structuralScore >= baseline.evaluation.structuralScore - 1
    const improvedStructure = aligned.evaluation.structuralScore >= baseline.evaluation.structuralScore + 2
    if ((improvedPath || improvedStructure)
      && after.nodeOverlaps <= before.nodeOverlaps
      && after.edgeNodeIntersections <= before.edgeNodeIntersections
      && after.labelNodeIntersections <= before.labelNodeIntersections
      && after.edgeCrossings <= before.edgeCrossings
      && after.edgeOverlaps <= before.edgeOverlaps
      && aligned.presentation.estimatedTitlePxAtFit >= baseline.presentation.estimatedTitlePxAtFit - 0.8
      && aligned.routeDiagnostics.frameOverlaps <= baseline.routeDiagnostics.frameOverlaps + 1) {
      return { ...aligned, inputOrderStrategy: 'original' as const,
        layoutOrderingStrategy: improvedPath ? 'main-path' as const : 'aligned-spacing' as const }
    }
  }
  if (primaryPath && primaryPath.length >= 3 && n <= 22 && m <= 30
    && mainPathRegionInversions(baseline.scene, primaryPath) > 0) {
    const candidate = composeArchitectureGraphCandidate(intent, 'main-path')
    const before = baseline.quality.metrics
    const after = candidate.quality.metrics
    if (mainPathRegionInversions(candidate.scene, primaryPath) < mainPathRegionInversions(baseline.scene, primaryPath)
      && after.nodeOverlaps <= before.nodeOverlaps
      && after.edgeNodeIntersections <= before.edgeNodeIntersections
      && after.labelNodeIntersections <= before.labelNodeIntersections
      && after.edgeCrossings <= before.edgeCrossings
      && after.edgeOverlaps <= before.edgeOverlaps + 1
      && candidate.evaluation.structuralScore >= baseline.evaluation.structuralScore - 3
      && candidate.presentation.estimatedTitlePxAtFit >= baseline.presentation.estimatedTitlePxAtFit - 0.5
      && candidate.routeDiagnostics.frameOverlaps <= baseline.routeDiagnostics.frameOverlaps + 1) {
      return { ...candidate, inputOrderStrategy: 'original' as const, layoutOrderingStrategy: 'main-path' as const }
    }
  }
  // A coordinated variant: cross-region dependencies influence peer placement
  // BEFORE the ordinary full routing/refinement sequence. Only consider this
  // expensive alternative for visibly defective, bounded-size graphs.
  if (n >= 12 && n <= 22 && m <= 30
    && baseline.quality.metrics.edgeCrossings >= 2
    && baseline.evaluation.structuralScore < 70) {
    const candidate = composeArchitectureGraphCandidate(intent, 'dependency')
    const before = baseline.quality.metrics
    const after = candidate.quality.metrics
    const sourceGeometry = baseline.routeDiagnostics
    const targetGeometry = candidate.routeDiagnostics
    if (after.nodeOverlaps <= before.nodeOverlaps
      && after.edgeNodeIntersections <= before.edgeNodeIntersections
      && after.labelNodeIntersections <= before.labelNodeIntersections
      && after.edgeCrossings <= before.edgeCrossings - 2
      && after.edgeOverlaps <= before.edgeOverlaps + 1
      && candidate.evaluation.structuralScore >= baseline.evaluation.structuralScore + 8
      && candidate.presentation.estimatedTitlePxAtFit >= 11
      && candidate.presentation.estimatedTitlePxAtFit >= baseline.presentation.estimatedTitlePxAtFit - 0.5
      && targetGeometry.crossPartitionRouteLength <= sourceGeometry.crossPartitionRouteLength * 0.9
      && targetGeometry.frameOverlaps <= sourceGeometry.frameOverlaps + 1
      && targetGeometry.frameOverlapArea <= sourceGeometry.frameOverlapArea * 2
      && targetGeometry.unrelatedFrameIntrusionLength <= sourceGeometry.unrelatedFrameIntrusionLength + 300) {
      return { ...candidate, inputOrderStrategy: 'original' as const, layoutOrderingStrategy: 'dependency' as const }
    }
  }
  // Routing is order-dependent for equal-priority independent edges. For a
  // bounded, visibly conflicted fan-out, compare one reverse-order route pass.
  // Restore the original node/edge ordering and IDs; this is not a graph edit.
  const sourceCounts = new Map<string, number>()
  for (const edge of intent.relations) sourceCounts.set(edge.from, (sourceCounts.get(edge.from) ?? 0) + 1)
  if (n >= 14 && n <= 24 && m <= 32
    && Math.max(0, ...sourceCounts.values()) >= 5
    && baseline.quality.metrics.edgeOverlaps >= 5
    && baseline.quality.metrics.edgeNodeIntersections === 0) {
    const reversed = composeArchitectureGraphCore({ ...intent, relations: intent.relations.slice().reverse() },
      intent.relations.map((_, index) => `__relation-${index + 1}`).reverse())
    const before = baseline.quality.metrics
    const after = reversed.quality.metrics
    if (after.nodeOverlaps <= before.nodeOverlaps
      && after.edgeNodeIntersections <= before.edgeNodeIntersections
      && after.labelNodeIntersections <= before.labelNodeIntersections
      && after.edgeCrossings <= before.edgeCrossings
      && after.edgeOverlaps <= before.edgeOverlaps - 2
      && reversed.evaluation.structuralScore >= baseline.evaluation.structuralScore + 3
      && reversed.presentation.estimatedTitlePxAtFit >= baseline.presentation.estimatedTitlePxAtFit - 0.5
      && reversed.routeDiagnostics.frameOverlaps <= baseline.routeDiagnostics.frameOverlaps + 1
      && reversed.routeDiagnostics.unrelatedFrameIntrusionLength <= baseline.routeDiagnostics.unrelatedFrameIntrusionLength + 100) {
      const orderedIds = new Map([
        ...intent.nodes.map((node, index) => [node.id, index] as const),
        ...intent.relations.map((_, index) => [`__relation-${index + 1}`, n + index] as const),
      ])
      return {
        ...reversed,
        scene: { ...reversed.scene, elements: reversed.scene.elements.slice().sort((a, b) =>
          (orderedIds.get(a.id) ?? Infinity) - (orderedIds.get(b.id) ?? Infinity)) },
        inputOrderStrategy: 'relation-reverse' as const,
        layoutOrderingStrategy: 'semantic' as const,
      }
    }
  }
  // Do not double high-fanout search latency or spend more CPU on mild local
  // imperfections for which an order alternative rarely helps.
  if (n < 7 || n > 16 || m > 24
    || (baseline.evaluation.structuralScore >= 80
      && baseline.quality.metrics.edgeOverlaps < 2
      && baseline.quality.metrics.edgeCrossings < 2)) {
    return { ...baseline, inputOrderStrategy: 'original' as const, layoutOrderingStrategy: 'semantic' as const }
  }

  const idOrder = new Map([
    ...intent.nodes.map((node, index) => [node.id, index] as const),
    ...intent.relations.map((_, index) => [`__relation-${index + 1}`, intent.nodes.length + index] as const),
  ])
  let best = baseline
  let inputOrderStrategy: 'original' | 'node-id' | 'relation-key' = 'original'
  const nodesSorted = intent.nodes.slice().sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const indexedRelations = intent.relations.map((relation, index) => ({
    relation, id: `__relation-${index + 1}`, index,
  }))
  const relationsSorted = indexedRelations.slice().sort((a, b) =>
    a.relation.from.localeCompare(b.relation.from, 'en')
    || a.relation.to.localeCompare(b.relation.to, 'en')
    || (a.relation.label ?? '').localeCompare(b.relation.label ?? '', 'en')
    || Number(Boolean(a.relation.asynchronous)) - Number(Boolean(b.relation.asynchronous))
    || a.index - b.index)

  const nodeOrderChanged = nodesSorted.some((node, index) => node !== intent.nodes[index])
  const relationOrderChanged = relationsSorted.some((row, index) => row.index !== index)
  const variants: Array<{ name: 'node-id' | 'relation-key'; intent: ArchitectureIntentGraph; relationIds?: string[] }> = []
  if (nodeOrderChanged) variants.push({ name: 'node-id', intent: { ...intent, nodes: nodesSorted } })
  if (relationOrderChanged) variants.push({
    name: 'relation-key',
    intent: { ...intent, relations: relationsSorted.map((item) => item.relation) },
    relationIds: relationsSorted.map((item) => item.id),
  })
  for (const variant of variants) {
    const proposed = composeArchitectureGraphCore(variant.intent, variant.relationIds)
    const before = best.quality.metrics
    const after = proposed.quality.metrics
    if (after.nodeOverlaps > before.nodeOverlaps
      || after.edgeNodeIntersections > before.edgeNodeIntersections
      || after.labelNodeIntersections > before.labelNodeIntersections
      || after.edgeCrossings > before.edgeCrossings
      || proposed.presentation.estimatedTitlePxAtFit < 11
      || proposed.presentation.estimatedTitlePxAtFit < best.presentation.estimatedTitlePxAtFit - 1.2) continue
    const improvement = proposed.evaluation.structuralScore - best.evaluation.structuralScore
    const overlapDelta = after.edgeOverlaps - before.edgeOverlaps
    // An additional shared corridor is acceptable only for a substantial
    // improvement in global structure, and never beyond one residual overlap.
    const acceptable = overlapDelta <= 0
      ? improvement >= 0.8 || (improvement >= -0.2 && overlapDelta < 0)
      : improvement >= 8 && after.edgeOverlaps <= 1 && overlapDelta === 1
    if (!acceptable) continue
    // Return the caller's original element order, not a new on-disk protocol.
    best = {
      ...proposed,
      scene: { ...proposed.scene, elements: proposed.scene.elements.slice()
        .sort((a, b) => (idOrder.get(a.id) ?? Infinity) - (idOrder.get(b.id) ?? Infinity)) },
    }
    inputOrderStrategy = variant.name
  }
  return { ...best, inputOrderStrategy, layoutOrderingStrategy: 'semantic' as const }
}

/** Compare an alternate collision-resolution order against the *fully*
 * optimized result, never an intermediate geometry that later routing beats. */
export function composeArchitectureGraph(intent: ArchitectureIntentGraph) {
  const result = composeArchitectureGraphOriginal(intent)
  const n = intent.nodes.length
  // Dense graphs need global routing/port planning; collision ordering alone
  // helps only sparse, interleaved regions and would waste extra CPU there.
  if (n < 17 || n > 22 || intent.relations.length > n * 0.8
    || result.routeDiagnostics.frameOverlapArea < 80_000) return result
  const candidate = composeArchitectureGraphCandidate(intent, 'semantic', undefined, false, true)
  const before = result.quality.metrics, after = candidate.quality.metrics
  const eligible = candidate.routeDiagnostics.frameOverlapArea <= result.routeDiagnostics.frameOverlapArea * 0.65
    && after.nodeOverlaps <= before.nodeOverlaps
    && after.edgeNodeIntersections <= before.edgeNodeIntersections
    && after.labelNodeIntersections <= before.labelNodeIntersections
    && after.labelOverflows <= before.labelOverflows
    && after.labelOverlaps <= before.labelOverlaps
    && after.edgeCrossings <= before.edgeCrossings
    && after.edgeOverlaps <= before.edgeOverlaps
    && candidate.evaluation.structuralScore >= result.evaluation.structuralScore
    && candidate.presentation.estimatedTitlePxAtFit >= result.presentation.estimatedTitlePxAtFit - 0.5
  if (!eligible) return result
  const order = new Map([
    ...intent.nodes.map((node, index) => [node.id, index] as const),
    ...intent.relations.map((_, index) => [`__relation-${index + 1}`, n + index] as const),
  ])
  return {
    ...candidate,
    scene: { ...candidate.scene, elements: candidate.scene.elements.slice().sort((a, b) =>
      (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)) },
    inputOrderStrategy: 'original' as const, layoutOrderingStrategy: 'spatial-order' as const,
  }
}
