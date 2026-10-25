import { nudgeArchitectureCorridors, bypassArchitectureBlockingNode, nudgeSharedSourceBranch } from './architectureRouteRepair.js'
import { annotateSourceFanoutTrunks, routeArchitectureArrowIds, routeArchitectureEdges, routeArchitectureEdgesIncremental } from './architectureRouting.js'
import { beautifyArchitectureScene, inferArchitectureComposition, type ArchitectureComposition, type ArchitecturePartition, type ArchitectureTheme } from './architectureDesign.js'
import { assessCanvasVisualQuality, type CanvasVisualQualityAssessment } from './canvasQuality.js'
import type { DiagramVisualStyle } from './diagramVisualStyles.js'
import { canvasArrowBoxRoute, canvasSharedSourceStem, type CanvasArchitectureDensity, type CanvasArchitectureScenario, type CanvasArrow, type CanvasIcon, type CanvasNode, type CanvasScene, type CanvasStencil } from './canvas.js'
import { assessArchitecturePresentation, recommendArchitectureTitleScale } from './architecturePresentationQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import { planArchitectureVisual, rankArchitectureOverlapHotspots } from './architectureVisualPlan.js'

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
      // Every local repair candidate edits just this relation. In dense
      // layouts several corridor offsets resolve to the same serialized
      // arrow (or to the unchanged one); re-scoring those complete scenes
      // cannot produce a different winner.
      const knownArrows = new Set<string>([JSON.stringify(scene.elements.find((item) => item.id === id))])
      const bypass = (blockers.get(id) ?? []).flatMap((blockerId) => bypassArchitectureBlockingNode(scene, id, blockerId))
      for (const candidate of [...bypass, routeArchitectureArrowIds(scene, [id]), ...nudgeArchitectureCorridors(scene, id)]) {
        const candidateArrow = candidate.elements.find((item) => item.id === id)
        const signature = JSON.stringify(candidateArrow)
        if (knownArrows.has(signature)) continue
        knownArrows.add(signature)
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
  partitionFirst = false,
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
      partitionFirst,
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
function composeArchitectureGraphExisting(intent: ArchitectureIntentGraph) {
  const result = compactConflictedGroupMembers(
    packSparseArchitectureRegions(improveCongestedPorts(composeArchitectureGraphOriginal(intent)), intent.primaryPath),
    intent.primaryPath,
  )
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

/** Full candidate for seriously overlapping sibling regions. Allocation of
 * partition envelopes precedes edge routing, and the normal end-to-end gates
 * decide whether it is safe to replace the historical layout. */
export function composeArchitectureGraph(intent: ArchitectureIntentGraph) {
  const original = composeArchitectureGraphExisting(intent)
  if (intent.primaryPath?.length || intent.nodes.length > 26
    || original.routeDiagnostics.frameOverlapArea < original.scene.width * original.scene.height * 0.1
    // Severe fan-out needs a real multi-edge solver, not repeated full-scene
    // trials of the same single-edge repair.
    || original.quality.metrics.edgeOverlaps > 4) return original
  const layout = composeArchitectureGraphCandidate(intent, 'semantic', undefined, false, false, true)
  const candidate = improveCongestedPorts({
    ...layout, inputOrderStrategy: 'original' as const, layoutOrderingStrategy: 'semantic' as const,
  }, true)
  const before = original.quality.metrics, after = candidate.quality.metrics
  // Structural score deliberately does not count sibling frame intersections.
  // Use the existing presentation penalty rather than weakening geometry
  // thresholds or hiding overlapping regions in an overview.
  const originalReviewScore = original.evaluation.structuralScore
    - architecturePresentationSelectionPenalty(original.presentation, original.routeDiagnostics)
  const candidateReviewScore = candidate.evaluation.structuralScore
    - architecturePresentationSelectionPenalty(candidate.presentation, candidate.routeDiagnostics)
  // Structural score has no sibling-frame term. For an already blocked scene,
  // an otherwise clean layout can legitimately exchange at most two minor
  // relationship overlaps for removing a massive frame collision. Never make
  // that trade when the original scene was already reviewable; and never trade
  // a crossing, node intrusion, label issue or reduced fit text.
  const canAcceptBoundedOverlapTrade = !original.visualPlan.review.readyForVisualReview
    && candidate.visualPlan.review.readyForVisualReview
    && after.edgeOverlaps <= before.edgeOverlaps + 2
    && after.edgeOverlaps <= 2
    && candidate.evaluation.structuralScore >= original.evaluation.structuralScore - 6
  const strictlyImprovesOverlaps = after.edgeOverlaps < before.edgeOverlaps
  if (after.nodeOverlaps > before.nodeOverlaps || after.edgeNodeIntersections > before.edgeNodeIntersections
    || after.edgeCrossings > before.edgeCrossings
    || after.labelOverflows > before.labelOverflows || after.labelOverlaps > before.labelOverlaps
    || after.labelNodeIntersections > before.labelNodeIntersections
    || candidate.routeDiagnostics.unrelatedFrameIntrusionLength > original.routeDiagnostics.unrelatedFrameIntrusionLength
    || candidate.routeDiagnostics.frameOverlapArea >= original.scene.width * original.scene.height * 0.1
    || candidate.routeDiagnostics.totalRouteLength > original.routeDiagnostics.totalRouteLength * 1.15
    || candidate.presentation.estimatedTitlePxAtFit < original.presentation.estimatedTitlePxAtFit
    || (!strictlyImprovesOverlaps && !canAcceptBoundedOverlapTrade)
    || !candidate.visualPlan.review.readyForVisualReview
    || candidateReviewScore <= originalReviewScore + (strictlyImprovesOverlaps ? 1 : 0)) return original
  const inputIndex = new Map([
    ...intent.nodes.map((node, index) => [node.id, index] as const),
    ...intent.relations.map((_, index) => [`__relation-${index + 1}`, intent.nodes.length + index] as const),
  ])
  return { ...candidate,
    scene: { ...candidate.scene, elements: candidate.scene.elements.slice().sort((a, b) =>
      (inputIndex.get(a.id) ?? Infinity) - (inputIndex.get(b.id) ?? Infinity)) },
    inputOrderStrategy: 'original' as const,
    layoutOrderingStrategy: 'partition-first' as const,
  }
}

/** Bounded local grid reconciliation for large overlapping region frames.
 * Moving one outlier and rerouting nearby edges often recovers the space that
 * the original collision resolver accidentally gave to another partition.
 * Never trade away a zero-crossing graph to make its outlines look cleaner. */
function compactConflictedGroupMembers(result: ReturnType<typeof packSparseArchitectureRegions>, primaryPath?: readonly string[]) {
  const scene = result.scene
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  if (primaryPath?.length || nodes.length < 17 || nodes.length > 24 || arrows.length > 32
    || result.routeDiagnostics.frameOverlapArea < 100_000
    || result.quality.metrics.edgeCrossings > 0 || result.quality.metrics.edgeNodeIntersections > 0
    || nodes.some((node) => node.locked)) return result
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const intruders = [...new Set(result.routeDiagnostics.worstFrameOverlaps.slice(0, 3)
    .flatMap((frame) => frame.intrudingNodeIds))].slice(0, 8)
  const candidatePositions: Array<{ id: string; x: number; y: number; frameArea: number }> = []
  for (const id of intruders) {
    const original = byId.get(id)
    if (!original?.groupId?.startsWith('arch-')) continue
    const peers = nodes.filter((node) => node.groupId === original.groupId && node.id !== id)
    if (!peers.length) continue
    const xSlots = [...new Set(peers.map((node) => node.x))]
    const ySlots = [...new Set(peers.map((node) => node.y))]
    const options: typeof candidatePositions = []
    for (const x of xSlots) for (const y of ySlots) {
      if (x === original.x && y === original.y) continue
      // Existing compact grids frequently use an 18px physical clearance.
      const blocked = nodes.some((node) => node.id !== id
        && x < node.x + node.width + 12 && x + original.width + 12 > node.x
        && y < node.y + node.height + 12 && y + original.height + 12 > node.y)
      if (blocked) continue
      const moved: CanvasScene = { ...scene, elements: scene.elements.map((item) =>
        item.id === id ? { ...original, x, y } : item) }
      const frameArea = assessArchitectureRouteDiagnostics(moved).frameOverlapArea
      if (frameArea >= result.routeDiagnostics.frameOverlapArea * 0.9) continue
      options.push({ id, x, y, frameArea })
    }
    options.sort((a, b) => a.frameArea - b.frameArea
      || Math.abs(a.x - original.x) + Math.abs(a.y - original.y)
        - Math.abs(b.x - original.x) - Math.abs(b.y - original.y))
    candidatePositions.push(...options.slice(0, 2))
  }
  let best: { scene: CanvasScene; quality: CanvasVisualQualityAssessment;
    route: ReturnType<typeof assessArchitectureRouteDiagnostics>;
    presentation: ReturnType<typeof assessArchitecturePresentation>;
    evaluation: ArchitectureLayoutAssessment } | undefined
  for (const position of candidatePositions.slice(0, 16)) {
    const original = byId.get(position.id)!
    const moved: CanvasScene = { ...scene, elements: scene.elements.map((item) => item.id === position.id
      ? { ...original, x: position.x, y: position.y } : item) }
    const candidate = routeArchitectureEdgesIncremental(moved, [position.id])
    const quality = assessCanvasVisualQuality(candidate)
    const before = result.quality.metrics, after = quality.metrics
    if (after.nodeOverlaps > before.nodeOverlaps || after.edgeCrossings > before.edgeCrossings
      || after.edgeOverlaps > before.edgeOverlaps || after.edgeNodeIntersections > before.edgeNodeIntersections
      || after.labelOverlaps > before.labelOverlaps || after.labelOverflows > before.labelOverflows
      || after.labelNodeIntersections > before.labelNodeIntersections) continue
    // A node move must never silently rewrite a genuine fan-out bundle.
    if (candidate.elements.some((item) => item.type === 'arrow'
      && item.bundleKey !== arrows.find((arrow) => arrow.id === item.id)?.bundleKey)) continue
    const routedNodes = new Map(candidate.elements.filter((item): item is CanvasNode => item.type === 'node')
      .map((node) => [node.id, node]))
    const sharedBundles = new Map<string, CanvasArrow[]>()
    for (const item of candidate.elements) {
      if (item.type !== 'arrow' || !item.bundleKey?.startsWith('from:')) continue
      sharedBundles.set(item.bundleKey, [...(sharedBundles.get(item.bundleKey) ?? []), item])
    }
    if ([...sharedBundles.values()].some((members) => members.length < 2
      || members.slice(1).some((arrow) => {
        const first = members[0]
        const from = routedNodes.get(first.from), to = routedNodes.get(first.to)
        const otherFrom = routedNodes.get(arrow.from), otherTo = routedNodes.get(arrow.to)
        return !from || !to || !otherFrom || !otherTo
          || !canvasSharedSourceStem(canvasArrowBoxRoute(from, to, first),
            canvasArrowBoxRoute(otherFrom, otherTo, arrow))
      }))) continue
    const route = assessArchitectureRouteDiagnostics(candidate)
    if (route.frameOverlapArea > position.frameArea || route.frameOverlapArea >= result.routeDiagnostics.frameOverlapArea * 0.9
      || route.unrelatedFrameIntrusionLength > result.routeDiagnostics.unrelatedFrameIntrusionLength
      || route.totalRouteLength > result.routeDiagnostics.totalRouteLength * 1.15) continue
    const presentation = assessArchitecturePresentation(candidate)
    const evaluation = evaluateArchitectureLayout(candidate, quality, result.evaluation.layout, result.evaluation.density)
    if (presentation.estimatedTitlePxAtFit < result.presentation.estimatedTitlePxAtFit
      // Frame intrusion isn't part of the legacy 90-point geometry score. A
      // >20% frame-area reduction can justify at most one detour point, never
      // a new crossing, overlapping relationship or smaller title.
      || evaluation.structuralScore < result.evaluation.structuralScore - 1
      || route.frameOverlapArea > result.routeDiagnostics.frameOverlapArea * 0.8
      || (best && route.frameOverlapArea >= best.route.frameOverlapArea)) continue
    best = { scene: candidate, quality, route, presentation, evaluation }
  }
  if (!best) return result
  return { ...result, scene: best.scene, quality: best.quality, routeDiagnostics: best.route,
    presentation: best.presentation, evaluation: best.evaluation,
    visualPlan: planArchitectureVisual(best.scene, result.semanticComposition, best.quality, best.presentation, best.route),
    candidates: result.candidates.map((candidate) => candidate.layout === result.evaluation.layout
      && candidate.density === result.evaluation.density ? best.evaluation : candidate),
    layoutOrderingStrategy: 'group-grid-compaction' as const }
}

/** Pack real node rectangles into non-overlapping functional regions before
 * routing. Sparse layered graphs can tolerate this topology adjustment, while
 * dense fan-outs keep their existing jointly refined graph unchanged. */
function packSparseArchitectureRegions(result: ReturnType<typeof composeArchitectureGraphOriginal>, primaryPath?: readonly string[]) {
  const scene = result.scene
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  if (result.summary.composition !== 'layered' || primaryPath?.length || nodes.length < 17 || nodes.length > 22
    || arrows.length > nodes.length * 0.6 || arrows.some((item) => item.bundleKey)
    || nodes.some((item) => item.locked)
    || result.routeDiagnostics.frameOverlapArea < 50_000) return result
  const rows: ArchitecturePartition[][] = [
    ['external', 'experience', 'application'], ['processing'], ['data'],
  ]
  const positions = new Map<string, { x: number; y: number }>()
  const clusters = new Map<ArchitecturePartition, { nodes: CanvasNode[]; columns: number;
    stepX: number; stepY: number; width: number; height: number }>()
  for (const partition of rows.flat()) {
    const items = nodes.filter((node) => node.groupId === `arch-${partition}`)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, 'en'))
    if (!items.length) continue
    const columns = Math.min(partition === 'external' ? 1 : partition === 'experience' ? 2
      : partition === 'data' || partition === 'application' ? 2 : 3, items.length)
    const stepX = Math.max(...items.map((node) => node.width)) + 24
    const stepY = Math.max(...items.map((node) => node.height)) + 24
    clusters.set(partition, { nodes: items, columns, stepX, stepY,
      width: columns * stepX + 24, height: Math.ceil(items.length / columns) * stepY + 54 })
  }
  if (clusters.size < 3 || clusters.size !== (scene.groups ?? []).length
    || clusters.size !== new Set(nodes.map((node) => node.groupId)).size) return result
  const rowWidths = rows.map((row) => row.reduce((sum, partition) =>
    sum + (clusters.get(partition)?.width ?? 0), 0)
    + Math.max(0, row.filter((partition) => clusters.has(partition)).length - 1) * 52)
  const maxWidth = Math.max(...rowWidths)
  let y = 60
  rows.forEach((row, index) => {
    const active = row.filter((partition) => clusters.has(partition))
    if (!active.length) return
    let x = 60 + Math.floor((maxWidth - rowWidths[index]) / 2)
    const rowHeight = Math.max(...active.map((partition) => clusters.get(partition)!.height))
    for (const partition of active) {
      const cluster = clusters.get(partition)!
      cluster.nodes.forEach((node, number) => positions.set(node.id, {
        x: x + 24 + number % cluster.columns * cluster.stepX,
        y: y + 54 + Math.floor(number / cluster.columns) * cluster.stepY,
      }))
      x += cluster.width + 52
    }
    y += rowHeight + 54
  })
  if (positions.size !== nodes.length) return result
  const packed: CanvasScene = {
    ...scene,
    width: Math.max(960, maxWidth + 120), height: Math.max(620, y),
    elements: scene.elements.map((item) => item.type === 'node' ? { ...item, ...positions.get(item.id)! } : item),
  }
  const routed = routeArchitectureEdges(packed)
  const quality = assessCanvasVisualQuality(routed)
  const evaluation = evaluateArchitectureLayout(routed, quality, result.evaluation.layout, result.evaluation.density)
  const diagnostics = assessArchitectureRouteDiagnostics(routed)
  const presentation = assessArchitecturePresentation(routed)
  const before = result.quality.metrics, after = quality.metrics
  if (diagnostics.frameOverlapArea > result.routeDiagnostics.frameOverlapArea * 0.2
    || after.nodeOverlaps > before.nodeOverlaps || after.edgeCrossings > before.edgeCrossings
    || after.edgeOverlaps > before.edgeOverlaps || after.edgeNodeIntersections > before.edgeNodeIntersections
    || after.labelNodeIntersections > before.labelNodeIntersections
    || after.labelOverflows > before.labelOverflows || after.labelOverlaps > before.labelOverlaps
    || diagnostics.unrelatedFrameIntrusionLength > result.routeDiagnostics.unrelatedFrameIntrusionLength
    || diagnostics.totalRouteLength > result.routeDiagnostics.totalRouteLength * 1.25
    || presentation.estimatedTitlePxAtFit < result.presentation.estimatedTitlePxAtFit
    || evaluation.structuralScore < result.evaluation.structuralScore) return result
  return {
    ...result, scene: routed, quality, evaluation, routeDiagnostics: diagnostics, presentation,
    visualPlan: planArchitectureVisual(routed, result.semanticComposition, quality, presentation, diagnostics),
    layoutOrderingStrategy: 'partition-packed' as const,
  }
}

/** When independent, non-bundled edges still overlap, try routing only those
 * edges using their actual endpoints instead of their region center vectors.
 * Preserve all coordinates, IDs and intentional buses; accept only a strict
 * end-to-end quality improvement. Dense fan-outs never get another relayout. */
function improveCongestedPorts(result: ReturnType<typeof composeArchitectureGraphOriginal>, mildConflicts = false) {
  const nodes = result.scene.elements.filter((item) => item.type === 'node').length
  const arrows = result.scene.elements.filter((item) => item.type === 'arrow')
  if (nodes < (mildConflicts ? 12 : 16) || nodes > 24 || arrows.length > 32
    || result.quality.metrics.edgeOverlaps < (mildConflicts ? 1 : 3)) return result
  const byId = new Map(arrows.map((arrow) => [arrow.id, arrow]))
  // Fix the edge conflicting with the most independent relationships first.
  // Stable ID tie-breaks prevent the source enumeration order from changing
  // which of the bounded reroute attempts receive attention.
  const affected = rankArchitectureOverlapHotspots(result.scene, result.quality)
    .map((hotspot) => hotspot.edgeId)
    .filter((id) => !byId.get(id)?.bundleKey).slice(0, 10)
  let scene = result.scene
  let quality = result.quality
  let diagnostics = result.routeDiagnostics
  let rerouted = 0
  for (const id of affected) {
    const candidate = routeArchitectureArrowIds(scene, [id], true)
    const beforeArrow = scene.elements.find((item) => item.id === id)
    const afterArrow = candidate.elements.find((item) => item.id === id)
    if (beforeArrow?.type !== 'arrow' || afterArrow?.type !== 'arrow'
      || beforeArrow.bundleKey !== afterArrow.bundleKey) continue
    const proposed = assessCanvasVisualQuality(candidate)
    const before = quality.metrics, after = proposed.metrics
    if (after.edgeOverlaps >= before.edgeOverlaps
      || after.edgeCrossings > before.edgeCrossings
      || after.edgeNodeIntersections > before.edgeNodeIntersections
      || after.nodeOverlaps > before.nodeOverlaps
      || after.labelNodeIntersections > before.labelNodeIntersections
      || after.labelOverlaps > before.labelOverlaps
      || after.labelOverflows > before.labelOverflows) continue
    const route = assessArchitectureRouteDiagnostics(candidate)
    if (route.unrelatedFrameIntrusionLength > diagnostics.unrelatedFrameIntrusionLength
      || route.totalRouteLength > diagnostics.totalRouteLength * 1.15) continue
    scene = candidate
    quality = proposed
    diagnostics = route
    rerouted += 1
  }
  // A genuine shared source trunk can still collide after its fork. Preserve
  // the common stem and both port normals, changing only the branch corridor.
  // This is a bounded local search; unrelated and group-bus edges are excluded.
  if (quality.metrics.edgeOverlaps >= 4) {
    const bundled = rankArchitectureOverlapHotspots(scene, quality)
      .map((hotspot) => hotspot.edgeId)
      .filter((id) => {
        const arrow = scene.elements.find((item) => item.id === id)
        return arrow?.type === 'arrow' && arrow.bundleKey?.startsWith('from:')
      }).slice(0, 5)
    for (const id of bundled) {
      let best: { scene: CanvasScene; quality: CanvasVisualQualityAssessment;
        diagnostics: ReturnType<typeof assessArchitectureRouteDiagnostics> } | undefined
      for (const candidate of nudgeSharedSourceBranch(scene, id)) {
        const proposed = assessCanvasVisualQuality(candidate)
        const before = quality.metrics, after = proposed.metrics
        if (after.edgeOverlaps >= (best?.quality.metrics.edgeOverlaps ?? before.edgeOverlaps)
          || after.edgeCrossings > before.edgeCrossings
          || after.edgeNodeIntersections > before.edgeNodeIntersections
          || after.nodeOverlaps > before.nodeOverlaps
          || after.labelNodeIntersections > before.labelNodeIntersections
          || after.labelOverlaps > before.labelOverlaps
          || after.labelOverflows > before.labelOverflows) continue
        const route = assessArchitectureRouteDiagnostics(candidate)
        if (route.unrelatedFrameIntrusionLength > diagnostics.unrelatedFrameIntrusionLength
          || route.totalRouteLength > diagnostics.totalRouteLength * 1.15) continue
        best = { scene: candidate, quality: proposed, diagnostics: route }
      }
      if (best) {
        scene = best.scene
        quality = best.quality
        diagnostics = best.diagnostics
        rerouted += 1
      }
    }
  }
  if (!rerouted) return result
  const evaluation = evaluateArchitectureLayout(scene, quality, result.evaluation.layout, result.evaluation.density)
  if (evaluation.structuralScore < result.evaluation.structuralScore) return result
  const presentation = assessArchitecturePresentation(scene)
  const visualPlan = planArchitectureVisual(scene, result.semanticComposition, quality, presentation, diagnostics)
  return { ...result, scene, quality, evaluation, presentation, routeDiagnostics: diagnostics,
    visualPlan, reroutedEdges: result.reroutedEdges + rerouted,
    candidates: result.candidates.map((candidate) => candidate === result.evaluation ? evaluation : candidate) }
}
