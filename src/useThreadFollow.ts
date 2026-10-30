/**
 * Conversation → panel synchronisation.
 *
 * One poll owns the whole "follow what the conversation is doing" loop: it keeps
 * the thread tab list in step with the tool-side record, applies focus and
 * playback hints, mirrors AI proposals and git impact, and decides when a new
 * active diagram should take over the editor.
 *
 * The decision itself is the pure `decideThreadFollow`; this hook only owns the
 * timers, the refs and the side effects. Callers hand it the session and the few
 * panel callbacks it needs, so `DiagramWorkspace` no longer carries twenty
 * follow-specific dependencies inline.
 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { DocumentSession } from './useDocumentSession.js'
import { decideThreadFollow } from './threadFollow.js'
import { planThreadTabs } from './threadTabPlan.js'
import type {
  DiagramGitImpactResult,
  DiagramListResult,
  DiagramProposalBranchSet,
  DiagramProposalSourceResult,
  DiagramProposalSummary,
  DiagramThreadStateResult,
} from './reviewTypes.js'
import type { DiagramDocument, WorkspaceSnapshot } from './types.js'

export interface ThreadFocus {
  ids: string[]
  key: string
  trace?: DiagramThreadStateResult['trace']
}

export interface AiProposalState {
  summary: DiagramProposalSummary
  before: DiagramDocument
  after: DiagramDocument
}

export interface ThreadFollowDeps {
  /** The panel is showing a conversation-bound diagram surface. */
  threadSurface: boolean
  /** The panel is actually on screen; background tabs must not poll. */
  panelVisible: boolean
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  session: DocumentSession
  proposal: AiProposalState | null
  impact: DiagramGitImpactResult | null
  followConversation: boolean
  /** Panel opened fresh: the first poll must not jump to a historical diagram. */
  initialSkipRestored: boolean
  callTool: <T>(name: string, arguments_: Record<string, unknown>) => Promise<T>
  selectDiagram: (path: string, keep?: boolean) => Promise<void>
  setThreadTabs: Dispatch<SetStateAction<string[]>>
  setAiProposal: Dispatch<SetStateAction<AiProposalState | null>>
  setProposalBranchSet: Dispatch<SetStateAction<DiagramProposalBranchSet | null>>
  setProposalReviewOpen: Dispatch<SetStateAction<boolean>>
  setGitImpactReport: Dispatch<SetStateAction<DiagramGitImpactResult | null>>
  setGitImpactOpen: Dispatch<SetStateAction<boolean>>
  setNotice: Dispatch<SetStateAction<string | null>>
  setFollowPaused: Dispatch<SetStateAction<boolean>>
  setCanvasFocus: Dispatch<SetStateAction<ThreadFocus | null>>
  onSyncSucceeded: () => void
  onSyncFailed: () => void
}

export interface ThreadFollowHandle {
  /** Drop every cursor so the next poll re-baselines against the new workspace. */
  resetTracking: () => void
  /** Diagram activity the poll deferred until the document it touched is open. */
  pendingActivity: React.RefObject<DiagramThreadStateResult['activity'] | undefined>
}

export function useThreadFollow(deps: ThreadFollowDeps): ThreadFollowHandle {
  const {
    threadSurface,
    panelVisible,
    workspacePath,
    snapshot,
    onSnapshot,
    session,
    proposal,
    impact,
    followConversation,
    callTool,
    selectDiagram,
    setThreadTabs,
    setAiProposal,
    setProposalBranchSet,
    setProposalReviewOpen,
    setGitImpactReport,
    setGitImpactOpen,
    setNotice,
    setFollowPaused,
    setCanvasFocus,
    onSyncSucceeded,
    onSyncFailed,
  } = deps

  const lastThreadStateAt = useRef<string | undefined>(undefined)
  const followPauseNotice = useRef<string | undefined>(undefined)
  const threadTickRef = useRef<(() => void) | null>(null)
  const lastPlaybackActivity = useRef<string | undefined>(undefined)
  const pendingActivity = useRef<DiagramThreadStateResult['activity'] | undefined>(undefined)
  const threadStateInitialized = useRef(false)
  const skipRestored = useRef(deps.initialSkipRestored)
  const previousFollowConversation = useRef(followConversation)
  // `fresh` only protects against restoring a diagram that existed *before* the
  // panel was opened. Activity newer than this instant belongs to the current
  // conversation turn and must follow, even if the very first poll already sees
  // a non-empty thread state.
  const panelOpenedAt = useRef(Date.now())

  useEffect(() => {
    if (panelVisible) panelOpenedAt.current = Date.now()
  }, [panelVisible])

  const { dirty, document: selected, setSelected, setSource } = session

  const resetTracking = () => {
    pendingActivity.current = undefined
    lastPlaybackActivity.current = undefined
    lastThreadStateAt.current = undefined
    threadStateInitialized.current = false
    followPauseNotice.current = undefined
  }

  // Turning 跟随 back on is a user request to catch up with the current diagram.
  // The poll may have already consumed the latest revision while following was
  // off, so drop the cursor and let the next tick re-evaluate it immediately.
  useEffect(() => {
    if (followConversation && !previousFollowConversation.current) {
      lastThreadStateAt.current = undefined
      skipRestored.current = false
      // The polling effect below starts immediately with the new enabled value.
      // Calling the previous tick here runs its stale "disabled" closure and
      // can consume the revision before the enabled poll gets a chance.
    }
    previousFollowConversation.current = followConversation
  }, [followConversation])

  // `callTool` / `selectDiagram` are plain functions from the parent, so their identity
  // changes on every render. Reading them through a ref keeps the poll interval stable
  // instead of tearing it down (and immediately re-polling) on every parent render.
  const latestCallbacks = useRef({ callTool, selectDiagram })
  latestCallbacks.current = { callTool, selectDiagram }

  useEffect(() => {
    if (!threadSurface || !panelVisible) return
    const { callTool, selectDiagram } = latestCallbacks.current
    let disposed = false
    let inFlight = false
    const tick = () => {
      if (disposed || inFlight) return
      inFlight = true
      void callTool<DiagramThreadStateResult>('diagram.threadState', {})
        .then(async (state) => {
          onSyncSucceeded()
          if (disposed) return
          if (state.diagramPaths) {
            const plan = planThreadTabs(state.diagramPaths, snapshot.diagrams.map((diagram) => diagram.path))
            if (plan.complete) {
              setThreadTabs(plan.tabs)
            } else {
              // 对话状态里出现了当前快照还没收录的新图：先刷新列表，避免新图被过期快照过滤掉。
              const listed = await callTool<DiagramListResult>('diagram.list', { workspacePath }).catch(() => null)
              if (disposed) return
              if (listed) {
                const fresh = new Set(listed.diagrams.map((diagram) => diagram.path))
                onSnapshot({ ...snapshot, surface: 'thread', diagrams: listed.diagrams, activeDiagramPath: snapshot.activeDiagramPath })
                setThreadTabs(state.diagramPaths.filter((path) => fresh.has(path)))
              } else {
                setThreadTabs(plan.tabs)
              }
            }
          }
          const threadUpdatedAt = state.updatedAt
          if (!threadUpdatedAt) {
            // A freshly opened panel with no diagram activity has nothing to restore.
            // Keeping `skipRestored` armed would swallow the first diagram created
            // afterwards and look exactly like "跟随没有生效".
            skipRestored.current = false
            return
          }
          const threadUpdatedAtMs = Date.parse(threadUpdatedAt)
          const liveThreadActivity = Number.isNaN(threadUpdatedAtMs) || threadUpdatedAtMs >= panelOpenedAt.current - 1_500
          if (skipRestored.current && liveThreadActivity) {
            // Activity is newer than the panel mount: it is the live turn, not
            // a historical selection to restore. Drop the guard before deciding.
            skipRestored.current = false
          }
          const follow = decideThreadFollow({
            updatedAt: threadUpdatedAt,
            lastUpdatedAt: lastThreadStateAt.current,
            proposalRevision: state.proposal?.revision,
            knownProposalRevision: proposal?.summary.revision,
            skipRestored: skipRestored.current,
            followEnabled: followConversation,
            dirty,
            activePath: state.activeDiagramPath,
            selectedPath: selected?.path,
          })
          if (follow.kind === 'ignore' || !threadUpdatedAt) return
          if (!threadStateInitialized.current) {
            threadStateInitialized.current = true
            lastPlaybackActivity.current = state.activity?.key
            // The first meaningful activity after a fresh mount is still the live
            // turn when its revision is newer than the panel. Keep it for playback
            // so the canvas animates in instead of appearing without context.
            if (liveThreadActivity && state.activity && state.activity.kind !== 'proposal' && state.activity.kind !== 'history-undo') {
              pendingActivity.current = state.activity
            }
          } else if (state.activity?.key && state.activity.key !== lastPlaybackActivity.current) {
            lastPlaybackActivity.current = state.activity.key
            const alreadyAppliedProposal = (state.activity.kind === 'proposal' || state.activity.kind === 'history-undo')
              && state.activity.path === selected?.path
              && Boolean(state.activity.modifiedAt)
              && state.activity.modifiedAt === selected?.modifiedAt
            pendingActivity.current = alreadyAppliedProposal ? undefined : state.activity
          }
          if (state.proposal && state.proposal.revision !== proposal?.summary.revision) {
            try {
              const source = await callTool<DiagramProposalSourceResult>('diagram.proposal', {})
              if (!disposed) {
                const after: DiagramDocument = {
                  ...source.before,
                  source: source.candidateSource,
                }
                setAiProposal({ summary: source.proposal, before: source.before, after })
                setProposalBranchSet(source.branchSet ?? null)
                setProposalReviewOpen(true)
                setNotice(source.proposal.patchSummary
                  ? `AI 提交增量候选：${source.proposal.patchSummary.updated} 修改 · ${source.proposal.patchSummary.added} 新增 · ${source.proposal.patchSummary.removed} 删除`
                  : 'AI 提交了一版候选修改，文件尚未写入')
              }
            } catch {
              // Proposal sync is best-effort; normal thread following can continue.
            }
          } else if (!state.proposal && proposal) {
            setAiProposal(null)
            setProposalBranchSet(null)
            setProposalReviewOpen(false)
          }
          if (state.gitImpact && state.gitImpact.updatedAt !== impact?.updatedAt) {
            try {
              const report = await callTool<DiagramGitImpactResult>('diagram.gitImpact', {})
              if (!disposed) {
                setGitImpactReport(report)
                setGitImpactOpen(false)
                setNotice(`AI 已分析代码影响：${report.git.files.length} 个改动文件 · ${report.directElementIds.length} 个直接节点 · ${Math.max(0, report.trace.nodeIds.length - report.directElementIds.length)} 个间接节点`)
              }
            } catch {
              // Git impact sync is best-effort; graph following can continue.
            }
          }
          if (follow.kind === 'skip') {
            skipRestored.current = false
            lastThreadStateAt.current = threadUpdatedAt
            return
          }
          if (follow.kind === 'user-paused') {
            // 用户主动暂停跟随：消费掉当前 revision，恢复跟随时不补跳历史图表。
            lastThreadStateAt.current = threadUpdatedAt
            setFollowPaused(false)
            return
          }
          if (follow.kind === 'dirty-paused') {
            // 有未保存修改时只暂停切换：不消费 updatedAt，保存或撤销后自动补上这次跟随。
            if (followPauseNotice.current !== threadUpdatedAt) {
              followPauseNotice.current = threadUpdatedAt
              setFollowPaused(true)
              setNotice('有未保存修改，已暂停跟随；保存或撤销后自动继续')
            }
            return
          }
          followPauseNotice.current = undefined
          setFollowPaused(false)
          if (follow.kind === 'no-active') {
            const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            const remaining = result.diagrams
            onSnapshot({ ...snapshot, surface: 'thread', diagrams: remaining, activeDiagramPath: undefined })
            lastThreadStateAt.current = threadUpdatedAt
            if (selected && !remaining.some((diagram) => diagram.path === selected.path)) {
              setSelected(null)
              setSource('')
              if (remaining[0]) await selectDiagram(remaining[0].path, true)
              if (!disposed) setNotice('当前图已从对话中删除，已切换到可用图表')
            }
            return
          }
          if (follow.kind === 'focus') {
            const pending = pendingActivity.current
            if (pending && selected && pending.path === selected.path && pending.modifiedAt && pending.modifiedAt === selected.modifiedAt) {
              pendingActivity.current = undefined
            }
            lastThreadStateAt.current = threadUpdatedAt
            setCanvasFocus(state.focusElementIds?.length ? { ids: state.focusElementIds, key: threadUpdatedAt, trace: state.trace } : null)
            if (state.focusElementIds?.length) {
              setNotice(state.proposal?.patchSummary
                ? `增量候选影响 ${state.focusElementIds.length} 个节点${state.proposal.automaticElementIds?.length ? ` · ${state.proposal.automaticElementIds.length} 个自动变化` : ''}`
                : state.trace
                  ? `已追踪${state.trace.direction === 'upstream' ? '上游' : state.trace.direction === 'downstream' ? '下游' : '双向邻域'} ${state.trace.depth} 跳 · ${state.focusElementIds.length} 个节点`
                  : `已定位 ${state.focusElementIds.length} 个源码关联节点`)
            }
            return
          }
          const nextPath = follow.path
          let diagrams = snapshot.diagrams
          if (!diagrams.some((diagram) => diagram.path === nextPath)) {
            const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            diagrams = result.diagrams
            onSnapshot({ ...snapshot, surface: 'thread', diagrams, activeDiagramPath: nextPath })
          }
          if (diagrams.some((diagram) => diagram.path === nextPath)) {
            await selectDiagram(nextPath, true)
            lastThreadStateAt.current = threadUpdatedAt
            setCanvasFocus(state.focusElementIds?.length ? { ids: state.focusElementIds, key: threadUpdatedAt, trace: state.trace } : null)
            if (!disposed) setNotice(state.focusElementIds?.length
              ? state.proposal?.patchSummary
                ? `已切换到增量候选影响范围 · ${state.focusElementIds.length} 个节点`
                : state.trace
                  ? `已切换并追踪${state.trace.direction === 'upstream' ? '上游' : state.trace.direction === 'downstream' ? '下游' : '双向邻域'} ${state.trace.depth} 跳`
                  : `已切换并定位 ${state.focusElementIds.length} 个源码关联节点`
              : '已跟随当前对话中的图表')
          }
        })
        .catch(() => {
          if (!disposed) onSyncFailed()
        })
        .finally(() => { inFlight = false })
    }
    threadTickRef.current = tick
    tick()
    const handle = window.setInterval(tick, 1_300)
    return () => {
      disposed = true
      if (threadTickRef.current === tick) threadTickRef.current = null
      window.clearInterval(handle)
    }
    // Re-subscribe whenever an input of the poll changes; the immediate tick()
    // above then re-baselines against the new state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadSurface, panelVisible, workspacePath, followConversation, dirty, selected?.path, selected?.modifiedAt, proposal?.summary.revision, impact?.updatedAt, snapshot, onSnapshot])

  useEffect(() => {
    if (!panelVisible) return
    // 面板从后台回到前台时立即补一次轮询，不必等下一个 1.3s 间隔。
    threadTickRef.current?.()
  }, [panelVisible])

  return { resetTracking, pendingActivity }
}
