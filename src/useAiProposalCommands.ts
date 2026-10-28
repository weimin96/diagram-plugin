import { parseCanvasScene } from './canvas.js'
import { errorMessage } from './errors.js'
import { callTool } from './hostRuntime.js'
import type { CanvasPlaybackRequest } from './CanvasEditor.js'
import type { DiagramDocument, WorkspaceSnapshot } from './types.js'
import type { DiagramProposalBranchSet, DiagramProposalRefreshResult, DiagramProposalSourceResult, DiagramResult } from './reviewTypes.js'
import type { AiProposalState, ThreadFocus } from './useThreadFollow.js'

export interface AiProposalCommandsDeps {
  threadSurface: boolean
  workspacePath: string
  aiProposal: AiProposalState | null
  proposalBranchSet: DiagramProposalBranchSet | null
  saving: boolean
  dirty: boolean
  externalChange: boolean
  selected: DiagramDocument | null
  source: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  adoptSynced: (document: DiagramDocument) => void
  patchHistoryOpen: boolean
  loadPatchHistory: (path: string) => Promise<void>
  setAiProposal: (proposal: AiProposalState | null) => void
  setProposalBranchSet: (set: DiagramProposalBranchSet | null) => void
  setProposalReviewOpen: (open: boolean) => void
  setSelected: (document: DiagramDocument | null) => void
  setSource: (source: string) => void
  setExternalChange: (changed: boolean) => void
  setCanvasFocus: (focus: ThreadFocus | null) => void
  setCanvasPlayback: (request: CanvasPlaybackRequest | null) => void
  setSaving: (value: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
}

export interface AiProposalCommands {
  acceptAiProposal: (elementIds?: string[]) => Promise<void>
  dismissAiProposal: () => Promise<void>
  selectProposalBranch: (branchId: string) => Promise<void>
  composeProposalBranches: (branchIds: string[]) => Promise<void>
}

/** Reviewing and applying an AI candidate: accept, reject, switch branch, compose branches. */
export function useAiProposalCommands(deps: AiProposalCommandsDeps): AiProposalCommands {
  const {
    threadSurface,
    workspacePath,
    aiProposal,
    proposalBranchSet,
    saving,
    dirty,
    externalChange,
    selected,
    source,
    snapshot,
    onSnapshot,
    adoptSynced,
    patchHistoryOpen,
    loadPatchHistory,
    setAiProposal,
    setProposalBranchSet,
    setProposalReviewOpen,
    setSelected,
    setSource,
    setExternalChange,
    setCanvasFocus,
    setCanvasPlayback,
    setSaving,
    setError,
    setNotice,
  } = deps

  async function acceptAiProposal(elementIds?: string[]) {
    if (!aiProposal || saving) return
    if (dirty && !aiProposal.summary.rebaseable) {
      setError('当前还有未保存的手工修改。整图 Proposal 不能安全合并本地草稿，请先保存或放弃这些修改。')
      return
    }
    if (dirty && externalChange) {
      setError('当前画布同时存在未保存修改和外部更新，请先处理外部冲突。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (dirty) {
        if (!selected || selected.path !== aiProposal.before.path) throw new Error('当前本地草稿与待应用 Proposal 不属于同一张图。')
        const savedDraft = await callTool<DiagramResult>('diagram.update', {
          workspacePath,
          path: selected.path,
          source,
          expectedModifiedAt: selected.modifiedAt,
          animate: false,
        })
        adoptSynced(savedDraft.diagram)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === savedDraft.diagram.path ? savedDraft.diagram : item),
        })
      }
      const result = await callTool<DiagramResult | DiagramProposalRefreshResult>('diagram.applyProposal', {
        expectedProposalRevision: aiProposal.summary.revision,
        ...(elementIds?.length ? { elementIds } : {}),
      })
      if (result.kind === 'diagram-proposal-refresh') {
        const after: DiagramDocument = { ...result.before, source: result.candidateSource }
        setAiProposal({ summary: result.proposal, before: result.before, after })
        setProposalBranchSet(null)
        setProposalReviewOpen(true)
        setSelected(result.before)
        setSource(result.before.source)
        setExternalChange(false)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === result.before.path ? result.before : item),
        })
        setNotice(`画布期间发生并发修改，候选已安全重算；${result.reviewElementIds.length} 个自动结果发生变化，请重新审查`)
        return
      }
      if (threadSurface && aiProposal.before.type === 'canvas' && result.diagram.type === 'canvas' && aiProposal.before.path === result.diagram.path) {
        setCanvasPlayback({
          key: `proposal:${result.diagram.path}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: result.proposalApply?.beforeSource ?? aiProposal.before.source,
          label: 'AI 正在应用候选修改',
        })
      }
      adoptSynced(result.diagram)
      setAiProposal(null)
      setProposalBranchSet(null)
      setProposalReviewOpen(false)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      if (patchHistoryOpen && result.proposalApply?.historyRecorded) void loadPatchHistory(result.diagram.path)
      const historyWarning = result.proposalApply?.historyEntryId && result.proposalApply.historyRecorded === false ? '；但本地历史记录写入失败' : ''
      setNotice(`${result.proposalApply?.rebased ? '已接受 AI 候选修改，并安全合并期间的其它画布改动' : '已接受 AI 候选修改'}${historyWarning}`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function dismissAiProposal() {
    if (!aiProposal) return
    setError(null)
    try {
      await callTool<{ kind: 'diagram-proposal-dismissed' }>('diagram.dismissProposal', { expectedProposalRevision: aiProposal.summary.revision })
      setAiProposal(null)
      setProposalBranchSet(null)
      setProposalReviewOpen(false)
      setNotice('已拒绝 AI 候选修改，当前文件未改变')
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function selectProposalBranch(branchId: string) {
    if (!aiProposal || saving || proposalBranchSet?.activeBranchId === branchId) return
    setSaving(true)
    setError(null)
    try {
      const result = await callTool<DiagramProposalSourceResult>('diagram.selectProposalBranch', { branchId })
      const after: DiagramDocument = { ...result.before, source: result.candidateSource }
      setAiProposal({ summary: result.proposal, before: result.before, after })
      setProposalBranchSet(result.branchSet ?? null)
      setProposalReviewOpen(true)
      if (result.proposal.impactElementIds?.length && result.before.type === 'canvas') {
        const candidate = parseCanvasScene(result.candidateSource)
        const nodeIds = new Set(candidate.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.proposal.impactElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `proposal-branch:${branchId}:${Date.now()}` })
      }
      setNotice(`已切换到候选 ${result.proposal.branchLabel ?? '方案'}`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function composeProposalBranches(branchIds: string[]) {
    if (!aiProposal || saving || branchIds.length < 2) return
    setSaving(true)
    setError(null)
    try {
      const result = await callTool<DiagramProposalSourceResult>('diagram.composeProposalBranches', {
        branchIds,
        branchLabel: '组合方案',
      })
      const after: DiagramDocument = { ...result.before, source: result.candidateSource }
      setAiProposal({ summary: result.proposal, before: result.before, after })
      setProposalBranchSet(result.branchSet ?? null)
      setProposalReviewOpen(true)
      if (result.proposal.impactElementIds?.length && result.before.type === 'canvas') {
        const candidate = parseCanvasScene(result.candidateSource)
        const nodeIds = new Set(candidate.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.proposal.impactElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `proposal-compose:${Date.now()}` })
      }
      setNotice(`已生成组合候选 · ${branchIds.length} 个 Patch 合并`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }
  return { acceptAiProposal, dismissAiProposal, selectProposalBranch, composeProposalBranches }
}
