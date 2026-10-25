/** Transient, exact-edge focus for crowded editable diagrams.
 * Not a graph traversal, hidden-edge filter, or Canvas document mutation.
 */
export interface CanvasRelationshipFocus {
  id: string
  from: string
  to: string
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
