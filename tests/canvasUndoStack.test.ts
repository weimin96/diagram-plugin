import { CANVAS_UNDO_LIMIT, EMPTY_CANVAS_UNDO_STACK, canRedoCanvas, canUndoCanvas, recordCanvasUndo, redoSources, undoSources, type CanvasUndoStack } from '../src/canvasUndoStack.js'
import assert from 'node:assert/strict'
import test from 'node:test'

// The editor's local undo stack holds whole source snapshots. The rules that
// users feel are: an edit clears the redo branch, repeated undo/redo walks the
// same path, a long session cannot grow without bound, and an identical edit
// records nothing.
test('local undo stack invalidates redo, caps history and round-trips sources', () => {
  assert.deepEqual(EMPTY_CANVAS_UNDO_STACK, { undo: [], redo: [] })
  assert.equal(canUndoCanvas(EMPTY_CANVAS_UNDO_STACK), false)
  assert.equal(canRedoCanvas(EMPTY_CANVAS_UNDO_STACK), false)

  // Recording an unchanged source is a no-op (same object, no allocation).
  assert.equal(recordCanvasUndo(EMPTY_CANVAS_UNDO_STACK, 'A', 'A'), EMPTY_CANVAS_UNDO_STACK)

  // Two edits produce two undo entries and clear redo.
  let stack = recordCanvasUndo(EMPTY_CANVAS_UNDO_STACK, 'A', 'B')
  stack = recordCanvasUndo(stack, 'B', 'C')
  assert.deepEqual(stack, { undo: ['A', 'B'], redo: [] })
  assert.equal(canUndoCanvas(stack), true)

  // Undo moves the current source onto the redo stack and returns the previous one.
  const first = undoSources(stack, 'C')
  assert.equal(first.source, 'B')
  assert.deepEqual(first.stack, { undo: ['A'], redo: ['C'] })
  const second = undoSources(first.stack, 'B')
  assert.equal(second.source, 'A')
  assert.deepEqual(second.stack, { undo: [], redo: ['C', 'B'] })
  assert.equal(canUndoCanvas(second.stack), false)

  // Redo walks back in order.
  const redoOne = redoSources(second.stack, 'A')
  assert.equal(redoOne.source, 'B')
  assert.deepEqual(redoOne.stack, { undo: ['A'], redo: ['C'] })
  const redoTwo = redoSources(redoOne.stack, 'B')
  assert.equal(redoTwo.source, 'C')
  assert.deepEqual(redoTwo.stack, { undo: ['A', 'B'], redo: [] })

  // A new edit after undo discards the redo branch entirely.
  const branched = recordCanvasUndo(first.stack, 'B', 'D')
  assert.deepEqual(branched, { undo: ['A', 'B'], redo: [] })

  // Undo and redo on empty stacks are inert rather than throwing.
  assert.deepEqual(undoSources(EMPTY_CANVAS_UNDO_STACK, 'A'), { stack: EMPTY_CANVAS_UNDO_STACK })
  assert.deepEqual(redoSources(EMPTY_CANVAS_UNDO_STACK, 'A'), { stack: EMPTY_CANVAS_UNDO_STACK })

  // The cap keeps the most recent snapshots, not the oldest ones.
  let capped: CanvasUndoStack = EMPTY_CANVAS_UNDO_STACK
  for (let index = 0; index < CANVAS_UNDO_LIMIT + 25; index += 1) {
    capped = recordCanvasUndo(capped, `s${index}`, `s${index + 1}`)
  }
  assert.equal(capped.undo.length, CANVAS_UNDO_LIMIT)
  assert.equal(capped.undo[0], 's25')
  assert.equal(capped.undo[CANVAS_UNDO_LIMIT - 1], `s${CANVAS_UNDO_LIMIT + 24}`)
  assert.equal(capped.redo.length, 0)
})
