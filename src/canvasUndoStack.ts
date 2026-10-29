/**
 * The editor's local undo history is a pair of source snapshots. It is separate
 * from the document-level patch history: this one only guarantees that a user
 * can walk back through their own typing and gestures within one mount.
 *
 * Three rules matter and are enforced here rather than at call sites:
 * a new edit invalidates the redo branch, the stack is capped so a long session
 * cannot grow without bound, and an external source change (another window, the
 * agent) starts a fresh boundary so an old snapshot never overwrites new work.
 */
export const CANVAS_UNDO_LIMIT = 100

export interface CanvasUndoStack {
  undo: readonly string[]
  redo: readonly string[]
}

export const EMPTY_CANVAS_UNDO_STACK: CanvasUndoStack = { undo: [], redo: [] }

export function recordCanvasUndo(stack: CanvasUndoStack, before: string, current: string): CanvasUndoStack {
  if (before === current) return stack
  const undo = [...stack.undo, before]
  return {
    undo: undo.length > CANVAS_UNDO_LIMIT ? undo.slice(undo.length - CANVAS_UNDO_LIMIT) : undo,
    redo: [],
  }
}

export function undoSources(stack: CanvasUndoStack, current: string): { stack: CanvasUndoStack; source?: string } {
  if (!stack.undo.length) return { stack }
  const source = stack.undo[stack.undo.length - 1]
  return {
    stack: { undo: stack.undo.slice(0, -1), redo: [...stack.redo, current] },
    source,
  }
}

export function redoSources(stack: CanvasUndoStack, current: string): { stack: CanvasUndoStack; source?: string } {
  if (!stack.redo.length) return { stack }
  const source = stack.redo[stack.redo.length - 1]
  return {
    stack: { undo: [...stack.undo, current], redo: stack.redo.slice(0, -1) },
    source,
  }
}

export function canUndoCanvas(stack: CanvasUndoStack): boolean {
  return stack.undo.length > 0
}

export function canRedoCanvas(stack: CanvasUndoStack): boolean {
  return stack.redo.length > 0
}
