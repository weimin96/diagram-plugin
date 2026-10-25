import { fitMermaidSvgToContent } from './mermaidSvg.js'
import { diagramVisualStyles } from './diagramVisualStyles.js'
import React, { Component, type CSSProperties, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PatchHistoryPanel, GitImpactPanel, ChangeReviewPanel, ProposalReviewPanel } from './ReviewPanels.js'
import type { DiagramProposalSummary, DiagramPatchHistoryEntry, DiagramGitImpactResult } from './reviewTypes.js'
import mermaid from 'mermaid'
import { createMermaidRenderQueue } from './mermaidRenderQueue.js'
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps'
import { createCodexHost } from './hosts/codex.js'
import { createDeepSeekHost } from './hosts/deepseek.js'
import type { HostContext } from './hosts/types.js'
import { ChevronDownIcon, FolderOpenIcon, MoreHorizontalIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { AiPanel } from './AiPanel.js'
import { buildGenerationPrompt, buildModificationPrompt, buildSubgraphModificationPrompt, type DiagramGenerationRequest } from './aiPrompts.js'
import { CanvasEditor, type CanvasPlaybackRequest, type CanvasSelection } from './CanvasEditor.js'
import { canvasSceneToSvg, parseCanvasScene, type CanvasWorkbenchMode } from './canvas.js'
import { normalizeMermaidColor } from './colors.js'
import { MermaidEditor } from './MermaidEditor.js'
import { assessMermaidVisualQuality } from './mermaidQuality.js'
import { mermaidVisualConfig, normalizeMermaidSourceForRender, resolveMermaidVisualStyle, setMermaidVisualStyle, type MermaidVisualStyle } from './mermaidVisualGrammar.js'
import { createTemplate, detectDiagramType } from './templates.js'
import { extractToolResultError, extractToolResultPayload, type ToolResultLike } from './toolResult.js'
import { diagramTypeGroups, diagramTypes, type DiagramDocument, type DiagramRevision, type DiagramSummary, type DiagramSurface, type DiagramType, type MermaidDiagramType, type WorkspaceSnapshot } from './types.js'
import { IconButton } from '@/components/diagram/icon-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'

declare const __DIAGRAM_PLUGIN_VERSION__: string

interface ServerToolResult extends ToolResultLike {}

interface DiagramResult {
  kind: 'diagram'
  workspacePath: string
  diagram: DiagramDocument
  proposalApply?: { rebased: boolean; beforeSource?: string; historyEntryId?: string; historyRecorded?: boolean }
}

interface DiagramListResult {
  kind: 'diagram-list'
  workspacePath: string
  diagrams: DiagramSummary[]
}

interface DiagramRevisionResult {
  kind: 'diagram-revision'
  workspacePath: string
  revision: DiagramRevision
}

interface SourceFilesResult {
  kind: 'source-files'
  workspacePath: string
  files: string[]
}

interface DiagramDeletedResult {
  kind: 'diagram-deleted'
  workspacePath: string
  path: string
}

interface DiagramExportResult {
  kind: 'diagram-export'
  workspacePath: string
  path: string
}

interface DiagramImageAssetResult {
  kind: 'diagram-image-asset'
  workspacePath: string
  path: string
  mimeType: string
}

interface DiagramImageAssetContentResult {
  kind: 'diagram-image-asset-content'
  workspacePath: string
  path: string
  mimeType: string
  content: string
}

interface DiagramThreadStateResult {
  kind: 'diagram-thread-state'
  activeDiagramPath?: string
  diagramPaths?: string[]
  focusElementIds?: string[]
  trace?: { seedElementIds: string[]; direction: 'upstream' | 'downstream' | 'both'; depth: number }
  activity?: { kind: 'create' | 'update' | 'proposal' | 'source-sync' | 'history-undo' | 'history-redo'; path: string; key: string; modifiedAt?: string }
  proposal?: DiagramProposalSummary
  gitImpact?: { path: string; updatedAt: string; fileCount: number; directCount: number; affectedCount: number; unmatchedCount: number }
  updatedAt?: string
}

interface DiagramProposalBranchSet {
  groupId: string
  activeBranchId: string
  branches: DiagramProposalSummary[]
}

interface DiagramProposalSourceResult {
  kind: 'diagram-proposal-source'
  workspacePath: string
  proposal: DiagramProposalSummary
  before: DiagramDocument
  candidateSource: string
  branchSet?: DiagramProposalBranchSet
}

interface DiagramProposalRefreshResult {
  kind: 'diagram-proposal-refresh'
  workspacePath: string
  proposal: DiagramProposalSummary
  before: DiagramDocument
  candidateSource: string
  reviewElementIds: string[]
}

interface DiagramPatchHistoryChainUndoResult {
  kind: 'diagram-patch-history-chain-undo'
  workspacePath: string
  diagram: DiagramDocument
  rootHistoryId: string
  historyIds: string[]
  revertedElementIds: string[]
}

interface DiagramPatchHistoryChainRedoResult {
  kind: 'diagram-patch-history-chain-redo'
  workspacePath: string
  diagram: DiagramDocument
  rootHistoryId: string
  historyIds: string[]
  reappliedElementIds: string[]
}

interface DiagramPatchHistoryResult {
  kind: 'diagram-patch-history'
  workspacePath: string
  path?: string
  entries: DiagramPatchHistoryEntry[]
}

interface DiagramPatchHistoryUndoResult {
  kind: 'diagram-patch-history-undo'
  workspacePath: string
  diagram: DiagramDocument
  historyId: string
  undoEventId: string
  revertedElementIds: string[]
}

interface DiagramPatchHistoryRedoResult {
  kind: 'diagram-patch-history-redo'
  workspacePath: string
  diagram: DiagramDocument
  historyId: string
  redoEventId: string
  reappliedElementIds: string[]
}

type ViewMode = 'preview' | 'source' | 'split'

const rootElement = document.getElementById('root')!
const host = rootElement.dataset.diagramHost === 'deepseek'
  ? createDeepSeekHost()
  : createCodexHost(__DIAGRAM_PLUGIN_VERSION__)
const hostSurface: DiagramSurface = rootElement.dataset.diagramSurface === 'thread' ? 'thread' : 'workspace'
let initialWorkspace: WorkspaceSnapshot | null = null

host.onToolResult((result) => {
  const content = result.structuredContent as Partial<WorkspaceSnapshot> | undefined
  if (content?.kind === 'workspace') initialWorkspace = content as WorkspaceSnapshot
})

function applyHostContext(context: HostContext) {
  if (context?.theme) applyDocumentTheme(context.theme)
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables)
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts)
  window.dispatchEvent(new Event('diagram-theme-change'))
}

host.onContextChanged(applyHostContext)

renderBootStatus('正在连接 Diagram…')
void main().catch(renderFatalError)

async function main() {
  await host.connect()
  applyHostContext(host.getHostContext())
  const freshThreadOpen = hostSurface === 'thread'
    && (host.getHostContext() as HostContext & { diagramOpenMode?: string }).diagramOpenMode === 'fresh'

  if (!initialWorkspace) {
    const result = await host.callServerTool({ name: hostSurface === 'thread' ? 'diagram.thread' : 'diagram.workspace', arguments: {} }) as ServerToolResult
    const error = extractToolResultError(result)
    if (error) throw new Error(error)
    const content = result.structuredContent as WorkspaceSnapshot | undefined
    if (content?.kind === 'workspace') initialWorkspace = content
  }

  if (initialWorkspace && !initialWorkspace.surface) initialWorkspace = { ...initialWorkspace, surface: hostSurface }
  if (initialWorkspace && freshThreadOpen) initialWorkspace = { ...initialWorkspace, activeDiagramPath: undefined }

  createRoot(rootElement).render(
    <RuntimeErrorBoundary>
      <TooltipProvider>
        <Root initial={initialWorkspace ?? { kind: 'workspace', recentWorkspaces: [], diagrams: [] }} />
      </TooltipProvider>
    </RuntimeErrorBoundary>,
  )
}

function Root({ initial }: { initial: WorkspaceSnapshot }) {
  const [workspace, setWorkspace] = useState(initial)
  const [switching, setSwitching] = useState(!initial.workspacePath)

  if (!workspace.workspacePath || switching) {
    return (
      <WorkspacePicker
        current={workspace}
        onOpen={(next) => {
          setWorkspace({ ...next, surface: workspace.surface ?? hostSurface })
          setSwitching(false)
        }}
      />
    )
  }

  return <DiagramWorkspace snapshot={workspace} onSnapshot={setWorkspace} onSwitch={() => setSwitching(true)} />
}

function useDiagramVisibility(): boolean {
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    let intersects = true
    const update = () => setVisible(document.visibilityState === 'visible' && intersects)
    const observer = new IntersectionObserver(([entry]) => {
      intersects = Boolean(entry?.isIntersecting)
      update()
    })
    observer.observe(rootElement)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return visible
}

function WorkspacePicker({ current, onOpen }: { current: WorkspaceSnapshot; onOpen: (snapshot: WorkspaceSnapshot) => void }) {
  const [workspacePath, setWorkspacePath] = useState(current.workspacePath ?? '')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open(candidate: string) {
    setOpening(true)
    setError(null)
    try {
      const result = await callTool<WorkspaceSnapshot>('diagram.openWorkspace', { workspacePath: candidate })
      if (!result.workspacePath) throw new Error('未能打开工作空间。')
      onOpen(result)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setOpening(false)
    }
  }

  return (
    <main className="workspace-picker-shell">
      <section className="workspace-picker">
        <div>
          <div className="eyebrow">DIAGRAM WORKSPACE</div>
          <h1>打开项目中的图表</h1>
          <p>识别工作空间里的 Mermaid 文件，并让 AI 与可视化编辑器操作同一份源码。</p>
        </div>
        <form
          className="workspace-open-row"
          onSubmit={(event) => {
            event.preventDefault()
            void open(workspacePath)
          }}
        >
          <Input className="flex-1" autoFocus value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} placeholder="/Users/me/project 或 ~/project" />
          <Button disabled={opening || !workspacePath.trim()}>{opening ? '打开中…' : '打开'}</Button>
        </form>
        {error ? <div className="inline-error">{error}</div> : null}
        {current.recentWorkspaces.length > 0 ? (
          <div className="recent-workspaces">
            <div className="section-label">最近工作空间</div>
            {current.recentWorkspaces.map((candidate) => (
              <Button key={candidate} type="button" variant="ghost" className="w-full justify-start truncate" onClick={() => void open(candidate)}>{candidate}</Button>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  )
}

function DiagramWorkspace({ snapshot, onSnapshot, onSwitch }: {
  snapshot: WorkspaceSnapshot
  onSnapshot: React.Dispatch<React.SetStateAction<WorkspaceSnapshot>>
  onSwitch: () => void
}) {
  const workspacePath = snapshot.workspacePath!
  const isThread = (snapshot.surface ?? hostSurface) === 'thread'
  const panelVisible = useDiagramVisibility()
  const [selected, setSelected] = useState<DiagramDocument | null>(null)
  const [source, setSource] = useState('')
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>(() => isThread ? 'preview' : 'split')
  const canvasActive = mode !== 'source' && (!loadingPath || loadingPath === selected?.path)
  const canvasWriteTarget = useRef({ workspacePath, path: selected?.path, active: canvasActive })
  canvasWriteTarget.current = { workspacePath, path: selected?.path, active: canvasActive }
  const [creating, setCreating] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [diagramQuery, setDiagramQuery] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMode, setAiMode] = useState<'generate' | 'modify'>('generate')
  const aiReturnFocus = useRef<HTMLElement | null>(null)
  const threadMoreButton = useRef<HTMLButtonElement>(null)
  const [generationPreset, setGenerationPreset] = useState<{ key: number; scope?: string; title?: string; instructions?: string } | undefined>()
  const [aiSending, setAiSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [deletedDraftPath, setDeletedDraftPath] = useState<string | null>(null)
  const [splitPercent, setSplitPercent] = useState(44)
  const [sourceSearchRequest, setSourceSearchRequest] = useState(0)
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [followConversation, setFollowConversation] = useState(true)
  const [threadTabs, setThreadTabs] = useState<string[]>(() => isThread ? (snapshot.threadDiagramPaths ?? []) : [])
  const [threadDiagramMenuOpen, setThreadDiagramMenuOpen] = useState(false)
  const [threadDiagramQuery, setThreadDiagramQuery] = useState('')
  const [threadDiagramListLoading, setThreadDiagramListLoading] = useState(false)
  const [threadDiagramListError, setThreadDiagramListError] = useState<string | null>(null)
  const [canvasSelection, setCanvasSelection] = useState<CanvasSelection | null>(null)
  const [canvasFocus, setCanvasFocus] = useState<{ ids: string[]; key: string; trace?: DiagramThreadStateResult['trace'] } | null>(null)
  const [canvasPlayback, setCanvasPlayback] = useState<CanvasPlaybackRequest | null>(null)
  const [gitImpactReport, setGitImpactReport] = useState<DiagramGitImpactResult | null>(null)
  const [gitImpactOpen, setGitImpactOpen] = useState(false)
  const [aiProposal, setAiProposal] = useState<{ summary: DiagramProposalSummary; before: DiagramDocument; after: DiagramDocument } | null>(null)
  const [proposalBranchSet, setProposalBranchSet] = useState<DiagramProposalBranchSet | null>(null)
  const [proposalReviewOpen, setProposalReviewOpen] = useState(false)
  const [patchHistoryOpen, setPatchHistoryOpen] = useState(false)
  const [patchHistoryEntries, setPatchHistoryEntries] = useState<DiagramPatchHistoryEntry[]>([])
  const [patchHistoryLoading, setPatchHistoryLoading] = useState(false)
  const [patchHistoryUndoingId, setPatchHistoryUndoingId] = useState<string | null>(null)
  const [patchHistoryRedoingId, setPatchHistoryRedoingId] = useState<string | null>(null)
  const [changeReview, setChangeReview] = useState<{ before: DiagramDocument; after: DiagramDocument } | null>(null)
  const [changeReviewOpen, setChangeReviewOpen] = useState(false)
  const [syncIssue, setSyncIssue] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<
    | { kind: 'diagram'; path: string }
    | { kind: 'workspace' }
    | { kind: 'close-thread'; path: string }
    | { kind: 'new-diagram'; type: DiagramType; title: string; canvasWorkbench?: CanvasWorkbenchMode }
    | null
  >(null)
  const aiWatch = useRef<{ until: number; existingPaths: Set<string> } | null>(null)
  const editorWorkspace = useRef<HTMLDivElement>(null)
  const threadTabsElement = useRef<HTMLDivElement>(null)
  const splitDrag = useRef<{ pointerId: number; left: number; width: number } | null>(null)
  const lastThreadStateAt = useRef<string | undefined>(undefined)
  const lastPlaybackActivity = useRef<string | undefined>(undefined)
  const pendingPlaybackActivity = useRef<DiagramThreadStateResult['activity'] | undefined>(undefined)
  const selectRequestSeq = useRef(0)
  const saveInFlight = useRef(false)
  const patchHistoryRequestSeq = useRef(0)
  const threadStateInitialized = useRef(false)
  const skipRestoredThreadSelection = useRef(isThread
    && (host.getHostContext() as HostContext & { diagramOpenMode?: string }).diagramOpenMode === 'fresh')
  const backgroundFailures = useRef({ thread: 0, revision: 0 })
  useEffect(() => () => { selectRequestSeq.current += 1 }, [])
  const externalDeleted = Boolean(selected && selected.path === deletedDraftPath)
  const dirty = Boolean(selected && (source !== selected.source || externalDeleted))
  useEffect(() => {
    if (isThread && rootElement.dataset.diagramHost === 'deepseek') {
      window.parent.postMessage({ type: 'diagram.unsaved', unsaved: dirty }, '*')
    }
  }, [dirty, isThread])
  const selectedTypeLabel = useMemo(() => selected ? diagramDocumentLabel(selected) : '', [selected])
  const visibleDiagrams = useMemo(() => {
    const query = diagramQuery.trim().toLocaleLowerCase()
    if (!query) return snapshot.diagrams
    return snapshot.diagrams.filter((diagram) => (
      diagram.name.toLocaleLowerCase().includes(query)
      || diagram.path.toLocaleLowerCase().includes(query)
      || diagramSummaryLabel(diagram).toLocaleLowerCase().includes(query)
    ))
  }, [diagramQuery, snapshot.diagrams])
  const threadMenuGroups = useMemo(() => {
    const byPath = new Map(snapshot.diagrams.map((diagram) => [diagram.path, diagram]))
    const recentFirst = (diagrams: DiagramSummary[]) => [...diagrams].sort((left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name))
    const current = threadTabs.flatMap((path) => {
      const diagram = byPath.get(path)
      return diagram ? [diagram] : []
    })
    const currentPaths = new Set(current.map((diagram) => diagram.path))
    const project = recentFirst(snapshot.diagrams.filter((diagram) => !currentPaths.has(diagram.path)))
    const query = threadDiagramQuery.trim().toLocaleLowerCase()
    const matches = (diagram: DiagramSummary) => !query
      || diagram.name.toLocaleLowerCase().includes(query)
      || diagram.path.toLocaleLowerCase().includes(query)
      || diagramSummaryLabel(diagram).toLocaleLowerCase().includes(query)
    return {
      current: recentFirst(current).filter(matches),
      project: project.filter(matches),
      currentTotal: current.length,
      projectTotal: project.length,
    }
  }, [snapshot.diagrams, threadDiagramQuery, threadTabs])

  useEffect(() => {
    const tabs = threadTabsElement.current
    if (!tabs) return
    const revealActive = () => tabs.querySelector('.thread-diagram-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealActive()
    const observer = new ResizeObserver(revealActive)
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [selected?.path, threadTabs.length])

  function backgroundSyncSucceeded(kind: 'thread' | 'revision') {
    backgroundFailures.current[kind] = 0
    if (backgroundFailures.current.thread < 3 && backgroundFailures.current.revision < 3) setSyncIssue(null)
  }

  function backgroundSyncFailed(kind: 'thread' | 'revision') {
    backgroundFailures.current[kind] += 1
    if (backgroundFailures.current[kind] < 3) return
    setSyncIssue(kind === 'thread' ? '对话联动正在重试' : '文件同步正在重试')
  }

  useEffect(() => {
    selectRequestSeq.current += 1
    patchHistoryRequestSeq.current += 1
    setSelected(null)
    setDeletedDraftPath(null)
    const availablePaths = new Set(snapshot.diagrams.map((diagram) => diagram.path))
    setThreadTabs(isThread ? (snapshot.threadDiagramPaths ?? []).filter((path) => availablePaths.has(path)) : [])
    setThreadDiagramMenuOpen(false)
    setThreadDiagramQuery('')
    setThreadDiagramListError(null)
    setCanvasSelection(null)
    setCanvasFocus(null)
    setCanvasPlayback(null)
    pendingPlaybackActivity.current = undefined
    lastPlaybackActivity.current = undefined
    lastThreadStateAt.current = undefined
    threadStateInitialized.current = false
    setGitImpactReport(null)
    setGitImpactOpen(false)
    setAiProposal(null)
    setProposalBranchSet(null)
    setProposalReviewOpen(false)
    setPatchHistoryOpen(false)
    setPatchHistoryEntries([])
    setPatchHistoryLoading(false)
    setPatchHistoryUndoingId(null)
    setChangeReview(null)
    setChangeReviewOpen(false)
    setSource('')
    setExternalChange(false)
    setDocumentMenuOpen(false)
    setRenaming(false)
    setDeleteConfirmOpen(false)
    setDiscardTarget(null)
    const initialDiagram = snapshot.activeDiagramPath
      ? snapshot.diagrams.find((diagram) => diagram.path === snapshot.activeDiagramPath)
      : undefined
    if (initialDiagram) {
      void selectDiagram(initialDiagram.path, true)
    } else if (!isThread && snapshot.diagrams[0]) {
      void selectDiagram(snapshot.diagrams[0].path, true)
    }
    // Workspace changes intentionally discard selection from the previous project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  useEffect(() => {
    if (!isThread) return
    const available = new Set(snapshot.diagrams.map((diagram) => diagram.path))
    setThreadTabs((current) => current.filter((path) => available.has(path)))
  }, [isThread, snapshot.diagrams])

  useEffect(() => {
    if (!selected || selected.type !== 'canvas') {
      if (canvasSelection) setCanvasSelection(null)
    }
  }, [canvasSelection, selected])

  useEffect(() => {
    if (!isThread || !panelVisible) return
    let disposed = false
    let inFlight = false
    const handle = window.setInterval(() => {
      if (disposed || inFlight || dirty) return
      inFlight = true
      void callTool<DiagramThreadStateResult>('diagram.threadState', {})
        .then(async (state) => {
          backgroundSyncSucceeded('thread')
          if (disposed) return
          if (state.diagramPaths) {
            const available = new Set(snapshot.diagrams.map((diagram) => diagram.path))
            setThreadTabs(state.diagramPaths.filter((path) => available.has(path)))
          }
          if (!state.updatedAt || (state.updatedAt === lastThreadStateAt.current && state.proposal?.revision === aiProposal?.summary.revision)) return
          if (!threadStateInitialized.current) {
            threadStateInitialized.current = true
            lastPlaybackActivity.current = state.activity?.key
          } else if (state.activity?.key && state.activity.key !== lastPlaybackActivity.current) {
            lastPlaybackActivity.current = state.activity.key
            const alreadyAppliedProposal = (state.activity.kind === 'proposal' || state.activity.kind === 'history-undo')
              && state.activity.path === selected?.path
              && Boolean(state.activity.modifiedAt)
              && state.activity.modifiedAt === selected?.modifiedAt
            pendingPlaybackActivity.current = alreadyAppliedProposal ? undefined : state.activity
          }
          if (state.proposal && state.proposal.revision !== aiProposal?.summary.revision) {
            try {
              const proposal = await callTool<DiagramProposalSourceResult>('diagram.proposal', {})
              if (!disposed) {
                const after: DiagramDocument = {
                  ...proposal.before,
                  source: proposal.candidateSource,
                }
                setAiProposal({ summary: proposal.proposal, before: proposal.before, after })
                setProposalBranchSet(proposal.branchSet ?? null)
                setProposalReviewOpen(true)
                setNotice(proposal.proposal.patchSummary
                  ? `AI 提交增量候选：${proposal.proposal.patchSummary.updated} 修改 · ${proposal.proposal.patchSummary.added} 新增 · ${proposal.proposal.patchSummary.removed} 删除`
                  : 'AI 提交了一版候选修改，文件尚未写入')
              }
            } catch {
              // Proposal sync is best-effort; normal thread following can continue.
            }
          } else if (!state.proposal && aiProposal) {
            setAiProposal(null)
            setProposalBranchSet(null)
            setProposalReviewOpen(false)
          }
          if (state.gitImpact && state.gitImpact.updatedAt !== gitImpactReport?.updatedAt) {
            try {
              const impact = await callTool<DiagramGitImpactResult>('diagram.gitImpact', {})
              if (!disposed) {
                setGitImpactReport(impact)
                setGitImpactOpen(false)
                setNotice(`AI 已分析代码影响：${impact.git.files.length} 个改动文件 · ${impact.directElementIds.length} 个直接节点 · ${Math.max(0, impact.trace.nodeIds.length - impact.directElementIds.length)} 个间接节点`)
              }
            } catch {
              // Git impact sync is best-effort; graph following can continue.
            }
          }
          lastThreadStateAt.current = state.updatedAt
          if (skipRestoredThreadSelection.current) {
            skipRestoredThreadSelection.current = false
            return
          }
          if (!followConversation) return
          const nextPath = state.activeDiagramPath
          if (!nextPath) {
            const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            const remaining = result.diagrams
            onSnapshot({ ...snapshot, surface: 'thread', diagrams: remaining, activeDiagramPath: undefined })
            if (selected && !remaining.some((diagram) => diagram.path === selected.path)) {
              setSelected(null)
              setSource('')
              if (remaining[0]) await selectDiagram(remaining[0].path, true)
              if (!disposed) setNotice('当前图已从对话中删除，已切换到可用图表')
            }
            return
          }
          if (nextPath === selected?.path) {
            const pending = pendingPlaybackActivity.current
            if (pending?.path === selected.path && pending.modifiedAt && pending.modifiedAt === selected.modifiedAt) {
              pendingPlaybackActivity.current = undefined
            }
            setCanvasFocus(state.focusElementIds?.length ? { ids: state.focusElementIds, key: state.updatedAt, trace: state.trace } : null)
            if (state.focusElementIds?.length) {
              setNotice(state.proposal?.patchSummary
                ? `增量候选影响 ${state.focusElementIds.length} 个节点${state.proposal.automaticElementIds?.length ? ` · ${state.proposal.automaticElementIds.length} 个自动变化` : ''}`
                : state.trace
                  ? `已追踪${state.trace.direction === 'upstream' ? '上游' : state.trace.direction === 'downstream' ? '下游' : '双向邻域'} ${state.trace.depth} 跳 · ${state.focusElementIds.length} 个节点`
                  : `已定位 ${state.focusElementIds.length} 个源码关联节点`)
            }
            return
          }
          let diagrams = snapshot.diagrams
          if (!diagrams.some((diagram) => diagram.path === nextPath)) {
            const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            diagrams = result.diagrams
            onSnapshot({ ...snapshot, surface: 'thread', diagrams, activeDiagramPath: nextPath })
          }
          if (diagrams.some((diagram) => diagram.path === nextPath)) {
            await selectDiagram(nextPath, true)
            setCanvasFocus(state.focusElementIds?.length ? { ids: state.focusElementIds, key: state.updatedAt, trace: state.trace } : null)
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
          if (!disposed) backgroundSyncFailed('thread')
        })
        .finally(() => { inFlight = false })
    }, 1_300)
    return () => {
      disposed = true
      window.clearInterval(handle)
    }
  }, [aiProposal, dirty, followConversation, gitImpactReport, isThread, onSnapshot, panelVisible, selected, snapshot, workspacePath])

  useEffect(() => {
    if (!isThread || !panelVisible || selected || dirty || snapshot.diagrams.length > 0) return
    let disposed = false
    let inFlight = false
    const discover = () => {
      if (disposed || inFlight) return
      inFlight = true
      void callTool<DiagramListResult>('diagram.list', { workspacePath })
        .then(async (result) => {
          if (disposed || result.diagrams.length === 0) return
          const activePath = snapshot.activeDiagramPath
          const next = activePath ? result.diagrams.find((diagram) => diagram.path === activePath) : undefined
          onSnapshot({ ...snapshot, surface: 'thread', diagrams: result.diagrams, activeDiagramPath: next?.path })
          if (next) await selectDiagram(next.path, true)
          if (!disposed) setNotice(next ? '已恢复当前对话图表' : '已发现当前项目中的图表')
        })
        .catch(() => {
          // Discovery is opportunistic. Thread/revision sync surfaces persistent failures separately.
        })
        .finally(() => { inFlight = false })
    }
    discover()
    const handle = window.setInterval(discover, 2_500)
    return () => {
      disposed = true
      window.clearInterval(handle)
    }
  }, [dirty, isThread, onSnapshot, panelVisible, selected, snapshot, workspacePath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && selected) {
        event.preventDefault()
        void saveDiagram()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    if (!notice) return
    const handle = window.setTimeout(() => setNotice(null), 4_500)
    return () => window.clearTimeout(handle)
  }, [notice])

  useEffect(() => {
    if (!selected || !panelVisible) return
    let disposed = false
    let inFlight = false
    let reportedError = false
    const handle = window.setInterval(() => {
      if (disposed || inFlight || saving) return
      inFlight = true
      void callTool<DiagramRevisionResult>('diagram.revision', { workspacePath, path: selected.path })
        .then(async (result) => {
          if (disposed) return
          backgroundSyncSucceeded('revision')
          reportedError = false
          setDeletedDraftPath(null)
          if (result.revision.modifiedAt === selected.modifiedAt) return
          if (dirty) {
            setExternalChange(true)
            return
          }
          const latest = await callTool<DiagramResult>('diagram.get', { workspacePath, path: selected.path })
          if (disposed || dirty) return
          if (latest.diagram.source !== selected.source) {
            setChangeReview({ before: selected, after: latest.diagram })
            if (selected.type === 'canvas' && latest.diagram.type === 'canvas') {
              const activity = pendingPlaybackActivity.current
              const matchingActivity = activity?.path === selected.path
                && (!activity.modifiedAt || activity.modifiedAt === latest.diagram.modifiedAt)
                ? activity
                : undefined
              setCanvasPlayback({
                key: matchingActivity?.key ?? `sync:${selected.path}:${latest.diagram.modifiedAt}`,
                path: selected.path,
                mode: 'update',
                fromSource: selected.source,
                label: matchingActivity ? playbackActivityLabel(matchingActivity.kind) : '正在同步画板修改',
              })
              if (activity?.path === selected.path) pendingPlaybackActivity.current = undefined
            }
          }
          setSelected(latest.diagram)
          setSource(latest.diagram.source)
          setExternalChange(false)
          onSnapshot({
            ...snapshot,
            diagrams: snapshot.diagrams.map((item) => item.path === latest.diagram.path ? latest.diagram : item),
          })
          setNotice('已同步磁盘上的最新修改')
        })
        .catch(async () => {
          if (disposed) return
          if (externalDeleted) return
          backgroundSyncFailed('revision')
          if (reportedError) return
          reportedError = true
          try {
            const listed = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            if (!listed.diagrams.some((diagram) => diagram.path === selected.path)) {
              if (dirty) {
                setDeletedDraftPath(selected.path)
                setExternalChange(false)
                backgroundSyncSucceeded('revision')
                return
              }
              const fallback = listed.diagrams[0]
              onSnapshot({ ...snapshot, diagrams: listed.diagrams, activeDiagramPath: fallback?.path })
              setSelected(null)
              setSource('')
              setExternalChange(false)
              backgroundSyncSucceeded('revision')
              if (fallback) {
                await selectDiagram(fallback.path, true)
                if (!disposed) setNotice('当前图已被外部删除，已切换到其他图表')
              } else {
                if (!disposed) setNotice('当前图已被外部删除')
              }
              return
            }
          } catch {
            // Keep the currently rendered diagram available and retry in the background.
          }
        })
        .finally(() => { inFlight = false })
    }, 1_800)
    return () => {
      disposed = true
      window.clearInterval(handle)
    }
  }, [dirty, externalDeleted, onSnapshot, panelVisible, saving, selected, snapshot, workspacePath])

  useEffect(() => {
    let inFlight = false
    const handle = window.setInterval(() => {
      const watch = aiWatch.current
      if (!watch || inFlight) return
      if (Date.now() > watch.until) {
        aiWatch.current = null
        setError('未检测到 AI 创建的新图表。可以刷新列表，或在当前对话中查看任务执行结果。')
        return
      }
      inFlight = true
      void callTool<DiagramListResult>('diagram.list', { workspacePath })
        .then(async (result) => {
          onSnapshot({ ...snapshot, diagrams: result.diagrams })
          const created = result.diagrams.find((item) => !watch.existingPaths.has(item.path))
          if (created && !dirty) {
            aiWatch.current = null
            await selectDiagram(created.path)
            setNotice(`AI 已创建 ${created.name}`)
          }
        })
        .catch((cause) => {
          aiWatch.current = null
          setError(`自动刷新图表失败：${errorMessage(cause)}`)
        })
        .finally(() => { inFlight = false })
    }, 1_600)
    return () => window.clearInterval(handle)
  }, [dirty, onSnapshot, snapshot, workspacePath])

  function rememberThreadTab(diagramPath: string) {
    if (!isThread) return
    setThreadTabs((current) => {
      if (current.includes(diagramPath)) return current
      return [...current, diagramPath]
    })
  }

  async function closeThreadTab(diagramPath: string, force = false) {
    if (!isThread) return
    if (!force && selected?.path === diagramPath && dirty) {
      setDiscardTarget({ kind: 'close-thread', path: diagramPath })
      return
    }
    const index = threadTabs.indexOf(diagramPath)
    const next = threadTabs.filter((path) => path !== diagramPath)
    setThreadTabs(next)
    try {
      await callTool<{ kind: 'diagram-thread-closed'; path?: string }>('diagram.closeThreadDiagram', { path: diagramPath })
    } catch (cause) {
      setError(`关闭当前图失败：${errorMessage(cause)}`)
    }
    if (selected?.path !== diagramPath) return
    const fallback = next[Math.min(Math.max(0, index - 1), next.length - 1)]
    if (fallback) {
      await selectDiagram(fallback, true, false)
      return
    }
    selectRequestSeq.current += 1
    setSelected(null)
    setSource('')
    setCanvasSelection(null)
    setCanvasFocus(null)
    setCanvasPlayback(null)
    setGitImpactReport(null)
    setGitImpactOpen(false)
    setPatchHistoryOpen(false)
    setPatchHistoryEntries([])
    onSnapshot({ ...snapshot, activeDiagramPath: undefined })
  }

  async function selectDiagram(diagramPath: string, force = false, remember = true) {
    if (!force && dirty) {
      setDiscardTarget({ kind: 'diagram', path: diagramPath })
      return
    }
    const requestSeq = ++selectRequestSeq.current
    setDocumentMenuOpen(false)
    setRenaming(false)
    setDeleteConfirmOpen(false)
    if (changeReview?.after.path !== diagramPath) {
      setChangeReview(null)
      setChangeReviewOpen(false)
    }
    if (gitImpactReport?.path !== diagramPath) {
      setGitImpactReport(null)
      setGitImpactOpen(false)
    }
    setLoadingPath(diagramPath)
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.get', { workspacePath, path: diagramPath })
      if (requestSeq !== selectRequestSeq.current) return
      const activity = pendingPlaybackActivity.current
      const matchingActivity = activity?.path === result.diagram.path
        && (!activity.modifiedAt || activity.modifiedAt === result.diagram.modifiedAt)
        ? activity
        : undefined
      if (isThread && result.diagram.type === 'canvas' && matchingActivity) {
        const updatingCurrent = selected?.path === result.diagram.path && selected.type === 'canvas'
        setCanvasPlayback({
          key: matchingActivity.key,
          path: result.diagram.path,
          mode: updatingCurrent ? 'update' : 'create',
          ...(updatingCurrent ? { fromSource: selected.source } : {}),
          label: playbackActivityLabel(matchingActivity.kind),
        })
        pendingPlaybackActivity.current = undefined
      } else if (result.diagram.type !== 'canvas' || selected?.path !== result.diagram.path) {
        setCanvasPlayback(null)
        if (activity?.path === result.diagram.path) pendingPlaybackActivity.current = undefined
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setDeletedDraftPath(null)
      setExternalChange(false)
      if (result.diagram.type !== 'canvas' && patchHistoryOpen) {
        patchHistoryRequestSeq.current += 1
        setPatchHistoryOpen(false)
        setPatchHistoryEntries([])
      } else if (patchHistoryOpen) {
        void loadPatchHistory(result.diagram.path)
      }
      if (remember) rememberThreadTab(result.diagram.path)
    } catch (cause) {
      if (requestSeq !== selectRequestSeq.current) return
      setError(errorMessage(cause))
    } finally {
      if (requestSeq === selectRequestSeq.current) setLoadingPath(null)
    }
  }

  function requestWorkspaceSwitch() {
    if (dirty) {
      setDiscardTarget({ kind: 'workspace' })
      return
    }
    onSwitch()
  }

  function discardUnsavedChanges() {
    const target = discardTarget
    setDiscardTarget(null)
    if (!target) return
    if (target.kind === 'workspace') {
      onSwitch()
      return
    }
    if (target.kind === 'close-thread') {
      void closeThreadTab(target.path, true)
      return
    }
    if (target.kind === 'new-diagram') {
      void createDiagram(target.type, target.title, target.canvasWorkbench)
      return
    }
    void selectDiagram(target.path, true)
  }

  async function saveDiagram() {
    if (!selected || !dirty || saving || saveInFlight.current) return
    if (externalChange) {
      setError('文件已在外部修改，请先重新载入最新版本。')
      return
    }
    const requestSeq = selectRequestSeq.current
    saveInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await callTool<DiagramResult>(externalDeleted ? 'diagram.restore' : 'diagram.update', {
        workspacePath,
        path: selected.path,
        source,
        ...(externalDeleted ? {} : { expectedModifiedAt: selected.modifiedAt, animate: false }),
      })
      if (requestSeq !== selectRequestSeq.current) return
      setSelected(result.diagram)
      setSource((current) => current === source ? result.diagram.source : current)
      setDeletedDraftPath(null)
      setExternalChange(false)
      setChangeReview(null)
      setChangeReviewOpen(false)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.some((item) => item.path === result.diagram.path)
          ? snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item)
          : [result.diagram, ...snapshot.diagrams],
      })
    } catch (cause) {
      if (requestSeq === selectRequestSeq.current) setError(errorMessage(cause))
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  async function reloadSelected() {
    if (!selected) return
    const requestSeq = selectRequestSeq.current
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.get', { workspacePath, path: selected.path })
      if (requestSeq !== selectRequestSeq.current) return
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      setNotice('已重新载入磁盘版本')
    } catch (cause) {
      if (requestSeq === selectRequestSeq.current) setError(errorMessage(cause))
    }
  }

  async function restorePreviousChange() {
    const review = changeReview
    if (!review || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.update', {
        workspacePath,
        path: review.after.path,
        source: review.before.source,
        expectedModifiedAt: review.after.modifiedAt,
        animate: false,
      })
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      setChangeReview(null)
      setChangeReviewOpen(false)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      setNotice('已恢复到本次外部修改前的版本')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

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
        setSelected(savedDraft.diagram)
        setSource(savedDraft.diagram.source)
        setExternalChange(false)
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
      if (isThread && aiProposal.before.type === 'canvas' && result.diagram.type === 'canvas' && aiProposal.before.path === result.diagram.path) {
        setCanvasPlayback({
          key: `proposal:${result.diagram.path}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: result.proposalApply?.beforeSource ?? aiProposal.before.source,
          label: 'AI 正在应用候选修改',
        })
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
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

  async function loadPatchHistory(diagramPath = selected?.path) {
    if (!diagramPath) return
    const requestSeq = ++patchHistoryRequestSeq.current
    setPatchHistoryLoading(true)
    try {
      const result = await callTool<DiagramPatchHistoryResult>('diagram.patchHistory', { workspacePath, path: diagramPath, limit: 100 })
      if (requestSeq !== patchHistoryRequestSeq.current) return
      setPatchHistoryEntries(result.entries)
    } catch (cause) {
      if (requestSeq !== patchHistoryRequestSeq.current) return
      setError(errorMessage(cause))
    } finally {
      if (requestSeq === patchHistoryRequestSeq.current) setPatchHistoryLoading(false)
    }
  }

  function openPatchHistory() {
    if (!selected) return
    setProposalReviewOpen(false)
    setChangeReviewOpen(false)
    setGitImpactOpen(false)
    setPatchHistoryOpen(true)
    void loadPatchHistory(selected.path)
  }

  async function undoPatchHistory(entry: DiagramPatchHistoryEntry) {
    if (!selected || selected.path !== entry.path || saving || patchHistoryUndoingId || patchHistoryRedoingId) return
    if (dirty && externalChange) {
      setError('当前画布同时存在未保存修改和外部更新，请先处理外部冲突。')
      return
    }
    setSaving(true)
    setPatchHistoryUndoingId(entry.id)
    setError(null)
    try {
      let beforeSource = source
      if (dirty) {
        const savedDraft = await callTool<DiagramResult>('diagram.update', {
          workspacePath,
          path: selected.path,
          source,
          expectedModifiedAt: selected.modifiedAt,
          animate: false,
        })
        setSelected(savedDraft.diagram)
        setSource(savedDraft.diagram.source)
        beforeSource = savedDraft.diagram.source
        setExternalChange(false)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === savedDraft.diagram.path ? savedDraft.diagram : item),
        })
      }
      const result = await callTool<DiagramPatchHistoryUndoResult>('diagram.undoPatchHistory', {
        workspacePath,
        historyId: entry.id,
      })
      if (isThread && result.diagram.type === 'canvas') {
        setCanvasPlayback({
          key: `history-undo:${entry.id}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: beforeSource,
          label: '正在撤销 AI 修改',
        })
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      if (result.diagram.type === 'canvas' && result.revertedElementIds.length) {
        const restored = parseCanvasScene(result.diagram.source)
        const nodeIds = new Set(restored.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.revertedElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `history-focus:${entry.id}:${result.diagram.modifiedAt}` })
      }
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      await loadPatchHistory(result.diagram.path)
      setNotice(`已撤销这次 AI 修改 · ${result.revertedElementIds.length} 个元素恢复`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
      setPatchHistoryUndoingId(null)
    }
  }

  async function undoPatchHistoryChain(entry: DiagramPatchHistoryEntry) {
    if (!selected || selected.path !== entry.path || saving || patchHistoryUndoingId || patchHistoryRedoingId) return
    if (dirty && externalChange) {
      setError('当前画布同时存在未保存修改和外部更新，请先处理外部冲突。')
      return
    }
    setSaving(true)
    setPatchHistoryUndoingId(entry.id)
    setError(null)
    try {
      let beforeSource = source
      if (dirty) {
        const savedDraft = await callTool<DiagramResult>('diagram.update', {
          workspacePath,
          path: selected.path,
          source,
          expectedModifiedAt: selected.modifiedAt,
          animate: false,
        })
        setSelected(savedDraft.diagram)
        setSource(savedDraft.diagram.source)
        beforeSource = savedDraft.diagram.source
        setExternalChange(false)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === savedDraft.diagram.path ? savedDraft.diagram : item),
        })
      }
      const result = await callTool<DiagramPatchHistoryChainUndoResult>('diagram.undoPatchHistoryChain', {
        workspacePath,
        historyId: entry.id,
      })
      if (isThread && result.diagram.type === 'canvas') {
        setCanvasPlayback({
          key: `history-chain-undo:${entry.id}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: beforeSource,
          label: `正在撤销 ${result.historyIds.length} 个依赖 Patch`,
        })
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      if (result.diagram.type === 'canvas' && result.revertedElementIds.length) {
        const restored = parseCanvasScene(result.diagram.source)
        const nodeIds = new Set(restored.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.revertedElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `history-chain-focus:${entry.id}:${result.diagram.modifiedAt}` })
      }
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      await loadPatchHistory(result.diagram.path)
      setNotice(`已撤销依赖链 · ${result.historyIds.length} 个 Patch · ${result.revertedElementIds.length} 个元素恢复`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
      setPatchHistoryUndoingId(null)
    }
  }

  async function redoPatchHistory(entry: DiagramPatchHistoryEntry) {
    if (!selected || selected.path !== entry.path || saving || patchHistoryUndoingId || patchHistoryRedoingId) return
    if (dirty && externalChange) {
      setError('当前画布同时存在未保存修改和外部更新，请先处理外部冲突。')
      return
    }
    setSaving(true)
    setPatchHistoryRedoingId(entry.id)
    setError(null)
    try {
      let beforeSource = source
      if (dirty) {
        const savedDraft = await callTool<DiagramResult>('diagram.update', {
          workspacePath,
          path: selected.path,
          source,
          expectedModifiedAt: selected.modifiedAt,
          animate: false,
        })
        setSelected(savedDraft.diagram)
        setSource(savedDraft.diagram.source)
        beforeSource = savedDraft.diagram.source
        setExternalChange(false)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === savedDraft.diagram.path ? savedDraft.diagram : item),
        })
      }
      const result = await callTool<DiagramPatchHistoryRedoResult>('diagram.redoPatchHistory', {
        workspacePath,
        historyId: entry.id,
      })
      if (isThread && result.diagram.type === 'canvas') {
        setCanvasPlayback({
          key: `history-redo:${entry.id}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: beforeSource,
          label: '正在重做 AI 修改',
        })
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      if (result.diagram.type === 'canvas' && result.reappliedElementIds.length) {
        const reapplied = parseCanvasScene(result.diagram.source)
        const nodeIds = new Set(reapplied.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.reappliedElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `history-redo-focus:${entry.id}:${result.diagram.modifiedAt}` })
      }
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      await loadPatchHistory(result.diagram.path)
      setNotice(`已重做这次 AI 修改 · ${result.reappliedElementIds.length} 个元素重新应用`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
      setPatchHistoryRedoingId(null)
    }
  }

  async function redoPatchHistoryChain(entry: DiagramPatchHistoryEntry) {
    if (!selected || selected.path !== entry.path || saving || patchHistoryUndoingId || patchHistoryRedoingId) return
    if (dirty && externalChange) {
      setError('当前画布同时存在未保存修改和外部更新，请先处理外部冲突。')
      return
    }
    setSaving(true)
    setPatchHistoryRedoingId(entry.id)
    setError(null)
    try {
      let beforeSource = source
      if (dirty) {
        const savedDraft = await callTool<DiagramResult>('diagram.update', {
          workspacePath,
          path: selected.path,
          source,
          expectedModifiedAt: selected.modifiedAt,
          animate: false,
        })
        setSelected(savedDraft.diagram)
        setSource(savedDraft.diagram.source)
        beforeSource = savedDraft.diagram.source
        setExternalChange(false)
        onSnapshot({
          ...snapshot,
          diagrams: snapshot.diagrams.map((item) => item.path === savedDraft.diagram.path ? savedDraft.diagram : item),
        })
      }
      const result = await callTool<DiagramPatchHistoryChainRedoResult>('diagram.redoPatchHistoryChain', {
        workspacePath,
        historyId: entry.id,
      })
      if (isThread && result.diagram.type === 'canvas') {
        setCanvasPlayback({
          key: `history-chain-redo:${entry.id}:${result.diagram.modifiedAt}`,
          path: result.diagram.path,
          mode: 'update',
          fromSource: beforeSource,
          label: `正在重做 ${result.historyIds.length} 个依赖 Patch`,
        })
      }
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setExternalChange(false)
      if (result.diagram.type === 'canvas' && result.reappliedElementIds.length) {
        const reapplied = parseCanvasScene(result.diagram.source)
        const nodeIds = new Set(reapplied.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        const focusIds = result.reappliedElementIds.filter((id) => nodeIds.has(id))
        if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `history-chain-redo-focus:${entry.id}:${result.diagram.modifiedAt}` })
      }
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      await loadPatchHistory(result.diagram.path)
      setNotice(`已重做依赖链 · ${result.historyIds.length} 个 Patch · ${result.reappliedElementIds.length} 个元素重新应用`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
      setPatchHistoryRedoingId(null)
    }
  }

  async function refreshList() {
    setError(null)
    try {
      const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
      onSnapshot({ ...snapshot, diagrams: result.diagrams })
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function refreshThreadDiagramList() {
    if (threadDiagramListLoading) return
    setThreadDiagramListLoading(true)
    setThreadDiagramListError(null)
    try {
      const result = await callTool<DiagramListResult>('diagram.list', { workspacePath })
      onSnapshot((current) => current.workspacePath === workspacePath
        ? { ...current, diagrams: result.diagrams }
        : current)
    } catch (cause) {
      setThreadDiagramListError(errorMessage(cause))
    } finally {
      setThreadDiagramListLoading(false)
    }
  }

  function openThreadDiagramList() {
    setThreadDiagramMenuOpen(true)
    void refreshThreadDiagramList()
  }

  const searchSourceFiles = useCallback(async (query: string): Promise<string[]> => {
    const result = await callTool<SourceFilesResult>('diagram.sources', { workspacePath, query, limit: 40 })
    return result.files
  }, [workspacePath])

  async function analyzeGitImpact(baseRef?: string) {
    if (!selected || selected.type !== 'canvas') return
    setError(null)
    try {
      const result = await callTool<DiagramGitImpactResult>('diagram.impactFromGit', {
        workspacePath,
        path: selected.path,
        ...(baseRef?.trim() ? { baseRef: baseRef.trim() } : {}),
        direction: 'both',
        depth: 2,
        includeUntracked: true,
      })
      setGitImpactReport(result)
      setGitImpactOpen(true)
      setCanvasFocus(result.trace.nodeIds.length ? {
        ids: result.trace.nodeIds,
        key: `git-impact-${Date.now()}`,
        trace: result.directElementIds.length ? {
          seedElementIds: result.directElementIds,
          direction: result.direction,
          depth: result.depth,
        } : undefined,
      } : null)
      setNotice(result.directElementIds.length
        ? `代码影响：${result.git.files.length} 个改动文件 · ${result.directElementIds.length} 个直接节点 · ${Math.max(0, result.trace.nodeIds.length - result.directElementIds.length)} 个间接影响`
        : `发现 ${result.git.files.length} 个 Git 改动文件，但当前图没有 sourcePaths 命中`)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function explainGitImpact() {
    if (!gitImpactReport) return
    setAiSending(true)
    setError(null)
    try {
      const direct = gitImpactReport.buckets.find((bucket) => bucket.distance === 0)?.elementIds ?? []
      const oneHop = gitImpactReport.buckets.find((bucket) => bucket.distance === 1)?.elementIds ?? []
      const twoHop = gitImpactReport.buckets.find((bucket) => bucket.distance === 2)?.elementIds ?? []
      await sendHostMessage([
        '基于当前 Diagram 的 Git 影响报告分析这次代码改动。请先核对真实代码事实，再说明影响链路、风险点、需要回归的模块和可能遗漏的图节点。',
        `图表：${gitImpactReport.path}`,
        `Git 改动文件：${gitImpactReport.git.files.map((file) => file.path).join(', ') || '无'}`,
        `直接命中节点：${direct.join(', ') || '无'}`,
        `1 跳影响：${oneHop.join(', ') || '无'}`,
        `2 跳影响：${twoHop.join(', ') || '无'}`,
        `未映射文件：${gitImpactReport.unmatchedFiles.map((file) => file.path).join(', ') || '无'}`,
        '不要仅复述列表；结合源码调用、数据流和外部依赖判断真实影响。对于架构上重要但未映射的真实源码，先阅读后可使用 diagram.upsertSourceNodes 批量补充节点；测试、文档、生成文件不要为了覆盖率机械加入架构图。',
      ].join('\n'))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  async function clearGitImpact() {
    setGitImpactReport(null)
    setGitImpactOpen(false)
    setCanvasFocus(null)
    if (!isThread) return
    try {
      await callTool<{ kind: 'diagram-git-impact-dismissed' }>('diagram.dismissGitImpact', {})
    } catch {
      // Clearing the local visualization is still useful if the host bridge is temporarily unavailable.
    }
  }

  async function createDiagram(type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) {
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.create', { workspacePath, type, title, ...(type === 'canvas' && canvasWorkbench ? { canvasWorkbench } : {}), animate: false })
      const next = [result.diagram, ...snapshot.diagrams.filter((item) => item.path !== result.diagram.path)]
      onSnapshot({ ...snapshot, diagrams: next })
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setCreating(false)
      setDeletedDraftPath(null)
      rememberThreadTab(result.diagram.path)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function requestCreateDiagram(type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) {
    if (dirty) {
      setDiscardTarget({ kind: 'new-diagram', type, title, canvasWorkbench })
      return
    }
    await createDiagram(type, title, canvasWorkbench)
  }

  async function renameDiagram() {
    if (!selected || dirty || !renameTitle.trim()) return
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.rename', {
        workspacePath,
        path: selected.path,
        title: renameTitle.trim(),
        expectedModifiedAt: selected.modifiedAt,
      })
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === selected.path ? result.diagram : item),
      })
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setRenaming(false)
      setDocumentMenuOpen(false)
      if (isThread) setThreadTabs((current) => current.map((path) => path === selected.path ? result.diagram.path : path))
      setNotice(`已重命名为 ${result.diagram.name}`)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function duplicateDiagram() {
    if (!selected || dirty) return
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.duplicate', {
        workspacePath,
        path: selected.path,
      })
      const next = [result.diagram, ...snapshot.diagrams]
      onSnapshot({ ...snapshot, diagrams: next })
      setSelected(result.diagram)
      setSource(result.diagram.source)
      setDocumentMenuOpen(false)
      setRenaming(false)
      rememberThreadTab(result.diagram.path)
      setNotice(`已复制为 ${result.diagram.name}`)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function deleteDiagram() {
    if (!selected || dirty) return
    const deleting = selected
    setError(null)
    try {
      await callTool<DiagramDeletedResult>('diagram.delete', {
        workspacePath,
        path: deleting.path,
        expectedModifiedAt: deleting.modifiedAt,
      })
      const remaining = snapshot.diagrams.filter((item) => item.path !== deleting.path)
      onSnapshot({ ...snapshot, diagrams: remaining })
      setSelected(null)
      setSource('')
      setDocumentMenuOpen(false)
      setRenaming(false)
      setDeleteConfirmOpen(false)
      setNotice(`已删除 ${deleting.name}`)
      if (remaining[0]) await selectDiagram(remaining[0].path)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function sendGeneration(request: DiagramGenerationRequest) {
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return false
    }
    setAiSending(true)
    setError(null)
    try {
      aiWatch.current = {
        until: Date.now() + 90_000,
        existingPaths: new Set(snapshot.diagrams.map((item) => item.path)),
      }
      await sendHostMessage(buildGenerationPrompt(workspacePath, request))
      setNotice('已发送到当前 对话，生成后会自动刷新')
      return true
    } catch (cause) {
      aiWatch.current = null
      setError(errorMessage(cause))
      return false
    } finally {
      setAiSending(false)
    }
  }

  async function sendModification(instruction: string) {
    if (!selected) return false
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return false
    }
    if (dirty) {
      setError('先保存当前修改，再让 AI 继续编辑这张图。')
      return false
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage(buildModificationPrompt(workspacePath, selected, instruction))
      setNotice('已发送到当前 对话；AI 返回候选修改后会先进入 Proposal 审查')
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setAiSending(false)
    }
  }

  async function updateSelectedCanvasFromConversation() {
    if (!selected || selected.type !== 'canvas' || !canvasSelection?.elements.length) return
    const compact = canvasSelection.elements.map((element) => {
      if (element.type === 'arrow') return { id: element.id, type: element.type, from: element.from, to: element.to, label: element.label, lineStyle: element.lineStyle, routing: element.routing, fromAnchor: element.fromAnchor, toAnchor: element.toAnchor, fromPortRatio: element.fromPortRatio, toPortRatio: element.toPortRatio, points: element.points, labelPosition: element.labelPosition, emphasis: element.emphasis, bundleKey: element.bundleKey }
      return { id: element.id, type: element.type, text: element.text, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, tone: element.tone, shape: element.shape, shapeRef: element.shapeRef, textOnly: element.type === 'note' ? element.textOnly : undefined, fontSize: element.type === 'note' ? element.fontSize : undefined, fontWeight: element.type === 'note' ? element.fontWeight : undefined, textColor: element.type === 'note' ? element.textColor : undefined, imagePath: element.type === 'note' ? element.imagePath : undefined, imageFit: element.type === 'note' ? element.imageFit : undefined, icon: element.icon, stencil: element.stencil, c4Type: element.c4Type, subtitle: element.subtitle, description: element.description, tags: element.tags, locked: element.locked, groupId: element.groupId, laneId: element.laneId, sourcePaths: element.sourcePaths }
    })
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return
    }
    if (dirty) {
      setError('先保存当前修改，再让 AI 继续编辑这张图。')
      return
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage(buildSubgraphModificationPrompt(
        workspacePath,
        selected,
        canvasSelection.ids,
        [
          '结合当前对话中用户最新的要求调整当前选区。',
          '当前选区结构：',
          JSON.stringify(compact),
        ].join('\n'),
      ))
      setAiOpen(false)
      setNotice('已发送子图修改请求，候选完成后会在右侧进入 Proposal 审查')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  async function importCanvasImage(input: { filename: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; content: string }) {
    if (!selected || selected.type !== 'canvas') throw new Error('只有 Canvas 图支持图片资源。')
    return callTool<DiagramImageAssetResult>('diagram.importImageAsset', {
      workspacePath,
      path: selected.path,
      ...input,
    })
  }

  async function resolveCanvasImage(path: string): Promise<string> {
    const result = await callTool<DiagramImageAssetContentResult>('diagram.readImageAsset', { workspacePath, path })
    return `data:${result.mimeType};base64,${result.content}`
  }

  async function exportSvg() {
    if (!selected || exporting) return
    setExporting(true)
    setError(null)
    try {
      const svg = selected.type === 'canvas'
        ? await renderCanvasSvg(source, workspacePath)
        : await renderMermaidSvg(source, `export-${Date.now()}`)
      const filename = `${safeFilename(selected.name)}.svg`
      const destination = await deliverExport(filename, 'svg', svg)
      setNotice(`已导出 ${destination}`)
    } catch (cause) {
      setError(cleanMermaidError(errorMessage(cause)))
    } finally {
      setExporting(false)
    }
  }

  async function exportPng() {
    if (!selected || exporting) return
    setExporting(true)
    setError(null)
    try {
      const svg = selected.type === 'canvas'
        ? await renderCanvasSvg(source, workspacePath)
        : await renderMermaidSvg(source, `export-png-${Date.now()}`)
      const blob = await svgToPngBase64(svg, resolveCssColor('--app-bg', '#ffffff'))
      const filename = `${safeFilename(selected.name)}.png`
      const destination = await deliverExport(filename, 'png', blob)
      setNotice(`已导出 ${destination}`)
    } catch (cause) {
      setError(cleanMermaidError(errorMessage(cause)))
    } finally {
      setExporting(false)
    }
  }

  async function deliverExport(filename: string, format: 'svg' | 'png', content: string): Promise<string> {
    if (host.downloadFile) {
      const result = format === 'svg'
        ? await host.downloadFile({
            contents: [{
              type: 'resource',
              resource: {
                uri: `file:///${encodeURIComponent(filename)}`,
                mimeType: 'image/svg+xml',
                text: content,
              },
            }],
          })
        : await host.downloadFile({
            contents: [{
              type: 'resource',
              resource: {
                uri: `file:///${encodeURIComponent(filename)}`,
                mimeType: 'image/png',
                blob: content,
              },
            }],
          })
      if (result.isError) throw new Error('宿主取消或拒绝了文件导出。')
      return filename
    }

    const result = await callTool<DiagramExportResult>('diagram.exportAsset', {
      workspacePath,
      filename,
      format,
      content,
    })
    return result.path
  }

  async function openDiagramFile() {
    if (!selected) return
    const fileApi = host.files
    if (!fileApi) {
      setError('当前宿主没有提供原生文件打开能力。')
      return
    }
    try {
      await fileApi.open(resolveWorkspaceFilePath(workspacePath, selected.path))
    } catch (cause) {
      setError(`打开图表文件失败：${errorMessage(cause)}`)
    }
  }

  async function openWorkspaceSource(path: string) {
    const fileApi = host.files
    if (!fileApi) {
      setError('当前宿主没有提供原生文件打开能力。')
      return
    }
    try {
      await fileApi.open(resolveWorkspaceFilePath(workspacePath, path))
    } catch (cause) {
      setError(`打开源码失败：${errorMessage(cause)}`)
    }
  }

  function openAiPanel(mode: 'generate' | 'modify') {
    const focused = document.activeElement as HTMLElement | null
    aiReturnFocus.current = focused?.closest('[role="menu"]') ? threadMoreButton.current : focused
    setAiMode(mode)
    setAiOpen(true)
  }

  function openWorkspaceGeneration() {
    setGenerationPreset({
      key: Date.now(),
      scope: '.',
      title: '',
      instructions: '先识别核心模块和边界，再画主要依赖或调用关系；不要把所有文件都展开。',
    })
    openAiPanel('generate')
  }

  async function explainInConversation() {
    if (!selected || aiSending) return
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage([
        '解释 Diagram 侧边栏当前选中的图表，并在当前对话中回答，不要修改文件。',
        `工作空间：${workspacePath}`,
        `图表路径：${selected.path}`,
        `图表类型：${selected.type}`,
        '',
        '先调用 diagram.get 读取最新版本；结合当前对话上下文说明主流程、关键边界、异常路径和最值得关注的设计点。',
      ].join('\n'))
      setNotice('已让 AI 在当前对话中解释这张图')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  function updateFromConversation() {
    void sendModification('结合当前对话中用户最新提出的需求和已确认的代码事实更新这张图。只调整受当前对话影响的部分，保留仍然正确的结构。')
  }

  return (
    <main className={`diagram-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${isThread ? ' thread-companion' : ''}`}>
      <aside className="diagram-sidebar">
        <div className="sidebar-head">
          <div className="sidebar-title-row">
            <div>
              <div className="eyebrow">DIAGRAMS</div>
              <div className="sidebar-title">图表</div>
            </div>
            <div className="sidebar-head-actions">
              <button className="icon-button" type="button" title="收起图表栏" aria-label="收起图表栏" onClick={() => setSidebarCollapsed(true)}>‹</button>
              <button className="icon-text-button" type="button" onClick={() => setCreating((value) => !value)}>新建</button>
            </div>
          </div>
          <button className="workspace-path" type="button" disabled={!host.canSelectWorkspace} onClick={requestWorkspaceSwitch} title={workspacePath}>{workspacePath}</button>
        </div>

        {creating && !isThread ? <NewDiagramForm onCancel={() => setCreating(false)} onCreate={requestCreateDiagram} /> : null}

        <div className="diagram-search-wrap">
          <input
            className="diagram-search"
            value={diagramQuery}
            onChange={(event) => setDiagramQuery(event.target.value)}
            placeholder="搜索图表"
            aria-label="搜索图表"
          />
        </div>
        <div className="sidebar-list-head">
          <span>{diagramQuery.trim() ? `${visibleDiagrams.length} / ${snapshot.diagrams.length}` : `${snapshot.diagrams.length} 个图表`}</span>
          <div className="sidebar-list-actions">
            <button type="button" onClick={openWorkspaceGeneration}>工作区→图</button>
            <button type="button" onClick={() => void refreshList()}>刷新</button>
          </div>
        </div>
        <nav className="diagram-list" aria-label="图表列表">
          {visibleDiagrams.map((diagram) => (
            <button
              key={diagram.path}
              className={`diagram-list-item${selected?.path === diagram.path ? ' is-active' : ''}`}
              type="button"
              onClick={() => void selectDiagram(diagram.path)}
            >
              <span className="diagram-list-name">{diagram.name}</span>
              <span className="diagram-list-meta">{diagramSummaryLabel(diagram)} · {shortPath(diagram.path)}</span>
              {loadingPath === diagram.path ? <span className="loading-line" /> : null}
            </button>
          ))}
          {snapshot.diagrams.length === 0 ? <div className="sidebar-empty">当前项目还没有图表。</div> : null}
          {snapshot.diagrams.length > 0 && visibleDiagrams.length === 0 ? <div className="sidebar-empty">没有匹配的图表。</div> : null}
        </nav>
      </aside>

      {sidebarCollapsed ? (
        <button className="sidebar-expand-button" type="button" title="展开图表栏" aria-label="展开图表栏" onClick={() => setSidebarCollapsed(false)}>›</button>
      ) : null}

      <section className="diagram-main">
        {isThread ? (
          <div className="thread-companion-head">
            <div className="thread-diagram-menu">
              <Popover
                open={threadDiagramMenuOpen}
                onOpenChange={(open) => {
                  if (open) openThreadDiagramList()
                  else {
                    setThreadDiagramMenuOpen(false)
                    setThreadDiagramQuery('')
                    setThreadDiagramListError(null)
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between gap-1" aria-label="打开图表">
                    <FolderOpenIcon className="size-4 shrink-0" />
                    <span>打开图表</span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(420px,calc(100vw-28px))] p-0">
                  <div className="flex h-9 items-center justify-between border-b px-3">
                    <strong className="text-sm font-medium">打开已有图表</strong>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{snapshot.diagrams.length} 个图表</span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        aria-label="刷新图表列表"
                        title="刷新图表列表"
                        disabled={threadDiagramListLoading}
                        onClick={() => void refreshThreadDiagramList()}
                      >
                        <RefreshCwIcon className={threadDiagramListLoading ? 'animate-spin' : ''} />
                      </Button>
                    </div>
                  </div>
                  <div className="border-b p-2">
                    <Input
                      value={threadDiagramQuery}
                      onChange={(event) => setThreadDiagramQuery(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder="搜索图表名称、类型或路径"
                      aria-label="搜索图表"
                      className="thread-diagram-search h-8"
                    />
                  </div>
                  {threadDiagramListError ? (
                    <div role="alert" className="px-3 py-2 text-xs text-destructive">
                      加载失败：{threadDiagramListError}
                      <Button type="button" variant="link" size="sm" onClick={() => void refreshThreadDiagramList()}>重试</Button>
                    </div>
                  ) : null}
                  <ScrollArea className="h-[min(340px,48vh)]">
                    <div className="flex flex-col gap-1 p-1">
                      {([
                        { key: 'current', label: '当前对话', items: threadMenuGroups.current },
                        { key: 'project', label: '当前项目 · 最近修改', items: threadMenuGroups.project },
                      ] as const).map((section) => section.items.length ? (
                        <section className="flex flex-col gap-1" key={section.key} aria-label={section.label}>
                          <div className="flex h-7 items-center justify-between px-2 text-xs text-muted-foreground">
                            <strong className="font-medium">{section.label}</strong>
                            <span>{section.items.length}</span>
                          </div>
                          {section.items.map((diagram) => (
                            <Button
                              key={diagram.path}
                              variant={selected?.path === diagram.path ? 'secondary' : 'ghost'}
                              className="h-auto w-full justify-between gap-3 px-2 py-2 text-left"
                              type="button"
                              onClick={() => {
                                setThreadDiagramMenuOpen(false)
                                setThreadDiagramQuery('')
                                void selectDiagram(diagram.path)
                              }}
                            >
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate font-medium">{diagram.name}</strong>
                                <small className="block truncate text-xs text-muted-foreground">{shortPath(diagram.path)}</small>
                              </span>
                              <Badge variant="outline">{selected?.path === diagram.path ? selectedTypeLabel : diagramSummaryLabel(diagram)}</Badge>
                            </Button>
                          ))}
                        </section>
                      ) : null)}
                      {threadMenuGroups.current.length === 0 && threadMenuGroups.project.length === 0 ? (
                        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                          {threadDiagramListLoading ? '正在读取已保存的图表…' : threadDiagramQuery.trim() ? '没有匹配的图表' : '当前项目还没有已保存的图表'}
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>
            {threadTabs.length > 0 ? (
              <div ref={threadTabsElement} className="thread-diagram-tabs" role="group" aria-label="当前对话图表">
                {threadTabs.map((path) => {
                  const diagram = snapshot.diagrams.find((item) => item.path === path)
                  if (!diagram) return null
                  return (
                    <div key={path} className={`thread-diagram-tab${selected?.path === path ? ' is-active' : ''}`}>
                      <button type="button" className="thread-diagram-tab-main" onClick={() => void selectDiagram(path)} title={path}>
                        <span>{diagram.name}</span>
                      </button>
                      <button type="button" className="thread-diagram-tab-close" aria-label={`关闭 ${diagram.name}`} onClick={() => closeThreadTab(path)}>×</button>
                    </div>
                  )
                })}
              </div>
            ) : null}
            <div className="thread-document-actions">
              <button
                className={`thread-follow-toggle${followConversation ? ' is-active' : ''}`}
                type="button"
                aria-pressed={followConversation}
                title={followConversation ? '正在跟随当前对话中的图表' : '已暂停跟随当前对话'}
                onClick={() => setFollowConversation((value) => !value)}
              >
                跟随
              </button>
              {selected ? (
                <Button variant="ghost" size="sm" aria-pressed={mode === 'source'} title={mode === 'source' ? '切换到画布' : '查看源码'} onClick={() => setMode(mode === 'source' ? 'preview' : 'source')}>源码</Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button ref={threadMoreButton} variant="ghost" size="icon-sm" aria-label="更多图表操作"><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(event) => { if (aiOpen) event.preventDefault() }}>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={openThreadDiagramList}>打开图表</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setCreating(true)}>新建图表</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openAiPanel('generate')}>从代码生成</DropdownMenuItem>
                    {selected ? <DropdownMenuItem disabled={dirty || aiSending} onSelect={() => openAiPanel('modify')}>修改当前图</DropdownMenuItem> : null}
                  </DropdownMenuGroup>
                  {selected ? <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem disabled={aiSending || dirty} onSelect={() => void updateFromConversation()}>按对话更新</DropdownMenuItem>
                      {selected.type === 'canvas' && canvasSelection?.elements.length ? <DropdownMenuItem disabled={aiSending || dirty} onSelect={() => void updateSelectedCanvasFromConversation()}>调整选中</DropdownMenuItem> : null}
                      <DropdownMenuItem disabled={aiSending || dirty} onSelect={() => void sendModification('结合当前代码事实，为这张图补充真正重要的失败路径、异常分支或回退路径；不要机械增加无关节点。')}>补异常路径</DropdownMenuItem>
                      <DropdownMenuItem disabled={aiSending} onSelect={() => void explainInConversation()}>解释图表</DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      {selected.type === 'canvas' ? <DropdownMenuItem onSelect={openPatchHistory}>修改记录</DropdownMenuItem> : <DropdownMenuSub>
                        <DropdownMenuSubTrigger>图表样式</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-80 overflow-auto">
                          <DropdownMenuRadioGroup value={resolveMermaidVisualStyle(source)} onValueChange={(value) => setSource((current) => setMermaidVisualStyle(current, value as MermaidVisualStyle))}>
                            {diagramVisualStyles.map((style) => <DropdownMenuRadioItem key={style.id} value={style.id}>{style.label}</DropdownMenuRadioItem>)}
                            {[['technical', '工程文档'], ['minimal', '极简'], ['editorial', '叙事'], ['presentation', '汇报']].map(([value, label]) => <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>}
                      {aiProposal ? <DropdownMenuItem onSelect={() => setProposalReviewOpen(true)}>候选修改</DropdownMenuItem> : null}
                      {changeReview ? <DropdownMenuItem onSelect={() => setChangeReviewOpen(true)}>查看变更</DropdownMenuItem> : null}
                      <DropdownMenuItem disabled={exporting} onSelect={() => void exportSvg()}>导出 SVG</DropdownMenuItem>
                      <DropdownMenuItem disabled={exporting} onSelect={() => void exportPng()}>导出 PNG</DropdownMenuItem>
                    </DropdownMenuGroup>
                  </> : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {selected ? dirty || saving ? <button className="primary-button compact" type="button" disabled={saving} onClick={() => void saveDiagram()}>{saving ? '保存中…' : '保存'}</button> : <span className="save-state">已保存</span> : null}
            </div>
          </div>
        ) : null}
        {isThread && syncIssue ? (
          <div className="sync-warning" role="status">
            <span>{syncIssue}</span>
            <span>不会影响当前图查看与编辑</span>
          </div>
        ) : null}
        {aiProposal ? (
          <div className="proposal-banner" role="status">
            <div>
              <strong>{proposalBranchSet?.branches.length && proposalBranchSet.branches.length > 1 ? `AI 候选分支 · ${proposalBranchSet.branches.length}` : aiProposal.summary.patchSummary ? 'AI 增量候选修改' : aiProposal.summary.scopeElementIds?.length ? 'AI 子图候选修改' : 'AI 候选修改'}</strong>
              <span>{aiProposal.summary.patchSummary
                ? `${aiProposal.summary.branchLabel ? `${aiProposal.summary.branchLabel} · ` : ''}${aiProposal.summary.patchSummary.updated} 修改 · ${aiProposal.summary.patchSummary.added} 新增 · ${aiProposal.summary.patchSummary.removed} 删除${aiProposal.summary.automaticElementIds?.length ? ` · ${aiProposal.summary.automaticElementIds.length} 自动影响` : ''}`
                : aiProposal.summary.reason || '尚未写入文件，先查看 Diff 再决定。'}</span>
            </div>
            <div className="proposal-banner-actions">
              <button type="button" onClick={() => setProposalReviewOpen(true)}>查看</button>
              <button type="button" onClick={() => void dismissAiProposal()}>{proposalBranchSet?.branches.length && proposalBranchSet.branches.length > 1 ? '拒绝全部' : '拒绝'}</button>
              <button className="primary-button compact" type="button" disabled={saving} onClick={() => void acceptAiProposal()}>{proposalBranchSet?.branches.length && proposalBranchSet.branches.length > 1 ? '接受当前' : '接受'}</button>
            </div>
          </div>
        ) : null}
        {gitImpactReport ? (
          <div className="impact-banner" role="status">
            <div>
              <strong>代码改动影响</strong>
              <span>{gitImpactReport.git.files.length} 个文件 · {gitImpactReport.directElementIds.length} 个直接节点 · {Math.max(0, gitImpactReport.trace.nodeIds.length - gitImpactReport.directElementIds.length)} 个间接节点</span>
            </div>
            <div className="proposal-banner-actions">
              <button type="button" onClick={() => setGitImpactOpen(true)}>查看</button>
              <button type="button" onClick={() => void clearGitImpact()}>清除</button>
            </div>
          </div>
        ) : null}
        {notice ? <div className="notice-banner"><span>{notice}</span>{changeReview ? <button type="button" onClick={() => setChangeReviewOpen(true)}>查看变更</button> : null}</div> : null}
        {externalDeleted ? (
          <div className="conflict-banner" role="status">
            <span>原文件已删除，草稿已保留</span>
            <button type="button" disabled={saving} onClick={() => void saveDiagram()}>恢复文件</button>
          </div>
        ) : externalChange ? (
          <div className="conflict-banner">
            <span>文件已在外部修改</span>
            <button type="button" onClick={() => void reloadSelected()}>重新载入</button>
          </div>
        ) : null}
        {error && !aiOpen ? <div className="error-banner">{error}<button type="button" onClick={() => setError(null)}>关闭</button></div> : null}
        {selected ? (
          <>
            {!isThread ? <header className="editor-toolbar">
              <div className="document-identity">
                <strong>{selected.name}</strong>
                <span>{selected.path}</span>
              </div>
              <div className="toolbar-actions">
                <button type="button" onClick={() => openAiPanel('generate')}>生成</button>
                <div className="export-actions" aria-label="导出图表">
                  <button type="button" disabled={exporting} onClick={() => void exportSvg()}>{exporting ? '导出中…' : 'SVG'}</button>
                  <button type="button" disabled={exporting} onClick={() => void exportPng()}>PNG</button>
                </div>
                {selected.type !== 'canvas' ? <select className="freeform-visual-style" aria-label="图表样式" value={resolveMermaidVisualStyle(source)} onChange={(event) => setSource((current) => setMermaidVisualStyle(current, event.target.value as MermaidVisualStyle))}>
                  <optgroup label="共享样式">{diagramVisualStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</optgroup>
                  <optgroup label="经典排版"><option value="technical">工程文档</option><option value="minimal">极简</option><option value="editorial">叙事</option><option value="presentation">汇报</option></optgroup>
                </select> : null}
                <div className="mode-switch" aria-label="视图模式">
                  <ModeButton value="preview" mode={mode} onChange={setMode}>预览</ModeButton>
                  <ModeButton value="source" mode={mode} onChange={setMode}>源码</ModeButton>
                  <ModeButton value="split" mode={mode} onChange={setMode}>分屏</ModeButton>
                </div>
                {changeReview ? (
                  <button className="change-review-trigger" type="button" onClick={() => setChangeReviewOpen(true)}>变更</button>
                ) : null}
                {aiProposal ? <button className="proposal-review-trigger" type="button" onClick={() => setProposalReviewOpen(true)}>候选修改</button> : null}
                {selected.type === 'canvas' ? <button className={`patch-history-trigger${patchHistoryOpen ? ' is-active' : ''}`} type="button" onClick={openPatchHistory}>历史</button> : null}
                <span className={`save-state${dirty ? ' is-dirty' : ''}`}>{saving ? '保存中…' : dirty ? '未保存' : '已保存'}</span>
                {dirty || saving ? <button className="primary-button compact" type="button" disabled={saving} onClick={() => void saveDiagram()}>保存</button> : null}
                <DropdownMenu
                  open={documentMenuOpen}
                  onOpenChange={(open) => {
                    setDocumentMenuOpen(open)
                    if (open) setRenameTitle(selected.name)
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="更多图表操作">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={dirty}
                        onSelect={() => {
                          setRenameTitle(selected.name)
                          setRenaming(true)
                        }}
                      >
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={dirty} onSelect={() => void duplicateDiagram()}>
                        复制图表
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={dirty}
                        onSelect={() => setDeleteConfirmOpen(true)}
                      >
                        删除图表
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header> : null}
            <div
              ref={editorWorkspace}
              className={`editor-workspace mode-${mode}`}
              style={{ '--diagram-split': `${splitPercent}%` } as CSSProperties}
            >
              {(mode === 'source' || mode === 'split') ? (
                <section className="source-pane">
                  <div className="pane-head">
                    <span>{selected.type === 'canvas' ? 'Canvas JSON' : 'Mermaid'}</span>
                    <div className="pane-head-actions">
                      <span>{selectedTypeLabel}</span>
                      <button type="button" onClick={() => setSourceSearchRequest((value) => value + 1)}>查找</button>
                      <button type="button" onClick={() => void openDiagramFile()}>打开文件</button>
                    </div>
                  </div>
                  <MermaidEditor
                    key={selected.path}
                    value={source}
                    onChange={setSource}
                    onSave={() => void saveDiagram()}
                    searchRequest={sourceSearchRequest}
                    syntax={selected.type === 'canvas' ? 'plain' : 'mermaid'}
                    ariaLabel={selected.type === 'canvas' ? '自由画布 JSON 编辑器' : 'Mermaid 源码编辑器'}
                  />
                </section>
              ) : null}
              {mode === 'split' ? (
                <button
                  className="split-resizer"
                  type="button"
                  aria-label="调整源码和预览宽度"
                  title="拖动调整源码和预览宽度"
                  onDoubleClick={() => setSplitPercent(44)}
                  onPointerDown={(event) => {
                    const bounds = editorWorkspace.current?.getBoundingClientRect()
                    if (!bounds) return
                    splitDrag.current = { pointerId: event.pointerId, left: bounds.left, width: bounds.width }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const drag = splitDrag.current
                    if (!drag || drag.pointerId !== event.pointerId) return
                    const next = ((event.clientX - drag.left) / drag.width) * 100
                    setSplitPercent(Math.min(68, Math.max(28, next)))
                  }}
                  onPointerUp={(event) => {
                    if (splitDrag.current?.pointerId === event.pointerId) splitDrag.current = null
                  }}
                  onPointerCancel={() => { splitDrag.current = null }}
                />
              ) : null}
              {(mode === 'preview' || mode === 'split' || selected.type === 'canvas') ? (
                <section className="preview-pane" hidden={mode === 'source'}>
                  {!isThread || selected.type !== 'canvas' ? <div className="pane-head"><span>{selected.type === 'canvas' ? '画布' : '预览'}</span><span>{selected.type === 'canvas' ? '可视化编辑' : '实时渲染'}</span></div> : null}
                  {selected.type === 'canvas'
                    ? <CanvasEditor
                        key={`${workspacePath}:${selected.path}`}
                        source={source}
                        active={canvasActive}
                        onChange={(nextSource) => {
                          const target = canvasWriteTarget.current
                          if (target.workspacePath !== workspacePath || target.path !== selected.path || !target.active) return
                          setSource(nextSource)
                        }}
                        onSelectionChange={setCanvasSelection}
                        onOpenSource={(path) => void openWorkspaceSource(path)}
                        onSearchSources={searchSourceFiles}
                        onAnalyzeGitImpact={() => analyzeGitImpact()}
                        onImportImage={importCanvasImage}
                        onResolveImage={resolveCanvasImage}
                        focusElementIds={canvasFocus?.ids}
                        focusKey={canvasFocus?.key}
                        traceRequest={canvasFocus?.trace ? { ...canvasFocus.trace, key: canvasFocus.key } : undefined}
                        playbackRequest={canvasPlayback?.path === selected.path ? canvasPlayback : null}
                        onPlaybackComplete={(key) => setCanvasPlayback((current) => current?.key === key ? null : current)}
                      />
                    : <MermaidPreview source={source} />}
                </section>
              ) : null}
            </div>
          </>
        ) : (
          <div className="main-empty">
            <div className="empty-graphic"><span /><span /><span /></div>
            <h2>{isThread ? '未打开图表' : '选择或创建一个图表'}</h2>
            <p>{isThread ? '打开当前项目中已保存的图表，或者新建画板。' : '结构化图使用 Mermaid；自由布局的架构草图和说明使用 Canvas 文档。'}</p>
            <div className="empty-actions">
              {isThread ? (
                <>
                  <button className="primary-button" type="button" onClick={openThreadDiagramList}><FolderOpenIcon size={16} />打开已有图表</button>
                  <button type="button" onClick={() => setCreating(true)}>新建图表</button>
                  <button type="button" onClick={() => openAiPanel('generate')}>生成图表</button>
                </>
              ) : (
                <>
                  <button className="primary-button" type="button" onClick={() => setCreating(true)}>新建图表</button>
                  <button type="button" onClick={() => openAiPanel('generate')}>从代码生成</button>
                </>
              )}
            </div>
          </div>
        )}
        <AiPanel
          open={aiOpen}
          returnFocusElement={aiReturnFocus.current}
          selected={selected}
          initialMode={aiMode}
          error={error}
          sending={aiSending}
          generationPreset={generationPreset}
          onSearchSources={searchSourceFiles}
          onClose={() => setAiOpen(false)}
          onGenerate={sendGeneration}
          onModify={sendModification}
        />
        {changeReview && changeReviewOpen ? (
          <ChangeReviewPanel
            before={changeReview.before}
            after={changeReview.after}
            restoring={saving}
            onClose={() => setChangeReviewOpen(false)}
            onRestore={() => void restorePreviousChange()}
          />
        ) : null}
        {aiProposal && proposalReviewOpen ? (
          <ProposalReviewPanel
            before={aiProposal.before}
            after={aiProposal.after}
            reason={aiProposal.summary.reason}
            scopeElementIds={aiProposal.summary.scopeElementIds}
            newElementIds={aiProposal.summary.newElementIds}
            impactElementIds={aiProposal.summary.impactElementIds}
            automaticElementIds={aiProposal.summary.automaticElementIds}
            rebaseable={aiProposal.summary.rebaseable}
            patchSummary={aiProposal.summary.patchSummary}
            branches={proposalBranchSet?.branches}
            activeBranchId={proposalBranchSet?.activeBranchId}
            applying={saving}
            onClose={() => setProposalReviewOpen(false)}
            onAccept={(elementIds) => void acceptAiProposal(elementIds)}
            onReject={() => void dismissAiProposal()}
            onSelectBranch={(branchId) => void selectProposalBranch(branchId)}
            onComposeBranches={(branchIds) => void composeProposalBranches(branchIds)}
          />
        ) : null}
        {selected?.type === 'canvas' && patchHistoryOpen ? (
          <PatchHistoryPanel
            path={selected.path}
            entries={patchHistoryEntries}
            loading={patchHistoryLoading}
            undoingId={patchHistoryUndoingId}
            redoingId={patchHistoryRedoingId}
            onClose={() => setPatchHistoryOpen(false)}
            onRefresh={() => void loadPatchHistory(selected.path)}
            onUndo={(entry) => void undoPatchHistory(entry)}
            onUndoChain={(entry) => void undoPatchHistoryChain(entry)}
            onRedo={(entry) => void redoPatchHistory(entry)}
            onRedoChain={(entry) => void redoPatchHistoryChain(entry)}
            onFocus={(ids) => {
              const live = parseCanvasScene(source)
              const nodeIds = new Set(live.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
              const focusIds = ids.filter((id) => nodeIds.has(id))
              if (focusIds.length) setCanvasFocus({ ids: focusIds, key: `history-focus:${Date.now()}` })
            }}
          />
        ) : null}
        {gitImpactReport && gitImpactOpen ? (
          <GitImpactPanel
            report={gitImpactReport}
            onClose={() => setGitImpactOpen(false)}
            onFocus={(ids) => setCanvasFocus(ids.length ? { ids, key: `impact-focus-${Date.now()}` } : null)}
            onExplain={() => void explainGitImpact()}
            onReanalyze={(baseRef) => void analyzeGitImpact(baseRef)}
            explaining={aiSending}
          />
        ) : null}
        <Dialog open={renaming} onOpenChange={(open) => {
          setRenaming(open)
          if (!open) setRenameTitle('')
        }}>
          <DialogContent showCloseButton={false} className="sm:max-w-md">
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void renameDiagram()
              }}
            >
              <DialogHeader>
                <DialogTitle>重命名图表</DialogTitle>
                <DialogDescription>修改当前图表的显示名称。</DialogDescription>
              </DialogHeader>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="rename-diagram-title">图表名称</FieldLabel>
                  <Input id="rename-diagram-title" autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRenaming(false)}>取消</Button>
                <Button disabled={!renameTitle.trim() || dirty}>保存</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <AlertDialog open={Boolean(selected && deleteConfirmOpen)} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除“{selected?.name ?? ''}”</AlertDialogTitle>
              <AlertDialogDescription>{selected?.path ?? ''}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void deleteDiagram()}>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={Boolean(discardTarget)} onOpenChange={(open) => { if (!open) setDiscardTarget(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>放弃未保存修改？</AlertDialogTitle>
              <AlertDialogDescription>当前图表还有未保存内容。继续后这些修改不会保留。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={discardUnsavedChanges}>放弃并继续</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={isThread && creating} onOpenChange={(open) => setCreating(open)}>
          <DialogContent showCloseButton={false} className="max-h-[calc(100vh-56px)] overflow-hidden p-0 sm:max-w-[760px]">
            <DialogTitle className="sr-only">新建图表</DialogTitle>
            <NewDiagramForm
              key={`thread-new-${snapshot.diagrams.length}`}
              onCancel={() => setCreating(false)}
              onCreate={requestCreateDiagram}
            />
          </DialogContent>
        </Dialog>
      </section>
    </main>
  )
}

type NewDiagramChoice = {
  key: string
  label: string
  meta: string
  type: DiagramType
  canvasWorkbench?: CanvasWorkbenchMode
}

const canvasWorkbenchChoices: NewDiagramChoice[] = [
  { key: 'canvas:architecture', label: '系统架构', meta: '组件 · 边界 · 依赖', type: 'canvas', canvasWorkbench: 'architecture' },
  { key: 'canvas:flowchart', label: '流程画布', meta: '流程 · 连线 · 泳道', type: 'canvas', canvasWorkbench: 'flowchart' },
  { key: 'canvas:freeform', label: '自由画布', meta: '通用绘图', type: 'canvas', canvasWorkbench: 'freeform' },
]

const newDiagramChoiceGroups = [
  { key: 'canvas', label: '画布', items: canvasWorkbenchChoices },
  ...diagramTypeGroups.filter((group) => group.category !== 'canvas').map((group) => ({
    key: group.category,
    label: group.label,
    items: group.items.map((item) => ({
      key: `mermaid:${item.type}`,
      label: item.type === 'flowchart' ? '自动布局流程图' : item.label,
      meta: '自动布局',
      type: item.type,
    } satisfies NewDiagramChoice)),
  })),
]

function NewDiagramForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) => Promise<void> }) {
  const [choice, setChoice] = useState<NewDiagramChoice | null>(null)
  const [previewChoice, setPreviewChoice] = useState<NewDiagramChoice | null>(null)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const visiblePreview = previewChoice ?? choice

  function resetChoice() {
    if (submitting) return
    setChoice(null)
    setPreviewChoice(null)
    setTitle('')
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choice || !title.trim()) return
    setSubmitting(true)
    void onCreate(choice.type, title, choice.canvasWorkbench).finally(() => setSubmitting(false))
  }

  return (
    <div className="new-diagram-form">
      <div className="new-diagram-form-head">
        <strong>新建图表</strong>
        <IconButton icon={XIcon} label="关闭新建图表" onClick={onCancel} />
      </div>
      <div className="new-diagram-browser">
        <div className="new-diagram-type-groups" aria-label="图表类型">
          {newDiagramChoiceGroups.map((group) => (
            <section className="new-diagram-type-group" key={group.key}>
              <span>{group.label}</span>
              <div>
                {group.items.map((item) => (
                  <Button
                    key={item.key}
                    type="button"
                    variant={choice?.key === item.key ? 'default' : 'secondary'}
                    className="h-auto min-h-10 justify-between px-3 py-2 text-left"
                    onClick={() => {
                      setChoice(item)
                      setPreviewChoice(null)
                      setTitle('')
                    }}
                    onMouseEnter={() => setPreviewChoice(item)}
                    onMouseLeave={() => setPreviewChoice(null)}
                    onFocus={() => setPreviewChoice(item)}
                    onBlur={() => setPreviewChoice(null)}
                  >
                    <strong className="min-w-0 truncate font-medium">{item.label}</strong>
                    <small className="text-xs text-muted-foreground max-[620px]:hidden">{item.meta}</small>
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DiagramChoicePreview choice={visiblePreview} />
      </div>
      <Dialog open={Boolean(choice)} onOpenChange={(open) => { if (!open) resetChoice() }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogDescription>{choice?.label}</DialogDescription>
              <DialogTitle>输入图表名称</DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="new-diagram-title">图表名称</FieldLabel>
                <Input id="new-diagram-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：企业知识平台系统架构" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={resetChoice}>返回</Button>
              <Button disabled={submitting || !title.trim()}>{submitting ? '创建中…' : '确认'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DiagramChoicePreview({ choice }: { choice: NewDiagramChoice | null }) {
  return (
    <aside className={`new-diagram-preview${choice ? ' has-preview' : ''}`} aria-live="polite">
      {choice ? (
        <div key={choice.key} className="new-diagram-preview-content">
          <div className="new-diagram-preview-stage">
            {choice.type === 'canvas'
              ? <CanvasChoicePreview workbench={choice.canvasWorkbench ?? 'freeform'} />
              : <MermaidChoicePreview type={choice.type} label={choice.label} />}
          </div>
          <div className="new-diagram-preview-caption">
            <strong>{choice.label}</strong>
            <span>{choice.meta}</span>
          </div>
        </div>
      ) : (
        <div className="new-diagram-preview-empty">
          <span className="new-diagram-preview-empty-mark" />
          <strong>图表预览</strong>
          <span>悬停在类型上查看结构示例</span>
        </div>
      )}
    </aside>
  )
}

function CanvasChoicePreview({ workbench }: { workbench: CanvasWorkbenchMode }) {
  if (workbench === 'architecture') {
    return (
      <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
        <rect className="preview-boundary" x="20" y="20" width="240" height="140" rx="12" />
        <rect className="preview-node is-accent" x="42" y="66" width="58" height="36" rx="8" />
        <rect className="preview-node" x="121" y="46" width="64" height="36" rx="8" />
        <rect className="preview-node" x="121" y="106" width="64" height="36" rx="8" />
        <rect className="preview-node is-data" x="207" y="76" width="34" height="48" rx="8" />
        <path className="preview-line" d="M100 84 H110 V64 H121" />
        <path className="preview-line" d="M100 84 H110 V124 H121" />
        <path className="preview-line" d="M185 64 H196 V100 H207" />
        <path className="preview-line" d="M185 124 H196 V100" />
      </svg>
    )
  }
  if (workbench === 'flowchart') {
    return (
      <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
        <rect className="preview-node is-accent" x="20" y="72" width="54" height="34" rx="17" />
        <rect className="preview-node" x="104" y="68" width="66" height="42" rx="8" />
        <path className="preview-decision" d="M210 58 242 89 210 120 178 89Z" />
        <path className="preview-line" d="M74 89 H104" />
        <path className="preview-line" d="M170 89 H178" />
        <path className="preview-line" d="M210 120 V145 H130" />
        <circle className="preview-dot" cx="130" cy="145" r="5" />
      </svg>
    )
  }
  return (
    <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
      <rect className="preview-node is-accent" x="38" y="38" width="78" height="48" rx="10" transform="rotate(-4 77 62)" />
      <circle className="preview-shape" cx="188" cy="66" r="30" />
      <path className="preview-free-line" d="M70 130 C108 105 150 152 218 122" />
      <rect className="preview-note" x="165" y="112" width="68" height="40" rx="7" transform="rotate(3 199 132)" />
    </svg>
  )
}

function MermaidChoicePreview({ type, label }: { type: MermaidDiagramType; label: string }) {
  const container = useRef<HTMLDivElement>(null)
  const renderId = useMemo(() => `diagram-choice-${Math.random().toString(36).slice(2)}`, [])

  useEffect(() => {
    let cancelled = false
    let handle: number | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      handle = window.setTimeout(() => {
        void renderMermaidSvg(createTemplate(type, label), `${renderId}-${Date.now()}`, () => cancelled)
          .then((markup) => {
            if (cancelled || !container.current) return
            const svg = createSafeSvgElement(markup)
            svg.removeAttribute('width')
            svg.removeAttribute('height')
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
            container.current.replaceChildren(svg)
          })
          .catch(() => {
            if (!cancelled && container.current) container.current.replaceChildren()
          })
      }, 90)
    }, { rootMargin: '120px' })
    if (container.current) observer.observe(container.current)
    return () => {
      cancelled = true
      observer.disconnect()
      if (handle !== undefined) window.clearTimeout(handle)
    }
  }, [label, renderId, type])

  return <div ref={container} className="new-diagram-preview-mermaid" aria-hidden="true" />
}

function ModeButton({ value, mode, onChange, children }: { value: ViewMode; mode: ViewMode; onChange: (value: ViewMode) => void; children: ReactNode }) {
  return <button type="button" className={mode === value ? 'is-active' : ''} onClick={() => onChange(value)}>{children}</button>
}

function MermaidPreview({ source }: { source: string }) {
  const container = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [themeRevision, setThemeRevision] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [svgSize, setSvgSize] = useState({ width: 1, height: 1 })
  const [dragging, setDragging] = useState(false)
  const dragState = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null)
  const renderId = useMemo(() => `diagram-${Math.random().toString(36).slice(2)}`, [])
  const quality = useMemo(() => assessMermaidVisualQuality(detectDiagramType(source), source), [source])

  function centerAt(nextZoom: number) {
    const surface = viewport.current
    if (!surface) return
    const clamped = clampZoom(nextZoom)
    setZoom(clamped)
    setOffset({
      x: (surface.clientWidth - svgSize.width * clamped) / 2,
      y: (surface.clientHeight - svgSize.height * clamped) / 2,
    })
  }

  function fit() {
    const surface = viewport.current
    if (!surface || svgSize.width <= 1 || svgSize.height <= 1) return
    const horizontal = Math.max(80, surface.clientWidth - 96) / svgSize.width
    const vertical = Math.max(80, surface.clientHeight - 96) / svgSize.height
    centerAt(Math.min(horizontal, vertical, 1.35))
  }

  function zoomBy(factor: number) {
    const surface = viewport.current
    if (!surface) return
    const next = clampZoom(zoom * factor)
    const cx = surface.clientWidth / 2
    const cy = surface.clientHeight / 2
    const ratio = next / zoom
    setOffset({ x: cx - (cx - offset.x) * ratio, y: cy - (cy - offset.y) * ratio })
    setZoom(next)
  }

  useEffect(() => {
    const onTheme = () => setThemeRevision((value) => value + 1)
    window.addEventListener('diagram-theme-change', onTheme)
    return () => window.removeEventListener('diagram-theme-change', onTheme)
  }, [])

  useEffect(() => {
    let cancelled = false
    const handle = window.setTimeout(() => {
      void render()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }

    async function render() {
      if (!container.current) return
      try {
        const svg = await renderMermaidSvg(source, `${renderId}-${Date.now()}`, () => cancelled)
        if (cancelled || !container.current) return
        const svgElement = createSafeSvgElement(svg)
        const viewBox = svgElement.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
        const width = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : Number.parseFloat(svgElement.getAttribute('width') || '800')
        const height = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : Number.parseFloat(svgElement.getAttribute('height') || '500')
        svgElement.removeAttribute('width')
        svgElement.removeAttribute('height')
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
        container.current.replaceChildren(svgElement)
        setSvgSize({ width: Math.max(1, width), height: Math.max(1, height) })
        setError(null)
        window.requestAnimationFrame(() => {
          const surface = viewport.current
          if (!surface) return
          const nextZoom = Math.min(
            Math.max(80, surface.clientWidth - 96) / Math.max(1, width),
            Math.max(80, surface.clientHeight - 96) / Math.max(1, height),
            1.35,
          )
          const clamped = clampZoom(nextZoom)
          setZoom(clamped)
          setOffset({
            x: (surface.clientWidth - Math.max(1, width) * clamped) / 2,
            y: (surface.clientHeight - Math.max(1, height) * clamped) / 2,
          })
        })
      } catch (cause) {
        if (cancelled || !container.current) return
        container.current.replaceChildren()
        setError(cleanMermaidError(errorMessage(cause)))
      }
    }
  }, [source, renderId, themeRevision])

  return (
    <div
      ref={viewport}
      className={`preview-surface${dragging ? ' is-dragging' : ''}`}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('.canvas-controls')) return
        dragState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const drag = dragState.current
        if (!drag || drag.pointerId !== event.pointerId) return
        setOffset({ x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y })
      }}
      onPointerUp={(event) => {
        if (dragState.current?.pointerId === event.pointerId) dragState.current = null
        setDragging(false)
      }}
      onPointerCancel={() => { dragState.current = null; setDragging(false) }}
      onWheel={(event) => {
        event.preventDefault()
        if (event.metaKey || event.ctrlKey) {
          zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
          return
        }
        setOffset((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }))
      }}
    >
      <div className="canvas-controls" aria-label="画布控制">
        <button type="button" title="缩小" aria-label="缩小" onClick={() => zoomBy(1 / 1.16)}>−</button>
        <button type="button" className="zoom-value" title="恢复 100%" onClick={() => centerAt(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" title="放大" aria-label="放大" onClick={() => zoomBy(1.16)}>＋</button>
        <span className="canvas-control-separator" />
        <button type="button" title="适配画布" onClick={fit}>适配</button>
      </div>
      {!error && quality.splitRecommended ? (
        <div className="mermaid-quality-chip" role="status" title={quality.reasons.join('；')}>建议拆图</div>
      ) : null}
      {error ? <div className="syntax-error"><strong>预览渲染失败</strong><span>{error}</span></div> : null}
      <div
        className="mermaid-stage"
        style={{
          width: `${svgSize.width}px`,
          height: `${svgSize.height}px`,
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
        }}
      >
        <div ref={container} className="mermaid-canvas" />
      </div>
    </div>
  )
}

const queueMermaidRender = createMermaidRenderQueue()

function renderMermaidSvg(source: string, renderId: string, isObsolete?: () => boolean): Promise<string> {
  return queueMermaidRender(async () => {
    const styles = getComputedStyle(document.documentElement)
    const type = detectDiagramType(source)
    const renderSource = normalizeMermaidSourceForRender(type, source)
    const visualConfig = mermaidVisualConfig(type, {
      background: resolveCssColor('--app-bg', '#ffffff'),
      surface: resolveCssColor('--surface-panel', '#fafafa'),
      raised: resolveCssColor('--surface-raised', '#f5f5f5'),
      muted: resolveCssColor('--surface-muted', '#eeeeee'),
      text: resolveCssColor('--text-primary', '#171717'),
      secondaryText: resolveCssColor('--text-secondary', '#666666'),
      border: resolveCssColor('--border', '#d4d4d4'),
      strongBorder: resolveCssColor('--border-strong', '#b8b8b8'),
      accent: resolveCssColor('--accent', '#2563eb'),
      success: resolveCssColor('--editor-string', '#16803a'),
      warning: resolveCssColor('--editor-type', '#b45309'),
      danger: resolveCssColor('--danger', '#c9362b'),
    }, renderSource)
    mermaid.initialize({
      ...visualConfig,
      fontFamily: visualConfig.fontFamily ?? (styles.getPropertyValue('--font-sans').trim() || 'ui-sans-serif, system-ui'),
    })
    const result = await mermaid.render(renderId, renderSource || 'flowchart LR\n  A[空图表]')
    return fitMermaidSvgToContent(serializeSafeSvg(result.svg), visualConfig.themeVariables?.background)
  }, isObsolete)
}

function createSafeSvgElement(markup: string): SVGSVGElement {
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  const svg = template.content.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) throw new Error('Mermaid 没有返回可渲染的 SVG。')
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (Array.from(clone.querySelectorAll('*')).some((element) => element.hasAttribute('xlink:href'))) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  clone.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove())
  const elements = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return clone
}

function serializeSafeSvg(markup: string): string {
  return new XMLSerializer().serializeToString(createSafeSvgElement(markup))
}

async function renderCanvasSvg(source: string, workspacePath: string): Promise<string> {
  const scene = parseCanvasScene(source)
  const imagePaths = [...new Set(scene.elements.flatMap((item) => item.type === 'note' && item.imagePath ? [item.imagePath] : []))]
  const imageSources = Object.fromEntries(await Promise.all(imagePaths.map(async (path) => {
    const result = await callTool<DiagramImageAssetContentResult>('diagram.readImageAsset', { workspacePath, path })
    return [path, `data:${result.mimeType};base64,${result.content}`] as const
  })))
  return canvasSceneToSvg(scene, {
    background: resolveCssColor('--app-bg', '#ffffff'),
    panel: resolveCssColor('--surface-raised', '#f5f5f5'),
    text: resolveCssColor('--text-primary', '#171717'),
    border: resolveCssColor('--border-strong', '#8a8a8a'),
    note: '#fff4b8',
    imageSources,
  })
}

async function svgToPngBase64(svg: string, background: string): Promise<string> {
  const root = createSafeSvgElement(svg)
  const normalizedSvg = new XMLSerializer().serializeToString(root)
  const viewBox = root.getAttribute('viewBox')?.trim().split(/\s+/).map(Number)
  const sourceWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2])
    ? Math.max(1, viewBox[2])
    : Math.max(1, Number.parseFloat(root.getAttribute('width') || '1200'))
  const sourceHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3])
    ? Math.max(1, viewBox[3])
    : Math.max(1, Number.parseFloat(root.getAttribute('height') || '800'))
  const scale = Math.min(2, 8192 / sourceWidth, 8192 / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  // MCP Apps run under a restrictive CSP. A blob: URL can be rejected by the
  // host even though the SVG was produced locally, while an inline data URL
  // remains self-contained and needs no resource-domain permission.
  const imageUrl = `data:image/svg+xml;base64,${utf8ToBase64(normalizedSvg)}`
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('浏览器无法载入 Mermaid SVG。'))
    image.src = imageUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持 PNG 画布导出。')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 编码失败。')), 'image/png')
  })
  return blobToBase64(png)
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function resolveCssColor(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  probe.style.color = value
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return normalizeMermaidColor(resolved, fallback)
}

function clampZoom(value: number): number {
  return Math.min(4, Math.max(0.2, value))
}

class RuntimeErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-shell"><strong>Diagram 渲染失败</strong><pre>{this.state.error.stack ?? this.state.error.message}</pre></main>
  }
}

async function callTool<T>(name: string, arguments_: Record<string, unknown>): Promise<T> {
  const result = await host.callServerTool({ name, arguments: arguments_ }) as ServerToolResult
  const serverError = extractToolResultError(result)
  if (serverError) throw new Error(serverError)
  const payload = extractToolResultPayload<T>(result)
  if (payload === undefined) throw new Error(`${name} 没有返回可解析结果。`)
  return payload
}

async function sendHostMessage(text: string): Promise<void> {
  if (!host.sendMessage) throw new Error('当前宿主没有提供对话消息能力。')
  await host.sendMessage(text)
}

function diagramLabel(type: DiagramSummary['type']): string {
  return diagramTypes.find((item) => item.type === type)?.label ?? '图表'
}

function diagramSummaryLabel(diagram: DiagramSummary): string {
  if (diagram.type !== 'canvas') return diagramLabel(diagram.type)
  if (diagram.canvasWorkbench === 'architecture') return '系统架构'
  if (diagram.canvasWorkbench === 'flowchart') return '流程画布'
  return diagram.canvasWorkbench === 'freeform' ? '自由画布' : '画布'
}

function diagramDocumentLabel(diagram: DiagramDocument): string {
  if (diagram.type !== 'canvas' || diagram.canvasWorkbench) return diagramSummaryLabel(diagram)
  try {
    const workbench = parseCanvasScene(diagram.source).workbench
    if (workbench === 'architecture') return '系统架构'
    if (workbench === 'flowchart') return '流程画布'
    return '自由画布'
  } catch {
    return '画布'
  }
}

function playbackActivityLabel(kind: NonNullable<DiagramThreadStateResult['activity']>['kind']): string {
  if (kind === 'create') return 'AI 正在创建画板'
  if (kind === 'source-sync') return 'AI 正在同步源码节点'
  if (kind === 'proposal') return 'AI 正在应用候选修改'
  if (kind === 'history-undo') return '正在撤销 AI 修改'
  if (kind === 'history-redo') return '正在重做 AI 修改'
  return 'AI 正在更新画板'
}

function shortPath(value: string): string {
  const parts = value.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
}

function safeFilename(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'diagram'
}

function resolveWorkspaceFilePath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.')
  if (normalized.some((part) => part === '..')) throw new Error('图表路径超出当前工作空间。')
  const windowsRoot = /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\')
  const separator = windowsRoot ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${normalized.join(separator)}`
}

function cleanMermaidError(value: string): string {
  return value.replace(/^Error:\s*/i, '').split('\n').slice(0, 3).join(' ').trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function renderBootStatus(message: string) {
  const root = document.getElementById('root')
  if (root) root.innerHTML = `<main class="boot-shell">${escapeHtml(message)}</main>`
}

function renderFatalError(error: unknown) {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `<main class="fatal-shell"><strong>Diagram 启动失败</strong><pre>${escapeHtml(errorMessage(error))}</pre></main>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}
