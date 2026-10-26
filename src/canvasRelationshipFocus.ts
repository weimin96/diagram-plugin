/** Transient, exact-edge focus for crowded editable diagrams.
 * Not a graph traversal, hidden-edge filter, or Canvas document mutation.
 */
export interface CanvasRelationshipFocus {
  id: string
  from: string
  to: string
}

export interface CanvasNodeRelation {
  id: string
  oppositeId: string
  oppositeLabel: string
  label?: string
}

export interface CanvasIndexedRelation extends CanvasRelationshipFocus {
  fromLabel: string
  toLabel: string
  label?: string
  incomingCount: number
}

/** Read-only lookup for dense diagrams, ranked by real target fan-in.
 * Never collapses parallel edges or derives relationships that do not exist.
 * All results retain the original arrow ID for exact selection. */
export function searchCanvasRelations(
  nodes: readonly { id: string; text: string }[],
  relations: readonly (CanvasRelationshipFocus & { label?: string })[],
  query: string,
  limit = 60,
): { matches: CanvasIndexedRelation[]; total: number } {
  const names = new Map(nodes.map((node) => [node.id, node.text]))
  const counts = new Map<string, number>()
  for (const relation of relations) {
    if (!names.has(relation.from) || !names.has(relation.to)) continue
    counts.set(relation.to, (counts.get(relation.to) ?? 0) + 1)
  }
  const needle = query.trim().toLocaleLowerCase()
  const available: CanvasIndexedRelation[] = []
  for (const relation of relations) {
    const fromLabel = names.get(relation.from), toLabel = names.get(relation.to)
    if (fromLabel === undefined || toLabel === undefined) continue
    if (needle && ![fromLabel, toLabel, relation.from, relation.to, relation.label ?? '', relation.id]
      .some((part) => part.toLocaleLowerCase().includes(needle))) continue
    available.push({
      id: relation.id, from: relation.from, to: relation.to, fromLabel, toLabel,
      label: relation.label, incomingCount: counts.get(relation.to) ?? 0,
    })
  }
  available.sort((a, b) => b.incomingCount - a.incomingCount
    || a.toLabel.localeCompare(b.toLabel, 'en')
    || a.fromLabel.localeCompare(b.fromLabel, 'en')
    || a.id.localeCompare(b.id, 'en'))
  return { matches: available.slice(0, limit), total: available.length }
}

/** Deterministic one-hop relationship index, preserving every real edge
 * (including parallel edges). Displaying a relation never changes its graph
 * direction, saved Canvas state, or the geometry of the original arrows. */
export function canvasNodeRelations(
  nodeId: string,
  nodes: readonly { id: string; text: string }[],
  relations: readonly (CanvasRelationshipFocus & { label?: string })[],
): { incoming: CanvasNodeRelation[]; outgoing: CanvasNodeRelation[] } {
  const names = new Map(nodes.map((node) => [node.id, node.text]))
  const incoming: CanvasNodeRelation[] = []
  const outgoing: CanvasNodeRelation[] = []
  for (const relation of relations) {
    if (!names.has(relation.from) || !names.has(relation.to)) continue
    if (relation.to === nodeId) incoming.push({
      id: relation.id, oppositeId: relation.from, oppositeLabel: names.get(relation.from)!,
      label: relation.label,
    })
    if (relation.from === nodeId) outgoing.push({
      id: relation.id, oppositeId: relation.to, oppositeLabel: names.get(relation.to)!,
      label: relation.label,
    })
  }
  const compare = (a: CanvasNodeRelation, b: CanvasNodeRelation) =>
    a.oppositeLabel.localeCompare(b.oppositeLabel, 'en')
    || a.oppositeId.localeCompare(b.oppositeId, 'en') || a.id.localeCompare(b.id, 'en')
  return { incoming: incoming.sort(compare), outgoing: outgoing.sort(compare) }
}

export function resolveCanvasRelationshipFocus(
  relations: readonly CanvasRelationshipFocus[],
  selectedIds: readonly string[],
  hoveredArrowId: string | null,
  tracing: boolean,
): CanvasRelationshipFocus | null {
  if (tracing) return null // Explicit dependency trace is the stronger mode.
  const hovered = hoveredArrowId ? relations.find((item) => item.id === hoveredArrowId) : undefined
  if (hovered) return hovered
  return selectedIds.length === 1 ? relations.find((item) => item.id === selectedIds[0]) ?? null : null
}
