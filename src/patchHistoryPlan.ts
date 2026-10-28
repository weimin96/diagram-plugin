/**
 * Patch-history decisions.
 *
 * Undo, undo-chain, redo and redo-chain all repeat the same admission test
 * before touching the document. Keeping that test here makes the four call
 * sites read as intent, and keeps the "why was this rejected" answer testable
 * instead of implicit.
 */

export type PatchHistoryDirection = 'undo' | 'redo'

export type PatchHistoryRejection = 'no-selection' | 'other-document' | 'busy' | 'conflict'

export interface PatchHistoryGuardInput {
  entryPath: string
  selectedPath?: string
  saving: boolean
  undoingId: string | null
  redoingId: string | null
  dirty: boolean
  externalChange: boolean
}

export type PatchHistoryGuard = { kind: 'run' } | { kind: 'reject'; reason: PatchHistoryRejection }

export const PATCH_HISTORY_CONFLICT_MESSAGE = '当前画布同时存在未保存修改和外部更新，请先处理外部冲突。'

export function guardPatchHistory(input: PatchHistoryGuardInput): PatchHistoryGuard {
  if (!input.selectedPath) return { kind: 'reject', reason: 'no-selection' }
  if (input.selectedPath !== input.entryPath) return { kind: 'reject', reason: 'other-document' }
  if (input.saving || input.undoingId || input.redoingId) return { kind: 'reject', reason: 'busy' }
  if (input.dirty && input.externalChange) return { kind: 'reject', reason: 'conflict' }
  return { kind: 'run' }
}

/** Only a real conflict needs the user's attention; the other rejections stay silent. */
export function patchHistoryNotice(guard: PatchHistoryGuard): string | undefined {
  return guard.kind === 'reject' && guard.reason === 'conflict' ? PATCH_HISTORY_CONFLICT_MESSAGE : undefined
}
