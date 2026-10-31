import type { CanvasArrow, CanvasNode, CanvasScene } from './canvas.js'

/** Read-only, evidence-based key-dependency emphasis. This never discards
 * relations or promotes an invented graph path: only explicitly primary
 * relations or existing relations between explicitly primary nodes qualify.
 */
export function canvasKeyDependencyLens(scene: CanvasScene): {
  nodeIds: ReadonlySet<string>
  arrowIds: ReadonlySet<string>
  totalArrows: number
} {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const selectedArrows = arrows.filter((arrow) =>
    nodes.has(arrow.from) && nodes.has(arrow.to)
    && (arrow.emphasis === 'primary'
      || (nodes.get(arrow.from)?.emphasis === 'primary'
        && nodes.get(arrow.to)?.emphasis === 'primary')))
  const nodeIds = new Set<string>()
  for (const arrow of selectedArrows) {
    nodeIds.add(arrow.from)
    nodeIds.add(arrow.to)
  }
  return { nodeIds, arrowIds: new Set(selectedArrows.map((arrow) => arrow.id)), totalArrows: arrows.length }
}

/** Complex architecture graphs open with a legible, evidence-backed reading
 * lens. Every source relation remains in the Canvas and can be shown via
 * “全部”; diagrams without verified primary edges open unchanged. */
export function preferKeyDependencyLens(scene: CanvasScene): boolean {
  if (!scene.architecture) return false
  const edges = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const lens = canvasKeyDependencyLens(scene)
  // Proposal overviews should read like a designed system map, not a wiring
  // diagram. A verified primary route is sufficient when it is a meaningful
  // subset of a multi-layer architecture; other relations stay inspectable.
  if (scene.architecture.diagramStyle === 'enterprise'
    && (scene.groups ?? []).filter((group) => group.labelSide === 'left').length >= 3
    && nodes.length >= 12 && edges.length >= 12
    && lens.arrowIds.size >= 2 && lens.arrowIds.size < edges.length) return true
  if (nodes.length < 6 || edges.length < nodes.length * 1.5) return false
  const incoming = new Map<string, number>()
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  if (Math.max(0, ...incoming.values()) < 6 && edges.length < nodes.length * 2.5) return false
  return lens.arrowIds.size > 0 && lens.arrowIds.size < edges.length
}
