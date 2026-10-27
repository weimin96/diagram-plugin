import type { CanvasArrow, CanvasNode, CanvasScene } from './canvas.js'

/** Three real operation intents, not three competing layout engines.
 * A generated draft has no authored geometry. A reflow is an explicit
 * whole-document action. An edit preserves all unrelated geometry.
 */
export type ArchitectureLayoutMode = 'generate' | 'reflow' | 'edit'

export type ArchitectureLayoutContract = Readonly<{
  mode: ArchitectureLayoutMode
  allowNodeResize: boolean
  allowCanvasResize: boolean
  allowUnlockedNodeMove: boolean
}>

export function architectureLayoutContract(mode: ArchitectureLayoutMode): ArchitectureLayoutContract {
  switch (mode) {
    case 'generate': return {
      mode, allowNodeResize: true, allowCanvasResize: true,
      allowUnlockedNodeMove: true,
    }
    case 'reflow': return {
      mode, allowNodeResize: true, allowCanvasResize: true,
      allowUnlockedNodeMove: true,
    }
    case 'edit': return {
      mode, allowNodeResize: false, allowCanvasResize: false,
      allowUnlockedNodeMove: false,
    }
  }
}

/** Validate the semantic/geometry invariants at a real operation boundary.
 * This is deliberately NOT a visual approval or route-quality assessment.
 * The existing geometry, readability and human-review gates remain separate.
 */
export function assertArchitectureLayoutTransition(
  before: CanvasScene | undefined,
  after: CanvasScene,
  contract: ArchitectureLayoutContract,
): void {
  if ((contract.mode === 'generate') !== (before === undefined)) {
    throw new Error(`Architecture ${contract.mode} requires ${contract.mode === 'generate' ? 'a new scene' : 'an existing scene'}`)
  }
  if (!Number.isFinite(after.width) || !Number.isFinite(after.height)
    || after.width <= 0 || after.height <= 0) throw new Error('Invalid architecture canvas bounds')

  const nodes = after.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = after.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (new Set(after.elements.map((item) => item.id)).size !== after.elements.length) {
    throw new Error('Duplicate architecture element ID')
  }
  if (after.elements.some((item) => item.type !== 'arrow'
    && (!Number.isFinite(item.x) || !Number.isFinite(item.y)
      || !Number.isFinite(item.width) || !Number.isFinite(item.height)
      || item.width <= 0 || item.height <= 0))) throw new Error('Invalid architecture node coordinates')
  if (arrows.some((arrow) => !byId.has(arrow.from) || !byId.has(arrow.to))) {
    throw new Error('Architecture relationship references a missing endpoint')
  }
  if (!before) return

  const earlierNodes = new Map(before.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((node) => [node.id, node]))
  const earlierArrows = new Map(before.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
    .map((arrow) => [arrow.id, arrow]))
  if (earlierNodes.size !== byId.size || earlierArrows.size !== arrows.length
    || arrows.some((arrow) => {
      const earlier = earlierArrows.get(arrow.id)
      return !earlier || earlier.from !== arrow.from || earlier.to !== arrow.to
        || earlier.label !== arrow.label || earlier.lineStyle !== arrow.lineStyle
    })) throw new Error('Architecture layout cannot add, remove or redefine real relationships')
  for (const [id, original] of earlierNodes) {
    const revised = byId.get(id)
    if (!revised) throw new Error(`Architecture layout removed node ${id}`)
    if (original.locked && !revised.locked) {
      throw new Error(`Architecture ${contract.mode} cannot clear the existing node lock ${id}`)
    }
    const geometryChanged = revised.x !== original.x || revised.y !== original.y
      || revised.width !== original.width || revised.height !== original.height
    if (original.locked && geometryChanged) {
      throw new Error(`Architecture ${contract.mode} cannot move or resize locked node ${id}`)
    }
    if ((!contract.allowUnlockedNodeMove && (revised.x !== original.x || revised.y !== original.y))
      || (!contract.allowNodeResize && (revised.width !== original.width || revised.height !== original.height))) {
      throw new Error(`Architecture ${contract.mode} cannot move or resize existing node ${id}`)
    }
  }
  if (!contract.allowCanvasResize && (after.width !== before.width || after.height !== before.height)) {
    throw new Error(`Architecture ${contract.mode} cannot resize the existing canvas`)
  }
}
