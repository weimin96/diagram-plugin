import { guidedRelationSurvives, pruneCanvasSelection, selectableCanvasIds, toggleCanvasSelection } from '../src/canvasSelection.js'
import assert from 'node:assert/strict'
import test from 'node:test'

// Selection is the editor's most user-visible invariant: deleting an element
// must not leave a ghost id selected, and shift-click must be reversible.
test('selection policy prunes ghosts, toggles ids and ignores relations for select-all', () => {
  // Nothing changed: the same array is returned so React can skip a re-render.
  const current = ['a', 'b']
  assert.equal(pruneCanvasSelection(current, new Set(['a', 'b', 'c'])), current)

  // A deleted element disappears from the selection, order preserved.
  assert.deepEqual(pruneCanvasSelection(current, new Set(['b'])), ['b'])
  assert.deepEqual(pruneCanvasSelection(current, new Set()), [])

  // Shift-click adds then removes.
  assert.deepEqual(toggleCanvasSelection([], 'a'), ['a'])
  assert.deepEqual(toggleCanvasSelection(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleCanvasSelection(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggleCanvasSelection(['a'], 'a'), [])

  // Select-all covers boxes only; arrows are reached through their relation lens.
  const elements = [
    { id: 'n1', type: 'node' },
    { id: 'a1', type: 'arrow' },
    { id: 'note1', type: 'note' },
  ]
  assert.deepEqual(selectableCanvasIds(elements), ['n1', 'note1'])

  // A guided relation survives only while its own node is the sole selection.
  assert.equal(guidedRelationSurvives({ nodeId: 'n1' }, ['n1']), true)
  assert.equal(guidedRelationSurvives({ nodeId: 'n1' }, ['n1', 'n2']), false)
  assert.equal(guidedRelationSurvives({ nodeId: 'n1' }, ['n2']), false)
  assert.equal(guidedRelationSurvives({ nodeId: 'n1' }, []), false)
  assert.equal(guidedRelationSurvives(null, ['n1']), false)
})
