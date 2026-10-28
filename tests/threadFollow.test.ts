import assert from 'node:assert/strict'
import test from 'node:test'
import { decideThreadFollow, type ThreadFollowInput } from '../src/threadFollow.js'

function input(overrides: Partial<ThreadFollowInput> = {}): ThreadFollowInput {
  return {
    updatedAt: '2026-10-28T06:38:15.913Z',
    lastUpdatedAt: '2026-10-28T06:20:00.000Z',
    proposalRevision: undefined,
    knownProposalRevision: undefined,
    skipRestored: false,
    followEnabled: true,
    dirty: false,
    activePath: 'docs/diagrams/结构质量演进.mmd',
    selectedPath: 'docs/diagrams/插件能力地图.mmd',
    ...overrides,
  }
}

test('thread follow decision keeps every pause reason distinguishable and never swallows a revision', () => {
  // 正常跟随：切到对话指向的图；同一张图只刷新焦点；对话没有当前图时交给列表处理。
  assert.deepEqual(decideThreadFollow(input()), { kind: 'switch', path: 'docs/diagrams/结构质量演进.mmd' })
  assert.deepEqual(decideThreadFollow(input({ selectedPath: 'docs/diagrams/结构质量演进.mmd' })), { kind: 'focus' })
  assert.deepEqual(decideThreadFollow(input({ activePath: undefined })), { kind: 'no-active' })

  // 有未保存修改：暂停切换但保留 revision —— 保存后同一状态必须还能重新进入切换判定。
  assert.deepEqual(decideThreadFollow(input({ dirty: true })), { kind: 'dirty-paused' })
  assert.deepEqual(decideThreadFollow(input({ dirty: false })), { kind: 'switch', path: 'docs/diagrams/结构质量演进.mmd' })

  // 用户主动暂停与一次性恢复跳过是两种不同的消费语义，不能混成同一个静默返回。
  assert.deepEqual(decideThreadFollow(input({ followEnabled: false })), { kind: 'user-paused' })
  assert.deepEqual(decideThreadFollow(input({ skipRestored: true })), { kind: 'skip' })

  // 状态未变：不消费、不切换；候选 revision 变化仍要触发一次处理。
  assert.deepEqual(decideThreadFollow(input({ lastUpdatedAt: '2026-10-28T06:38:15.913Z' })), { kind: 'ignore' })
  assert.deepEqual(decideThreadFollow(input({ updatedAt: undefined })), { kind: 'ignore' })
  const same = '2026-10-28T06:38:15.913Z'
  assert.deepEqual(
    decideThreadFollow(input({ updatedAt: same, lastUpdatedAt: same, proposalRevision: 'r7', knownProposalRevision: 'r6' })),
    { kind: 'switch', path: 'docs/diagrams/结构质量演进.mmd' },
  )
  assert.deepEqual(
    decideThreadFollow(input({ updatedAt: same, lastUpdatedAt: same, proposalRevision: 'r7', knownProposalRevision: 'r7' })),
    { kind: 'ignore' },
  )
})
