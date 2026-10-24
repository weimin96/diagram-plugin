import { beautifyArchitectureScene, inferArchitectureComposition, routeArchitectureArrowIds, routeArchitectureEdges, type ArchitectureComposition, type ArchitectureTheme } from './architectureDesign.js'
import { assessCanvasVisualQuality, type CanvasVisualQualityAssessment } from './canvasQuality.js'
import type { DiagramVisualStyle } from './diagramVisualStyles.js'
import { canvasArrowBoxRoute, type CanvasArchitectureDensity, type CanvasIcon, type CanvasNode, type CanvasScene, type CanvasStencil } from './canvas.js'
import { assessArchitecturePresentation, recommendArchitectureTitleScale } from './architecturePresentationQuality.js'

/** Intent is the authoritative input; pixel coordinates are exclusively assigned by the layout engine. */
export interface ArchitectureIntentGraph {
  title: string
  theme?: ArchitectureTheme
  density?: CanvasArchitectureDensity
  style?: DiagramVisualStyle
  nodes: Array<{
    id: string
    text: string
    icon?: CanvasIcon
    stencil?: CanvasStencil
    subtitle?: string
    description?: string
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

function segmentsOverlapBeyondFork(left: ReturnType<typeof canvasArrowBoxRoute>, right: ReturnType<typeof canvasArrowBoxRoute>) {
  // Both routes already share one explicit source stem. Branches must not
  // overlap for any positive distance after the fork.
  for (let i = 1; i + 1 < left.length; i += 1) {
    const a = left[i], b = left[i + 1]
    for (let j = 1; j + 1 < right.length; j += 1) {
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
        const [a, b] = first.path, [c, d] = second.path
        if (a.x !== c.x || a.y !== c.y || b.x !== d.x || b.y !== d.y) continue
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 12) continue
        if (segmentsOverlapBeyondFork(first.path, second.path)) continue
        const key = `from:${source}:${Math.round(b.x)}:${Math.round(b.y)}`
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
    const affectedIds = [...new Set(quality.issues
      .filter((issue) => issueCodes.has(issue.code))
      .flatMap((issue) => issue.elementIds))].filter((id) => scene.elements.some((item) => item.type === 'arrow' && item.id === id)).slice(0, 10)
    if (!affectedIds.length) break
    let best: { scene: CanvasScene; quality: CanvasVisualQualityAssessment; evaluation: ArchitectureLayoutAssessment } | undefined
    for (const id of affectedIds) {
      for (const candidate of [routeArchitectureArrowIds(scene, [id]), ...nudgeArchitectureCorridors(scene, id)]) {
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
      if (!node?.groupId?.startsWith('arch-') || node.locked) continue
      const peers = nodes.filter((peer) =>
        peer.id !== node.id && peer.groupId === node.groupId && !peer.locked
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

export function composeArchitectureGraph(intent: ArchitectureIntentGraph) {
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
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: intent.title,
    width: 1600, height: 1000, workbench: 'architecture',
    style: intent.style ?? ({
      enterprise: 'nord', technical: 'blueprint', presentation: 'graphite',
      cloud: 'nord', editorial: 'graphite', sketch: 'warm',
    } satisfies Record<ArchitectureTheme, DiagramVisualStyle>)[intent.theme ?? 'enterprise'],
    elements: [
      ...intent.nodes.map((node) => ({
        ...node, type: 'node' as const, x: 0, y: 0, width: 204, height: 84,
      })),
      ...intent.relations.map((relation, index) => ({
        // The tool schema reserves a letter as the first character of a node ID.
        // A distinct prefix prevents a generated edge from colliding with a node.
        id: `__relation-${index + 1}`,
        type: 'arrow' as const,
        from: relation.from,
        to: relation.to,
        ...(relation.label ? { label: relation.label } : {}),
        ...(relation.asynchronous ? { lineStyle: 'dashed' as const } : {}),
      })),
    ],
    architecture: { theme: intent.theme ?? 'enterprise', view: 'detail', density: intent.density ?? 'auto' },
  }
  const inferred = inferArchitectureComposition(scene)
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
    const result = beautifyArchitectureScene(scene, { theme: intent.theme, density, composition })
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
    return {
      ...candidate,
      ...result,
      selectionScore: result.evaluation.structuralScore
        - (candidate.summary.composition === inferred ? 0 : 6)
        - (candidate.summary.resolvedDensity === autoDensity ? 0 : 1),
    }
  }).sort((a, b) => b.selectionScore - a.selectionScore
    || a.quality.issues.length - b.quality.issues.length
    || a.summary.composition.localeCompare(b.summary.composition))
  const { selectionScore: _selectionScore, ...selected } = refined[0]
  const ordered = refineArchitectureNodeOrder(selected, selected.summary.composition, selected.summary.resolvedDensity)
  const titleScale = recommendArchitectureTitleScale(ordered.scene)
  const finalScene: CanvasScene = annotateSourceFanoutTrunks(titleScale > 1
    ? { ...ordered.scene, architecture: { ...ordered.scene.architecture!, titleScale } }
    : ordered.scene)
  const finalQuality = assessCanvasVisualQuality(finalScene)
  const finalEvaluation = evaluateArchitectureLayout(finalScene, finalQuality, selected.summary.composition, selected.summary.resolvedDensity)
  const refinedByLayout = new Map(refined.map((candidate) =>
    [`${candidate.summary.composition}:${candidate.summary.resolvedDensity}`, candidate.evaluation]))
  return {
    ...selected, ...ordered, scene: finalScene, quality: finalQuality, evaluation: finalEvaluation,
    presentation: assessArchitecturePresentation(finalScene),
    candidates: candidates.map(({ evaluation, summary }) =>
      summary.composition === selected.summary.composition && summary.resolvedDensity === selected.summary.resolvedDensity
        ? finalEvaluation
        : refinedByLayout.get(`${summary.composition}:${summary.resolvedDensity}`) ?? evaluation),
  }
}
