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
