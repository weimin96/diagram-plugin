import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagramCapability } from '../src/diagramCapabilities.js'
import { CRAMPED_EDITOR_WIDTH, NARROW_EDITOR_WIDTH, resolveEditorPolicy } from '../src/editorPolicy.js'
import { readViewPreferences, viewPreferenceScope, writeViewPreferences, VIEW_PREFERENCES_KEY, VIEW_PREFERENCES_LIMIT } from '../src/viewPreferences.js'
import { panelFeedback, panelFeedbackFromState, proposalBanner } from '../src/panelFeedback.js'
import { initialPanelState, panelReducer, WORKSPACE_SCOPED_KEYS } from '../src/panelStore.js'
import { guardPatchHistory, patchHistoryNotice, PATCH_HISTORY_CONFLICT_MESSAGE } from '../src/patchHistoryPlan.js'
import { planThreadTabClose, planThreadTabs } from '../src/threadTabPlan.js'
import { createDocumentSessionState, documentSessionReducer, isDirty, isExternalDeleted } from '../src/documentSession.js'
import type { DiagramDocument } from '../src/types.js'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key) },
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

test('面板决策：编辑器形态、反馈仲裁、历史准入与对话标签一致性', () => {
  const mermaid = diagramCapability('flowchart')
  const canvas = diagramCapability('canvas')
  const unknown = diagramCapability('unknown')

  // Capability comes from the document type, never from the host surface.
  assert.deepEqual([mermaid.visualEdit, mermaid.styleSelect, mermaid.patchHistory, mermaid.playback], [false, true, false, false])
  assert.deepEqual([canvas.visualEdit, canvas.styleSelect, canvas.patchHistory, canvas.playback], [true, false, true, true])
  assert.equal(mermaid.sourceEdit, true)
  assert.equal(canvas.sourceEdit, true)
  assert.equal(unknown, mermaid)

  // Workspace windows earn the full toolbar regardless of width.
  const wideWorkspace = resolveEditorPolicy({ surface: 'workspace', width: 1280, capability: mermaid })
  assert.equal(wideWorkspace.chrome, 'full')
  assert.equal(wideWorkspace.showWorkspaceTools, true)
  assert.deepEqual(wideWorkspace.modes, ['preview', 'source', 'split'])
  assert.equal(wideWorkspace.defaultMode, 'split')
  assert.equal(wideWorkspace.splitAxis, 'horizontal')
  assert.equal(wideWorkspace.showMinimap, false)

  // A narrow thread panel keeps every edit mode but drops the workspace toolbar,
  // and stacks the split vertically so both halves stay legible.
  const narrowThread = resolveEditorPolicy({ surface: 'thread', width: 420, capability: mermaid })
  assert.equal(narrowThread.chrome, 'compact')
  assert.equal(narrowThread.showWorkspaceTools, false)
  assert.deepEqual(narrowThread.modes, ['preview', 'source', 'split'])
  assert.equal(narrowThread.defaultMode, 'split')
  assert.equal(narrowThread.splitAxis, 'vertical')
  assert.equal(narrowThread.cramped, false)

  // Widening the panel promotes it back to the full toolbar: width, not host, is the cap.
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: 960, capability: mermaid }).chrome, 'full')
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: NARROW_EDITOR_WIDTH - 1, capability: mermaid }).splitAxis, 'vertical')
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: NARROW_EDITOR_WIDTH, capability: mermaid }).splitAxis, 'horizontal')

  // Draggable documents open on the canvas itself and never offer style presets.
  const narrowCanvas = resolveEditorPolicy({ surface: 'thread', width: CRAMPED_EDITOR_WIDTH - 1, capability: canvas })
  assert.equal(narrowCanvas.defaultMode, 'preview')
  assert.equal(narrowCanvas.cramped, true)
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: CRAMPED_EDITOR_WIDTH, capability: canvas }).cramped, false)

  // The minimap only appears once the canvas is too narrow to read at a glance.
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: NARROW_EDITOR_WIDTH - 1, capability: canvas }).showMinimap, true)
  assert.equal(resolveEditorPolicy({ surface: 'thread', width: NARROW_EDITOR_WIDTH, capability: canvas }).showMinimap, false)
  assert.equal(resolveEditorPolicy({ surface: 'workspace', width: 320, capability: mermaid }).showMinimap, false)

  // Preferences are scoped per surface and document, and invalid entries fall back to defaults.
  const storage = memoryStorage()
  const scope = viewPreferenceScope('thread', 'docs/diagrams/a.mmd')
  assert.equal(readViewPreferences(storage, scope), undefined)
  writeViewPreferences(storage, scope, { mode: 'source', follow: false })
  assert.deepEqual(readViewPreferences(storage, scope), { mode: 'source', follow: false })
  assert.equal(readViewPreferences(storage, viewPreferenceScope('thread', 'docs/diagrams/b.mmd')), undefined)
  assert.deepEqual(readViewPreferences(storage, viewPreferenceScope('thread')), undefined)

  storage.setItem(VIEW_PREFERENCES_KEY, '{not json')
  assert.equal(readViewPreferences(storage, scope), undefined)
  storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify({ [scope]: { mode: 'explode', follow: 'yes' } }))
  assert.equal(readViewPreferences(storage, scope), undefined)
  storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify({ [scope]: { follow: false } }))
  assert.deepEqual(readViewPreferences(storage, scope), { mode: 'split', follow: false })

  // The store stays bounded; the most recent scope always survives.
  const bounded = memoryStorage()
  for (let index = 0; index < VIEW_PREFERENCES_LIMIT + 5; index += 1) {
    writeViewPreferences(bounded, `thread:docs/${index}.mmd`, { mode: 'preview', follow: true })
  }
  const stored = JSON.parse(bounded.getItem(VIEW_PREFERENCES_KEY) ?? '{}') as Record<string, unknown>
  assert.equal(Object.keys(stored).length, VIEW_PREFERENCES_LIMIT)
  assert.deepEqual(readViewPreferences(bounded, `thread:docs/${VIEW_PREFERENCES_LIMIT + 4}.mmd`), { mode: 'preview', follow: true })
  assert.equal(readViewPreferences(bounded, 'thread:docs/0.mmd'), undefined)
  // Feedback is arbitrated into one banner: blocking failures win, and the rest
  // degrade to single-line rows in the same priority order.
  assert.deepEqual(panelFeedback({ surface: 'thread' }), { overflow: [] })
  const everything = panelFeedback({
    surface: 'thread',
    error: '保存失败',
    syncIssue: '同步已暂停',
    externalDeleted: true,
    externalChange: true,
    notice: '已导出 PNG',
    changeReview: true,
    proposal: { title: 'AI 候选修改', detail: '2 修改 · 1 新增 · 0 删除', branchCount: 2 },
    impact: { files: 3, direct: 5, indirect: 2 },
    saving: true,
  })
  assert.equal(everything.primary?.id, 'error')
  assert.deepEqual(everything.overflow.map((item) => item.id), ['external-deleted', 'sync-issue', 'proposal', 'impact', 'notice'])
  assert.deepEqual(everything.primary?.actions.map((action) => action.id), ['dismiss-error'])
  assert.deepEqual(everything.overflow[0].actions.map((action) => [action.id, action.disabled]), [['restore-file', true]])
  assert.deepEqual(everything.overflow[2].actions.map((action) => action.label), ['查看', '拒绝全部', '接受当前'])
  assert.equal(everything.overflow[4].actions[0].id, 'review-changes')

  // A failure raised inside the AI composer is not duplicated in the panel banner.
  assert.equal(panelFeedback({ surface: 'thread', error: '模型调用失败', aiOpen: true }).primary, undefined)
  // Sync warnings belong to the companion panel only; the workspace window has its own status.
  assert.equal(panelFeedback({ surface: 'workspace', syncIssue: '同步已暂停' }).primary, undefined)
  // A deleted file outranks an external edit, and both outrank a transient notice.
  assert.equal(panelFeedback({ surface: 'thread', externalChange: true, notice: '已保存' }).primary?.id, 'external-change')
  assert.equal(panelFeedback({ surface: 'thread', notice: '已保存' }).primary?.severity, 'info')
  // Patch history admission: the same four-line test used by undo, undo-chain,
  // redo and redo-chain, now answerable without a rendered panel.
  const idle = { entryPath: 'a.diagram.json', selectedPath: 'a.diagram.json', saving: false, undoingId: null, redoingId: null, dirty: false, externalChange: false }
  assert.deepEqual(guardPatchHistory(idle), { kind: 'run' })
  assert.deepEqual(guardPatchHistory({ ...idle, selectedPath: undefined }), { kind: 'reject', reason: 'no-selection' })
  assert.deepEqual(guardPatchHistory({ ...idle, entryPath: 'b.diagram.json' }), { kind: 'reject', reason: 'other-document' })
  assert.deepEqual(guardPatchHistory({ ...idle, saving: true }), { kind: 'reject', reason: 'busy' })
  assert.deepEqual(guardPatchHistory({ ...idle, undoingId: 'p1' }), { kind: 'reject', reason: 'busy' })
  assert.deepEqual(guardPatchHistory({ ...idle, redoingId: 'p2' }), { kind: 'reject', reason: 'busy' })
  const conflict = guardPatchHistory({ ...idle, dirty: true, externalChange: true })
  assert.deepEqual(conflict, { kind: 'reject', reason: 'conflict' })
  assert.equal(patchHistoryNotice(conflict), PATCH_HISTORY_CONFLICT_MESSAGE)
  assert.equal(patchHistoryNotice({ kind: 'reject', reason: 'busy' }), undefined)
  assert.equal(patchHistoryNotice({ kind: 'run' }), undefined)

  // Thread tabs keep conversation order, drop vanished paths and never invent one.
  assert.deepEqual(planThreadTabs(['a', 'b', 'c'], ['c', 'a']), { tabs: ['a', 'c'], complete: false })
  assert.deepEqual(planThreadTabs(['a', 'b'], ['a', 'b', 'z']), { tabs: ['a', 'b'], complete: true })
  assert.deepEqual(planThreadTabs([], ['a']), { tabs: [], complete: true })
  assert.deepEqual(planThreadTabClose(['a', 'b', 'c'], 'b'), { tabs: ['a', 'c'], fallback: 'a', clearsDocument: false })
  assert.deepEqual(planThreadTabClose(['a', 'b'], 'a'), { tabs: ['b'], fallback: 'b', clearsDocument: false })
  assert.deepEqual(planThreadTabClose(['a'], 'a'), { tabs: [], fallback: undefined, clearsDocument: true })
  assert.deepEqual(planThreadTabClose(['a', 'b'], 'zzz'), { tabs: ['a', 'b'], fallback: 'a', clearsDocument: false })
const document = { path: 'docs/diagrams/a.mmd', type: 'mermaid', source: 'flowchart TD', modifiedAt: 'm1', title: 'a' } as unknown as DiagramDocument
const opened = documentSessionReducer(createDocumentSessionState(), { type: 'open', document })
assert.equal(opened.source, 'flowchart TD')
assert.equal(isDirty(opened), false)
assert.equal(isExternalDeleted(opened), false)

// Typing marks the draft dirty; a write that lands after the typing is adopted.
const typed = documentSessionReducer(opened, { type: 'draft', source: 'flowchart TD\n  a-->b' })
assert.equal(isDirty(typed), true)
const saved = documentSessionReducer(typed, { type: 'saved', document: { ...document, source: 'flowchart TD\n  a-->b' }, expectedSource: 'flowchart TD\n  a-->b' })
assert.equal(saved.source, 'flowchart TD\n  a-->b')
assert.equal(isDirty(saved), false)

// A write whose result is older than the current draft must not clobber typing.
const raced = documentSessionReducer(typed, { type: 'saved', document: { ...document, source: 'stale' }, expectedSource: 'flowchart TD' })
assert.equal(raced.source, 'flowchart TD\n  a-->b')
assert.equal(isDirty(raced), true)

// External deletion keeps the draft alive and dirty even with an unchanged source.
const deleted = documentSessionReducer(opened, { type: 'deleted-draft', path: 'docs/diagrams/a.mmd' })
assert.equal(isExternalDeleted(deleted), true)
assert.equal(isDirty(deleted), true)
const restored = documentSessionReducer(deleted, { type: 'synced', document })
assert.equal(isExternalDeleted(restored), false)
assert.equal(isDirty(restored), false)

// Conflict flag is advisory: a sync or a fresh open clears it.
const conflicted = documentSessionReducer(typed, { type: 'external-change', value: true })
assert.equal(conflicted.externalChange, true)
assert.equal(documentSessionReducer(conflicted, { type: 'open', document }).externalChange, false)
assert.equal(documentSessionReducer(conflicted, { type: 'close' }).document, null)
assert.equal(documentSessionReducer(conflicted, { type: 'close' }).source, '')

// Proposal banner copy: branch count wins, then patch shape, then scope, then reason.
assert.equal(proposalBanner({ reason: 'x' }, 3).title, 'AI 候选分支 · 3')
assert.equal(proposalBanner({ patchSummary: { updated: 2, added: 1, removed: 0 } }, 0).title, 'AI 增量候选修改')
assert.equal(proposalBanner({ scopeElementIds: ['a'] }, 0).title, 'AI 子图候选修改')
assert.equal(proposalBanner({ reason: '等待确认' }, 0).title, 'AI 候选修改')
assert.equal(proposalBanner({ reason: '等待确认' }, 0).detail, '等待确认')
assert.equal(
  proposalBanner({ branchLabel: '方案 B', patchSummary: { updated: 4, added: 0, removed: 1 }, automaticElementIds: ['x', 'y'] }, 0).detail,
  '方案 B · 4 修改 · 0 新增 · 1 删除 · 2 自动影响',
)

// Live state mapping: indirect impact is the trace minus the direct hits, never negative.
const mapped = panelFeedbackFromState({
  surface: 'workspace',
  notice: '已保存',
  impact: { git: { files: [1, 2] }, directElementIds: ['a'], trace: { nodeIds: ['a'] } },
  proposal: { summary: { reason: '待审查' } },
  proposalBranchCount: 0,
})
assert.equal(mapped.primary?.id, 'proposal')
assert.equal(mapped.overflow[0]?.detail, '2 个文件 · 1 个直接节点 · 0 个间接节点')
assert.equal(panelFeedbackFromState({ surface: 'workspace', saving: true }).primary, undefined)
assert.equal(panelFeedbackFromState({ surface: 'thread', syncIssue: '文件同步正在重试' }).primary?.id, 'sync-issue')
assert.equal(panelFeedbackFromState({ surface: 'workspace', syncIssue: '文件同步正在重试' }).primary, undefined)

// Switching workspace drops exactly the workspace-scoped fields, and nothing else.
const dirtyPanel = {
  ...initialPanelState,
  canvasSelection: { ids: ['n1'], elements: [] } as never,
  aiProposal: { summary: { revision: '1', path: 'a.mmd', baseModifiedAt: 'b', updatedAt: 'u' }, before: {} as never, after: {} as never },
  changeReviewOpen: true,
  discardTarget: { kind: 'new-diagram' } as never,
  gitImpactOpen: true,
  threadDiagramQuery: 'auth',
  documentMenuOpen: true,
  // user preferences survive a project switch
  sidebarCollapsed: true,
  splitPercent: 61,
  aiOpen: true,
  notice: '已保存',
  creating: true,
}
const afterSwitch = panelReducer(dirtyPanel, { type: 'reset-workspace' })
for (const key of WORKSPACE_SCOPED_KEYS) {
  assert.deepEqual(afterSwitch[key], initialPanelState[key], `reset should clear ${key}`)
}
assert.equal(afterSwitch.sidebarCollapsed, true)
assert.equal(afterSwitch.splitPercent, 61)
assert.equal(afterSwitch.aiOpen, true)
assert.equal(afterSwitch.notice, '已保存')
assert.equal(afterSwitch.creating, true)
assert.deepEqual(panelReducer(initialPanelState, { type: 'reset-workspace' }), initialPanelState)
assert.deepEqual(
  Object.keys(initialPanelState).filter((key) => !WORKSPACE_SCOPED_KEYS.includes(key as never)).sort(),
  Object.keys(afterSwitch).filter((key) => !WORKSPACE_SCOPED_KEYS.includes(key as never)).sort(),
)
})
