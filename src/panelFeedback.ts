/**
 * Panel feedback arbitration.
 *
 * The panel used to stack up to seven independent banners (error, conflict,
 * sync, proposal, git impact, notice). In a 420px companion panel that pushes
 * the document itself out of view, and several of them could describe the same
 * failure. Feedback is therefore resolved into a single primary banner plus a
 * bounded overflow list, ordered by how much the message blocks real work.
 */

export type FeedbackSeverity = 'error' | 'warning' | 'info'

export type FeedbackActionId =
  | 'dismiss-error'
  | 'restore-file'
  | 'reload-file'
  | 'review-changes'
  | 'review-proposal'
  | 'accept-proposal'
  | 'reject-proposal'
  | 'review-impact'
  | 'clear-impact'

export interface FeedbackAction {
  id: FeedbackActionId
  label: string
  primary?: boolean
  disabled?: boolean
}

export interface PanelFeedback {
  id: string
  severity: FeedbackSeverity
  title: string
  detail?: string
  actions: FeedbackAction[]
}

export interface FeedbackInput {
  surface: 'thread' | 'workspace'
  error?: string | null
  aiOpen?: boolean
  syncIssue?: string | null
  externalDeleted?: boolean
  externalChange?: boolean
  notice?: string | null
  changeReview?: boolean
  proposal?: { title: string; detail: string; branchCount: number } | null
  impact?: { files: number; direct: number; indirect: number } | null
  saving?: boolean
}

export interface FeedbackState {
  primary?: PanelFeedback
  overflow: PanelFeedback[]
}

/** Blocking failures first, then file conflicts, degraded sync, pending decisions, context, transient notices. */
export function panelFeedback(input: FeedbackInput): FeedbackState {
  const candidates = [
    errorFeedback(input),
    conflictFeedback(input),
    syncFeedback(input),
    proposalFeedback(input),
    impactFeedback(input),
    noticeFeedback(input),
  ].filter((feedback): feedback is PanelFeedback => Boolean(feedback))

  const [primary, ...overflow] = candidates
  return primary ? { primary, overflow } : { overflow: [] }
}

function errorFeedback(input: FeedbackInput): PanelFeedback | undefined {
  // A failure raised while the AI composer is open already renders inside that panel.
  if (!input.error || input.aiOpen) return undefined
  return {
    id: 'error',
    severity: 'error',
    title: input.error,
    actions: [{ id: 'dismiss-error', label: '关闭' }],
  }
}

function conflictFeedback(input: FeedbackInput): PanelFeedback | undefined {
  if (input.externalDeleted) {
    return {
      id: 'external-deleted',
      severity: 'warning',
      title: '原文件已删除，草稿已保留',
      actions: [{ id: 'restore-file', label: '恢复文件', primary: true, disabled: input.saving }],
    }
  }
  if (input.externalChange) {
    return {
      id: 'external-change',
      severity: 'warning',
      title: '文件已在外部修改',
      actions: [{ id: 'reload-file', label: '重新载入' }],
    }
  }
  return undefined
}

function syncFeedback(input: FeedbackInput): PanelFeedback | undefined {
  if (input.surface !== 'thread' || !input.syncIssue) return undefined
  return { id: 'sync-issue', severity: 'info', title: input.syncIssue, detail: '不会影响当前图查看与编辑', actions: [] }
}

function proposalFeedback(input: FeedbackInput): PanelFeedback | undefined {
  const proposal = input.proposal
  if (!proposal) return undefined
  const multiBranch = proposal.branchCount > 1
  return {
    id: 'proposal',
    severity: 'info',
    title: proposal.title,
    detail: proposal.detail,
    actions: [
      { id: 'review-proposal', label: '查看' },
      { id: 'reject-proposal', label: multiBranch ? '拒绝全部' : '拒绝' },
      { id: 'accept-proposal', label: multiBranch ? '接受当前' : '接受', primary: true, disabled: input.saving },
    ],
  }
}

function impactFeedback(input: FeedbackInput): PanelFeedback | undefined {
  const impact = input.impact
  if (!impact) return undefined
  return {
    id: 'impact',
    severity: 'info',
    title: '代码改动影响',
    detail: `${impact.files} 个文件 · ${impact.direct} 个直接节点 · ${impact.indirect} 个间接节点`,
    actions: [
      { id: 'review-impact', label: '查看' },
      { id: 'clear-impact', label: '清除' },
    ],
  }
}

function noticeFeedback(input: FeedbackInput): PanelFeedback | undefined {
  if (!input.notice) return undefined
  return {
    id: 'notice',
    severity: 'info',
    title: input.notice,
    actions: input.changeReview ? [{ id: 'review-changes', label: '查看变更' }] : [],
  }
}

/**
 * Turning live panel state into banner copy.
 *
 * The proposal title/detail rules (branch count, patch summary, scope, reason) used
 * to live inline in the panel component, where they were unreachable by tests and
 * drifted between call sites. They belong next to the arbitration that ranks them.
 */
export interface PanelFeedbackStateInput {
  surface: 'thread' | 'workspace'
  error?: string | null
  aiOpen?: boolean
  syncIssue?: string | null
  externalDeleted?: boolean
  externalChange?: boolean
  notice?: string | null
  changeReview?: boolean
  saving?: boolean
  proposal?: {
    summary: {
      reason?: string
      branchLabel?: string
      scopeElementIds?: string[]
      automaticElementIds?: string[]
      patchSummary?: { updated: number; added: number; removed: number }
    }
  } | null
  proposalBranchCount?: number
  impact?: {
    git: { files: unknown[] }
    directElementIds: unknown[]
    trace: { nodeIds: unknown[] }
  } | null
}

export function panelFeedbackFromState(state: PanelFeedbackStateInput): FeedbackState {
  return panelFeedback({
    surface: state.surface,
    error: state.error,
    aiOpen: state.aiOpen,
    syncIssue: state.syncIssue,
    externalDeleted: state.externalDeleted,
    externalChange: state.externalChange,
    notice: state.notice,
    changeReview: state.changeReview,
    saving: state.saving,
    proposal: state.proposal ? proposalBanner(state.proposal.summary, state.proposalBranchCount ?? 0) : null,
    impact: state.impact
      ? {
          files: state.impact.git.files.length,
          direct: state.impact.directElementIds.length,
          indirect: Math.max(0, state.impact.trace.nodeIds.length - state.impact.directElementIds.length),
        }
      : null,
  })
}

/** Branch count wins over patch shape; a pending proposal always says why it is pending. */
export function proposalBanner(
  summary: NonNullable<PanelFeedbackStateInput['proposal']>['summary'],
  branchCount: number,
): { title: string; detail: string; branchCount: number } {
  const patch = summary.patchSummary
  const title = branchCount > 1
    ? `AI 候选分支 · ${branchCount}`
    : patch
      ? 'AI 增量候选修改'
      : summary.scopeElementIds?.length
        ? 'AI 子图候选修改'
        : 'AI 候选修改'
  const detail = patch
    ? `${summary.branchLabel ? `${summary.branchLabel} · ` : ''}${patch.updated} 修改 · ${patch.added} 新增 · ${patch.removed} 删除${summary.automaticElementIds?.length ? ` · ${summary.automaticElementIds.length} 自动影响` : ''}`
    : summary.reason || '尚未写入文件，先查看 Diff 再决定。'
  return { title, detail, branchCount }
}
