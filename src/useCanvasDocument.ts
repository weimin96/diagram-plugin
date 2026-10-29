import { EMPTY_CANVAS_UNDO_STACK, recordCanvasUndo, redoSources, undoSources, type CanvasUndoStack } from './canvasUndoStack.js'
import { parseCanvasScene, serializeCanvasScene, type CanvasScene } from './canvas.js'
import { useEffect, useRef, useState, type RefObject } from 'react'

export interface CanvasDocumentDeps {
  /** Source as it arrived from the host; used to detect external edits. */
  source: string
  /** Parsed scene for the same source, or null while invalid. */
  scene: CanvasScene | null
  onChange: (nextSource: string) => void
}

export interface CanvasDocumentHandle {
  sourceRef: RefObject<string>
  sceneRef: RefObject<CanvasScene | null>
  /** Replace the scene and publish the serialized source in one step. */
  applyScene: (next: CanvasScene, record?: boolean) => void
  /** Publish a source that was not produced from a CanvasScene (raw editor typing). */
  emitSource: (nextSource: string, record?: boolean) => void
  /** Record a pre-gesture snapshot without publishing anything. */
  recordGesture: (before: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Owns the editor's write path: the authoritative source/scene refs, the local
 * undo stack, and the boundary rule that an incoming external edit invalidates
 * local history instead of letting an old snapshot overwrite it.
 */
export function useCanvasDocument({ source, scene, onChange }: CanvasDocumentDeps): CanvasDocumentHandle {
  const sourceRef = useRef(source)
  const sceneRef = useRef<CanvasScene | null>(scene)
  const [stack, setStack] = useState<CanvasUndoStack>(EMPTY_CANVAS_UNDO_STACK)
  const stackRef = useRef(stack)

  // Keep the ref and state in lockstep inside one tick: a gesture records a
  // snapshot and immediately commits, so waiting for the next render would
  // drop or duplicate that boundary.
  function updateStack(next: CanvasUndoStack) {
    stackRef.current = next
    setStack(next)
  }

  useEffect(() => {
    if (source !== sourceRef.current) {
      // External update: the previous local snapshots describe a document that
      // no longer exists, so keeping them would let undo clobber the new state.
      updateStack(EMPTY_CANVAS_UNDO_STACK)
    }
    sourceRef.current = source
    sceneRef.current = scene
  }, [scene, source])

  function publish(nextSource: string, record: boolean, before?: string) {
    if (nextSource === sourceRef.current) return
    if (record) updateStack(recordCanvasUndo(stackRef.current, before ?? sourceRef.current, nextSource))
    sourceRef.current = nextSource
    try { sceneRef.current = parseCanvasScene(nextSource) } catch { /* source editor owns invalid JSON */ }
    onChange(nextSource)
  }

  function applyScene(next: CanvasScene, record = true) {
    sceneRef.current = next
    publish(serializeCanvasScene(next), record)
  }

  function emitSource(nextSource: string, record = true) {
    publish(nextSource, record)
  }

  function recordGesture(before: string) {
    if (before === sourceRef.current) return
    updateStack(recordCanvasUndo(stackRef.current, before, sourceRef.current))
  }

  function undo() {
    const result = undoSources(stackRef.current, sourceRef.current)
    if (!result.source) return
    updateStack(result.stack)
    const previous = result.source
    sourceRef.current = previous
    try { sceneRef.current = parseCanvasScene(previous) } catch { /* keep last good scene */ }
    onChange(previous)
  }

  function redo() {
    const result = redoSources(stackRef.current, sourceRef.current)
    if (!result.source) return
    updateStack(result.stack)
    const next = result.source
    sourceRef.current = next
    try { sceneRef.current = parseCanvasScene(next) } catch { /* keep last good scene */ }
    onChange(next)
  }

  return {
    sourceRef,
    sceneRef,
    applyScene,
    emitSource,
    recordGesture,
    undo,
    redo,
    canUndo: stack.undo.length > 0,
    canRedo: stack.redo.length > 0,
  }
}
