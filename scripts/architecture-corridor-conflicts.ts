import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'
import type { CanvasQualityIssue } from '../src/canvasQuality.js'
import type { CanvasArrow, CanvasScene } from '../src/canvas.js'
import type { measureArchitectureLayoutDemand } from './architecture-layout-demand.js'

/** Join real post-route conflict evidence to pre-route logical DAG cut pressure.
 * A cut is a graph-theoretic dependency boundary, not a measured geometric
 * rectangle; counts are deliberately NOT the Canvas quality metric totals.
 */
export function attributeArchitectureCorridorConflicts(
  intent: ArchitectureIntentGraph,
  scene: CanvasScene,
  demand: ReturnType<typeof measureArchitectureLayoutDemand>,
  issues: readonly CanvasQualityIssue[],
) {
  const layers = new Map(demand.logicalLayers.map(({ nodeId, layer }) => [nodeId, layer]))
  const arrows = new Map(scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
    .map((item) => [item.id, item]))
  if (arrows.size !== intent.relations.length || layers.size !== intent.nodes.length) {
    throw new Error('Corridor attribution requires the complete input relation graph')
  }
  const edgesByCut = new Map<number, string[]>()
  let internalCycleRelations = 0
  intent.relations.forEach((edge, index) => {
    const id = `__relation-${index + 1}`
    const drawn = arrows.get(id)
    if (!drawn || drawn.from !== edge.from || drawn.to !== edge.to) {
      throw new Error(`Corridor attribution cannot match the real input relationship ${id}`)
    }
    const fromLayer = layers.get(edge.from), toLayer = layers.get(edge.to)
    if (fromLayer === undefined || toLayer === undefined) throw new Error('Corridor layer is missing a real node')
    if (fromLayer === toLayer) internalCycleRelations++
    for (let cut = fromLayer; cut < toLayer; cut++) {
      edgesByCut.set(cut, [...(edgesByCut.get(cut) ?? []), id])
    }
  })
  const edgeIssueCodes = new Set(['edge-crossing', 'edge-overlap', 'edge-through-node', 'excessive-edge-detour'])
  const actualIssues = issues.filter((issue) => edgeIssueCodes.has(issue.code))
  const frontiers = demand.routingFrontiers.map((frontier) => {
    const edgeIds = edgesByCut.get(frontier.afterLayer) ?? []
    if (edgeIds.length !== frontier.relationCount) {
      throw new Error('Corridor attribution does not match prelayout logical frontier')
    }
    const cutEdges = new Set(edgeIds)
    const attributed = actualIssues.filter((issue) => issue.elementIds.some((id) => cutEdges.has(id)))
    const pairCollisions = attributed.filter((issue) =>
      (issue.code === 'edge-crossing' || issue.code === 'edge-overlap')
      && issue.elementIds.filter((id) => cutEdges.has(id)).length >= 2)
    const defectIds = [...new Set(attributed.flatMap((issue) => issue.elementIds
      .filter((id) => cutEdges.has(id))))].sort()
    return {
      afterLayer: frontier.afterLayer,
      realRelations: edgeIds.length,
      sourceNodes: frontier.distinctSources,
      targetNodes: frontier.distinctTargets,
      affectedRelationIds: defectIds,
      touchingIssueCount: attributed.length,
      bothRelationsInCutIssueCount: pairCollisions.length,
      touchingCrossings: attributed.filter((issue) => issue.code === 'edge-crossing').length,
      touchingOverlaps: attributed.filter((issue) => issue.code === 'edge-overlap').length,
    }
  })
  return {
    provenance: 'Same input relations + completed routed Canvas + actual Canvas quality issues',
    note: 'An issue can be attributed to multiple DAG cuts when a long real dependency spans multiple cuts. Issue counts are NOT physical corridor crossings or total quality metrics.',
    internalCycleRelations,
    frontiers,
    mostConflictAffected: frontiers.slice().sort((a, b) =>
      b.bothRelationsInCutIssueCount - a.bothRelationsInCutIssueCount
      || b.touchingIssueCount - a.touchingIssueCount
      || b.realRelations - a.realRelations
      || a.afterLayer - b.afterLayer).slice(0, 3),
  }
}
