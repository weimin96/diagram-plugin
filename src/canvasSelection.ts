/**
 * Selection rules for the canvas editor. Keeping them as data transformations
 * means the "what is still selectable" question has one answer and can be
 * asserted without an SVG.
 */

/** Drop ids whose element disappeared; return the same array when nothing changed. */
export function pruneCanvasSelection(selected: readonly string[], available: ReadonlySet<string>): readonly string[] {
  const valid = selected.filter((id) => available.has(id))
  return valid.length === selected.length ? selected : valid
}

/** Shift-click semantics: add when absent, remove when present. */
export function toggleCanvasSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
}

/** Select-all only covers boxes; relations are selected through their lens. */
export function selectableCanvasIds(elements: readonly { id: string; type: string }[]): string[] {
  return elements.filter((element) => element.type !== 'arrow').map((element) => element.id)
}

/** A guided relation only makes sense while exactly its owning node stays selected. */
export function guidedRelationSurvives(guided: { nodeId: string } | null, selected: readonly string[]): boolean {
  return Boolean(guided && selected.length === 1 && selected[0] === guided.nodeId)
}
