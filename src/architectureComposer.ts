import { beautifyArchitectureScene, inferArchitectureComposition, type ArchitectureComposition, type ArchitectureTheme } from './architectureDesign.js'
import { assessCanvasVisualQuality, type CanvasVisualQualityAssessment } from './canvasQuality.js'
import type { DiagramVisualStyle } from './diagramVisualStyles.js'
import { canvasArrowBoxRoute, type CanvasArchitectureDensity, type CanvasIcon, type CanvasNode, type CanvasScene, type CanvasStencil } from './canvas.js'

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
  const compositionCandidates: ArchitectureComposition[] = ['hub-spoke', 'event-driven', 'data-platform', 'cloud-native'].includes(inferred)
    ? [inferred, 'layered'] : [inferred]
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
  const { selectionScore: _selectionScore, ...selected } = candidates[0]
  return { ...selected, candidates: candidates.map(({ evaluation }) => evaluation) }
}
