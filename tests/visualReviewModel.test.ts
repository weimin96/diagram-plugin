import assert from 'node:assert/strict'
import test from 'node:test'
import { visualReviewCodexArgs, visualReviewModel } from '../scripts/visual-review-model.js'

test('architecture image reviewer uses the same explicit Luna Max contract as codex-ppt', () => {
  assert.deepEqual(visualReviewModel, {
    id: 'gpt-6-luna', reasoningEffort: 'max', label: 'GPT Luna 6 Max',
  })
  assert.deepEqual(visualReviewCodexArgs(), [
    '--model', 'gpt-6-luna', '-c', 'model_reasoning_effort="max"',
  ])
  assert.deepEqual(visualReviewCodexArgs('custom-reviewer'), [
    '--model', 'custom-reviewer', '-c', 'model_reasoning_effort="max"',
  ], 'an explicit model override cannot silently change the requested review effort')
})
