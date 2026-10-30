import { fitMermaidSvgToContent } from './mermaidSvg.js'
import { diagramVisualStyles } from './diagramVisualStyles.js'
import React, { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PatchHistoryPanel, GitImpactPanel, ChangeReviewPanel, ProposalReviewPanel } from './ReviewPanels.js'
import type {
  DiagramGitImpactResult,
  DiagramPatchHistoryChainRedoResult,
  DiagramPatchHistoryChainUndoResult,
  DiagramPatchHistoryEntry,
  DiagramPatchHistoryRedoResult,
  DiagramPatchHistoryResult,
  DiagramPatchHistoryUndoResult,
  DiagramListResult,
  DiagramProposalBranchSet,
  DiagramProposalSourceResult,
  DiagramProposalRefreshResult,
  DiagramProposalSummary,
  DiagramResult,
  DiagramThreadStateResult,
} from './reviewTypes.js'
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
import { summarizeMermaidQuality } from './diagramQuality.js'
import { mermaidVisualConfig, normalizeMermaidSourceForRender, resolveMermaidVisualStyle, setMermaidVisualStyle, type MermaidVisualStyle } from './mermaidVisualGrammar.js'
import { createTemplate, detectDiagramType } from './templates.js'
import { extractToolResultError, extractToolResultPayload, type ToolResultLike } from './toolResult.js'
import { decideThreadFollow } from './threadFollow.js'
import { panelFeedbackFromState, type FeedbackActionId } from './panelFeedback.js'
import { guardPatchHistory, patchHistoryNotice } from './patchHistoryPlan.js'
import { planThreadTabClose, planThreadTabs } from './threadTabPlan.js'
import { usePatchHistory } from './usePatchHistory.js'
import { useDocumentSession } from './useDocumentSession.js'
import { useThreadFollow } from './useThreadFollow.js'
import { useThreadTabs } from './useThreadTabs.js'
import { ThreadHeader } from './ThreadHeader.js'
import { EditorToolbar } from './EditorToolbar.js'
import { EmptyState, FeedbackBar } from './PanelSurfaces.js'
import { EditorPanes, PreviewPane, SourcePane } from './EditorPanes.js'
import { DiagramSidebar } from './DiagramSidebar.js'
import { DocumentDialogs } from './DocumentDialogs.js'
import { createSafeSvgElement, renderMermaidSvg, resolveCssColor, serializeSafeSvg } from './mermaidRender.js'
import { NewDiagramDialog, NewDiagramForm } from './NewDiagramBrowser.js'
import { errorMessage } from './errors.js'
import { useDocumentCommands, type DiscardTarget } from './useDocumentCommands.js'
import { callTool, host, hostSurface, sendHostMessage } from './hostRuntime.js'
import { cleanMermaidError, useDiagramArtifacts } from './useDiagramArtifacts.js'
import { useAiProposalCommands } from './useAiProposalCommands.js'
import { useDiagramSync } from './useDiagramSync.js'
import { useGitImpact } from './useGitImpact.js'
import { useAiRequests } from './useAiRequests.js'
import { useRevisionSync } from './useRevisionSync.js'
import { usePanelStore } from './panelStore.js'
import { playbackActivityLabel } from './playbackLabels.js'
import { diagramCapability } from './diagramCapabilities.js'
import { resolveEditorPolicy, viewModeLabel, type ViewMode } from './editorPolicy.js'
import { readViewPreferences, viewPreferenceScope, viewPreferenceStorage, writeViewPreferences } from './viewPreferences.js'
import { useElementWidth } from './useElementWidth.js'
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

interface SourceFilesResult {
  kind: 'source-files'
  workspacePath: string
  files: string[]
}

const rootElement = document.getElementById('root')!
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
  const surface: DiagramSurface = snapshot.surface ?? hostSurface
  const threadSurface = surface === 'thread'
  const panelVisible = useDiagramVisibility()
  const session = useDocumentSession()
  const {
    document: selected,
    source,
    loadingPath,
    saving,
    error,
    externalChange,
    deletedDraftPath,
    dirty,
    externalDeleted,
    setSelected,
    setSource,
    setSaving,
    setError,
    setExternalChange,
    setDeletedDraftPath,
    setLoadingPath,
    adoptSaved,
    adoptSynced,
  } = session
  const shellRef = useRef<HTMLElement>(null)
  // Pre-measurement estimate: a thread panel is narrow, a workspace window is not.
  const shellWidth = useElementWidth(shellRef, threadSurface ? 420 : 1200)
  const capability = diagramCapability(selected?.type)
  const policy = resolveEditorPolicy({ surface, width: shellWidth, capability })
  const [mode, setMode] = useState<ViewMode>(() => policy.defaultMode)
  const canvasActive = mode !== 'source' && (!loadingPath || loadingPath === selected?.path)
  const canvasWriteTarget = useRef({ workspacePath, path: selected?.path, active: canvasActive })
  canvasWriteTarget.current = { workspacePath, path: selected?.path, active: canvasActive }
  const panel = usePanelStore()
  const {
    creating, sidebarCollapsed, diagramQuery, aiOpen, aiMode, generationPreset, aiSending, notice, exporting,
    splitPercent, sourceSearchRequest, documentMenuOpen, renaming, renameTitle, deleteConfirmOpen,
    threadDiagramMenuOpen, threadDiagramQuery, threadDiagramListLoading, threadDiagramListError,
    canvasSelection, canvasFocus, canvasPlayback, gitImpactReport, gitImpactOpen,
    aiProposal, proposalBranchSet, proposalReviewOpen, changeReview, changeReviewOpen, discardTarget,
  } = panel.state
  const {
    setCreating, setSidebarCollapsed, setDiagramQuery, setAiOpen, setAiMode, setGenerationPreset, setAiSending,
    setNotice, setExporting, setSplitPercent, setSourceSearchRequest, setDocumentMenuOpen, setRenaming,
    setRenameTitle, setDeleteConfirmOpen, setThreadDiagramMenuOpen, setThreadDiagramQuery,
    setThreadDiagramListLoading, setThreadDiagramListError, setCanvasSelection, setCanvasFocus, setCanvasPlayback,
    setGitImpactReport, setGitImpactOpen, setAiProposal, setProposalBranchSet, setProposalReviewOpen,
    setChangeReview, setChangeReviewOpen, setDiscardTarget,
  } = panel.setters
  const aiReturnFocus = useRef<HTMLElement | null>(null)
  const threadMoreButton = useRef<HTMLButtonElement>(null)
  // Following belongs to the conversation, not whichever document happens to be open.
  const [followConversation, setFollowConversation] = useState(
    () => readViewPreferences(viewPreferenceStorage(), viewPreferenceScope(surface))?.follow ?? true,
  )
  const [followPaused, setFollowPaused] = useState(false)
  const preferenceScope = viewPreferenceScope(surface, selected?.path)
  const [loadedPreferenceScope, setLoadedPreferenceScope] = useState(preferenceScope)
  useEffect(() => {
    const stored = readViewPreferences(viewPreferenceStorage(), preferenceScope)
    // A new document must not inherit the previous document's split layout.
    // Only an explicit per-document preference may override the capability default.
    setMode(stored?.mode ?? policy.defaultMode)
    setLoadedPreferenceScope(preferenceScope)
  }, [preferenceScope, policy.defaultMode])
  useEffect(() => {
    if (loadedPreferenceScope === preferenceScope) {
      writeViewPreferences(viewPreferenceStorage(), preferenceScope, { mode, follow: true })
    }
  }, [loadedPreferenceScope, mode, preferenceScope])
  useEffect(() => {
    writeViewPreferences(viewPreferenceStorage(), viewPreferenceScope(surface), { mode: 'preview', follow: followConversation })
  }, [followConversation, surface])
  const threadTabsElement = useRef<HTMLDivElement>(null)
  const selectRequestSeq = useRef(0)
  const saveInFlight = useRef(false)
  const patchHistoryRequestSeq = useRef(0)
  useEffect(() => () => { selectRequestSeq.current += 1 }, [])
  useEffect(() => {
    if (threadSurface && rootElement.dataset.diagramHost === 'deepseek') {
      window.parent.postMessage({ type: 'diagram.unsaved', unsaved: dirty }, '*')
    }
  }, [dirty, threadSurface])
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
  const threadTabs = useThreadTabs({
    threadSurface,
    workspacePath,
    snapshot,
    initialTabs: snapshot.threadDiagramPaths,
    session,
    callTool,
    selectDiagram,
    requestSeq: selectRequestSeq,
    onDiscardRequest: (path) => setDiscardTarget({ kind: 'close-thread', path }),
    setError,
  })
  const threadMenuGroups = useMemo(() => {
    const byPath = new Map(snapshot.diagrams.map((diagram) => [diagram.path, diagram]))
    const recentFirst = (diagrams: DiagramSummary[]) => [...diagrams].sort((left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name))
    const current = threadTabs.tabs.flatMap((path) => {
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
  }, [snapshot.diagrams, threadDiagramQuery, threadTabs.tabs])

  useEffect(() => {
    const tabs = threadTabsElement.current
    if (!tabs) return
    const revealActive = () => tabs.querySelector('.thread-diagram-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealActive()
    const observer = new ResizeObserver(revealActive)
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [selected?.path, threadTabs.tabs.length])

  useEffect(() => {
    selectRequestSeq.current += 1
    patchHistoryRequestSeq.current += 1
    setSelected(null)
    setDeletedDraftPath(null)
    // Everything workspace-scoped dies with the workspace; the store owns the list.
    panel.resetWorkspace()
    threadFollow.resetTracking()
    setPatchHistoryOpen(false)
    setPatchHistoryEntries([])
    setPatchHistoryLoading(false)
    setPatchHistoryUndoingId(null)
    setSource('')
    setExternalChange(false)
    const initialDiagram = snapshot.activeDiagramPath
      ? snapshot.diagrams.find((diagram) => diagram.path === snapshot.activeDiagramPath)
      : undefined
    if (initialDiagram) {
      void selectDiagram(initialDiagram.path, true)
    } else if (!threadSurface && snapshot.diagrams[0]) {
      void selectDiagram(snapshot.diagrams[0].path, true)
    }
    // Workspace changes intentionally discard selection from the previous project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])


  useEffect(() => {
    if (!selected || !capability.visualEdit) {
      if (canvasSelection) setCanvasSelection(null)
    }
  }, [canvasSelection, selected])

  const threadFollow = useThreadFollow({
    threadSurface,
    panelVisible,
    workspacePath,
    snapshot,
    onSnapshot,
    session,
    proposal: aiProposal,
    impact: gitImpactReport,
    followConversation,
    initialSkipRestored: threadSurface
      && (host.getHostContext() as HostContext & { diagramOpenMode?: string }).diagramOpenMode === 'fresh',
    callTool,
    selectDiagram,
    setThreadTabs: threadTabs.setTabs,
    setAiProposal,
    setProposalBranchSet,
    setProposalReviewOpen,
    setGitImpactReport,
    setGitImpactOpen,
    setNotice,
    setFollowPaused,
    setCanvasFocus,
    onSyncSucceeded: () => revisionSync.succeeded('thread'),
    onSyncFailed: () => revisionSync.failed('thread'),
  })
  const { pendingActivity } = threadFollow

  useEffect(() => {
    if (!threadSurface || !panelVisible || selected || dirty || snapshot.diagrams.length > 0) return
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
  }, [dirty, threadSurface, onSnapshot, panelVisible, selected, snapshot, workspacePath])

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

  const revisionSync = useRevisionSync({
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    panelVisible,
    saving,
    dirty,
    externalDeleted,
    pendingActivity,
    adoptSynced,
    setDeletedDraftPath,
    setSelected,
    setSource,
    setExternalChange,
    setChangeReview,
    setCanvasPlayback,
    setNotice,
    selectDiagram,
  })
  const syncIssue = revisionSync.syncIssue


  const rememberThreadTab = threadTabs.rememberTab
  const closeThreadTab = threadTabs.closeTab

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
      const activity = pendingActivity.current
      const matchingActivity = activity?.path === result.diagram.path
        && (!activity.modifiedAt || activity.modifiedAt === result.diagram.modifiedAt)
        ? activity
        : undefined
      if (threadSurface && result.diagram.type === 'canvas' && matchingActivity) {
        const updatingCurrent = selected?.path === result.diagram.path && selected.type === 'canvas'
        setCanvasPlayback({
          key: matchingActivity.key,
          path: result.diagram.path,
          mode: updatingCurrent ? 'update' : 'create',
          ...(updatingCurrent ? { fromSource: selected.source } : {}),
          label: playbackActivityLabel(matchingActivity.kind),
        })
        pendingActivity.current = undefined
      } else if (result.diagram.type !== 'canvas' || selected?.path !== result.diagram.path) {
        setCanvasPlayback(null)
        if (activity?.path === result.diagram.path) pendingActivity.current = undefined
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
      void createDiagram(target.type, target.title, target.canvasWorkbench, target.canvasTemplate)
      return
    }
    void selectDiagram(target.path, true)
  }


  const patchHistory = usePatchHistory({
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    source,
    saving,
    dirty,
    externalChange,
    threadSurface,
    callTool,
    errorMessage,
    requestSeqRef: patchHistoryRequestSeq,
    setSelected,
    setSource,
    setSaving,
    setError,
    setNotice,
    setExternalChange,
    setProposalReviewOpen,
    setChangeReviewOpen,
    setGitImpactOpen,
    setCanvasFocus,
    setCanvasPlayback,
  })
  const patchHistoryEntries = patchHistory.entries
  const setPatchHistoryEntries = patchHistory.setEntries
  const patchHistoryLoading = patchHistory.loading
  const setPatchHistoryLoading = patchHistory.setLoading
  const patchHistoryOpen = patchHistory.open
  const setPatchHistoryOpen = patchHistory.setOpen
  const patchHistoryUndoingId = patchHistory.undoingId
  const setPatchHistoryUndoingId = patchHistory.setUndoingId
  const patchHistoryRedoingId = patchHistory.redoingId
  const setPatchHistoryRedoingId = patchHistory.setRedoingId
  const { loadPatchHistory, openPatchHistory, undoPatchHistory, undoPatchHistoryChain, redoPatchHistory, redoPatchHistoryChain } = patchHistory

  const { acceptAiProposal, dismissAiProposal, selectProposalBranch, composeProposalBranches } = useAiProposalCommands({
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
  })
  const editorWorkspace = useRef<HTMLDivElement>(null)

  const { saveDiagram, reloadSelected, restorePreviousChange, refreshList, refreshThreadDiagramList, openThreadDiagramList } = useDiagramSync({
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    source,
    dirty,
    saving,
    externalChange,
    externalDeleted,
    changeReview,
    saveInFlight,
    requestSeq: selectRequestSeq,
    threadDiagramListLoading,
    adoptSaved,
    adoptSynced,
    setSaving,
    setError,
    setNotice,
    setChangeReview,
    setChangeReviewOpen,
    setThreadDiagramListLoading,
    setThreadDiagramListError,
    setThreadDiagramMenuOpen,
  })


  const searchSourceFiles = useCallback(async (query: string): Promise<string[]> => {
    const result = await callTool<SourceFilesResult>('diagram.sources', { workspacePath, query, limit: 40 })
    return result.files
  }, [workspacePath])

  const { analyzeGitImpact, explainGitImpact, clearGitImpact } = useGitImpact({
    threadSurface,
    workspacePath,
    selected,
    capability,
    gitImpactReport,
    setGitImpactReport,
    setGitImpactOpen,
    setCanvasFocus,
    setAiSending,
    setError,
    setNotice,
  })


  const { createDiagram, requestCreateDiagram, renameDiagram, duplicateDiagram, deleteDiagram } = useDocumentCommands({
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    dirty,
    renameTitle,
    callTool,
    setSelected,
    setSource,
    setDeletedDraftPath,
    setError,
    setNotice,
    setCreating,
    setRenaming,
    setDocumentMenuOpen,
    setDeleteConfirmOpen,
    setDiscardTarget,
    rememberTab: rememberThreadTab,
    renameTab: threadTabs.renameTab,
    selectDiagram,
  })

  const { exportSvg, exportPng, importCanvasImage, resolveCanvasImage, openDiagramFile, openWorkspaceSource } = useDiagramArtifacts({
    workspacePath,
    selected,
    source,
    capability,
    exporting,
    setExporting,
    setError,
    setNotice,
  })



  const { sendGeneration, sendModification, updateSelectedCanvasFromConversation, openAiPanel, openWorkspaceGeneration, explainInConversation, updateFromConversation } = useAiRequests({
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    dirty,
    capability,
    canvasSelection,
    aiSending,
    aiReturnFocus,
    threadMoreButton,
    selectDiagram,
    setAiSending,
    setAiOpen,
    setAiMode,
    setGenerationPreset,
    setError,
    setNotice,
  })


  const feedback = panelFeedbackFromState({
    surface,
    error,
    aiOpen,
    syncIssue,
    externalDeleted,
    externalChange,
    notice,
    changeReview: Boolean(changeReview),
    saving,
    proposal: aiProposal,
    proposalBranchCount: proposalBranchSet?.branches.length ?? 0,
    impact: gitImpactReport,
  })

  function runFeedbackAction(action: FeedbackActionId) {
    switch (action) {
      case 'dismiss-error': setError(null); return
      case 'restore-file': void saveDiagram(); return
      case 'reload-file': void reloadSelected(); return
      case 'review-changes': setChangeReviewOpen(true); return
      case 'review-proposal': setProposalReviewOpen(true); return
      case 'accept-proposal': void acceptAiProposal(); return
      case 'reject-proposal': void dismissAiProposal(); return
      case 'review-impact': setGitImpactOpen(true); return
      case 'clear-impact': void clearGitImpact(); return
    }
  }

  return (
    <main ref={shellRef} className={`diagram-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${threadSurface ? ' thread-companion' : ''}${policy.chrome === 'compact' ? ' compact-chrome' : ''}${policy.splitAxis === 'vertical' ? ' vertical-split' : ''}`}>
      <DiagramSidebar
        workspacePath={workspacePath}
        canSelectWorkspace={host.canSelectWorkspace}
        onRequestWorkspace={requestWorkspaceSwitch}
        onCollapse={() => setSidebarCollapsed(true)}
        onCreateToggle={() => setCreating((value) => !value)}
        creating={creating && !threadSurface ? <NewDiagramForm onCancel={() => setCreating(false)} onCreate={requestCreateDiagram} /> : null}
        query={diagramQuery}
        onQueryChange={setDiagramQuery}
        total={snapshot.diagrams.length}
        visible={visibleDiagrams}
        selectedPath={selected?.path}
        loadingPath={loadingPath}
        onSelect={(path) => void selectDiagram(path)}
        onOpenWorkspaceGeneration={openWorkspaceGeneration}
        onRefresh={() => void refreshList()}
        describe={diagramSummaryLabel}
        shortPath={shortPath}
      />

      {sidebarCollapsed ? (
        <button className="sidebar-expand-button" type="button" title="展开图表栏" aria-label="展开图表栏" onClick={() => setSidebarCollapsed(false)}>›</button>
      ) : null}

      <section className="diagram-main">
        {threadSurface ? (
          <ThreadHeader
            picker={{
              open: threadDiagramMenuOpen,
              onOpenChange: () => {
                setThreadDiagramMenuOpen(false)
                setThreadDiagramQuery('')
                setThreadDiagramListError(null)
              },
              onOpenList: openThreadDiagramList,
              total: snapshot.diagrams.length,
              loading: threadDiagramListLoading,
              error: threadDiagramListError,
              query: threadDiagramQuery,
              onQueryChange: setThreadDiagramQuery,
              onRefresh: () => void refreshThreadDiagramList(),
              groups: threadMenuGroups,
              selectedPath: selected?.path,
              selectedBadge: selectedTypeLabel,
              describe: diagramSummaryLabel,
              shortPath,
              onSelect: (path) => {
                setThreadDiagramMenuOpen(false)
                setThreadDiagramQuery('')
                void selectDiagram(path)
              },
            }}
            tabs={{
              paths: threadTabs.tabs,
              diagrams: snapshot.diagrams,
              selectedPath: selected?.path,
              elementRef: threadTabsElement,
              onSelect: (path) => void selectDiagram(path),
              onClose: closeThreadTab,
            }}
            actions={{
              hasDocument: Boolean(selected),
              dirty,
              saving,
              follow: {
                enabled: followConversation,
                paused: followPaused,
                onToggle: () => setFollowConversation((value) => !value),
              },
              modes: {
                visible: policy.chrome === 'compact',
                value: mode,
                options: policy.modes,
                label: viewModeLabel,
                onChange: setMode,
              },
              moreButtonRef: threadMoreButton,
              aiOpen,
              aiSending,
              exporting,
              capability,
              hasCanvasSelection: Boolean(canvasSelection?.elements.length),
              hasProposal: Boolean(aiProposal),
              hasChanges: Boolean(changeReview),
              style: {
                value: resolveMermaidVisualStyle(source),
                options: [
                  ...diagramVisualStyles.map((entry) => ({ value: entry.id, label: entry.label })),
                  ...([['technical', '工程文档'], ['minimal', '极简'], ['editorial', '叙事'], ['presentation', '汇报']] as const)
                    .map(([value, label]) => ({ value, label })),
                ],
                onChange: (value) => setSource((current) => setMermaidVisualStyle(current, value)),
              },
              commands: {
                openDiagramList: openThreadDiagramList,
                createDiagram: () => setCreating(true),
                generateFromCode: () => openAiPanel('generate'),
                modifyCurrent: () => openAiPanel('modify'),
                updateFromConversation: () => void updateFromConversation(),
                updateSelection: () => void updateSelectedCanvasFromConversation(),
                addFailurePaths: () => void sendModification('结合当前代码事实，为这张图补充真正重要的失败路径、异常分支或回退路径；不要机械增加无关节点。'),
                explainDiagram: () => void explainInConversation(),
                openPatchHistory,
                reviewProposal: () => setProposalReviewOpen(true),
                reviewChanges: () => setChangeReviewOpen(true),
                exportSvg: () => void exportSvg(),
                exportPng: () => void exportPng(),
                save: () => void saveDiagram(),
              },
            }}
          />
        ) : null}
        <FeedbackBar feedback={feedback} onAction={runFeedbackAction} />
        {selected ? (
          <>
            {policy.showWorkspaceTools ? <EditorToolbar
              name={selected.name}
              path={selected.path}
              exporting={exporting}
              onGenerate={() => openAiPanel('generate')}
              onExportSvg={() => void exportSvg()}
              onExportPng={() => void exportPng()}
              styleSelect={{
                visible: capability.styleSelect,
                value: resolveMermaidVisualStyle(source),
                shared: diagramVisualStyles,
                onChange: (value) => setSource((current) => setMermaidVisualStyle(current, value)),
              }}
              mode={{ value: mode, onChange: setMode }}
              changeReview={{ visible: Boolean(changeReview), onOpen: () => setChangeReviewOpen(true) }}
              proposal={{ visible: Boolean(aiProposal), onOpen: () => setProposalReviewOpen(true) }}
              patchHistory={{ visible: capability.patchHistory, open: patchHistoryOpen, onOpen: openPatchHistory }}
              save={{ dirty, saving, onSave: () => void saveDiagram() }}
              menu={{
                open: documentMenuOpen,
                onOpenChange: (open) => {
                  setDocumentMenuOpen(open)
                  if (open) setRenameTitle(selected.name)
                },
                dirty,
                onRename: () => {
                  setRenameTitle(selected.name)
                  setRenaming(true)
                },
                onDuplicate: () => void duplicateDiagram(),
                onDelete: () => setDeleteConfirmOpen(true),
              }}
            /> : null}
            <EditorPanes
              mode={mode}
              splitPercent={splitPercent}
              onSplitChange={setSplitPercent}
              containerRef={editorWorkspace}
              showSource={mode === 'source' || mode === 'split'}
              showPreview={mode === 'preview' || mode === 'split' || capability.visualEdit}
              previewHidden={mode === 'source'}
              sourcePane={<SourcePane
                label={capability.sourceLabel}
                typeLabel={selectedTypeLabel}
                onFind={() => setSourceSearchRequest((value) => value + 1)}
                onOpenFile={() => void openDiagramFile()}
              >
                <MermaidEditor
                  key={selected.path}
                  value={source}
                  onChange={setSource}
                  onSave={() => void saveDiagram()}
                  searchRequest={sourceSearchRequest}
                  syntax={capability.visualEdit ? 'plain' : 'mermaid'}
                  ariaLabel={capability.visualEdit ? '自由画布 JSON 编辑器' : 'Mermaid 源码编辑器'}
                />
              </SourcePane>}
              previewPane={<PreviewPane
                hidden={mode === 'source'}
                head={capability.visualEdit && policy.chrome === 'compact'
                  ? null
                  : { label: capability.previewLabel, status: capability.previewStatusLabel, cramped: policy.cramped }}
              >
                    {capability.visualEdit
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
                      : <MermaidPreview key={selected.path} source={source} />}
              </PreviewPane>}
            />
          </>
        ) : (
          <EmptyState
            threadSurface={threadSurface}
            onOpenList={openThreadDiagramList}
            onCreate={() => setCreating(true)}
            onGenerate={() => openAiPanel('generate')}
          />
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
        <DocumentDialogs
          rename={{
            open: renaming,
            title: renameTitle,
            dirty,
            onOpenChange: (open) => {
              setRenaming(open)
              if (!open) setRenameTitle('')
            },
            onTitleChange: setRenameTitle,
            onSubmit: () => void renameDiagram(),
          }}
          remove={{
            open: Boolean(selected && deleteConfirmOpen),
            name: selected?.name ?? '',
            path: selected?.path ?? '',
            onOpenChange: setDeleteConfirmOpen,
            onConfirm: () => void deleteDiagram(),
          }}
          discard={{
            open: Boolean(discardTarget),
            onOpenChange: (open) => { if (!open) setDiscardTarget(null) },
            onConfirm: discardUnsavedChanges,
          }}
        />
        <NewDiagramDialog
          open={threadSurface && creating}
          openKey={snapshot.diagrams.length}
          onOpenChange={setCreating}
          onCancel={() => setCreating(false)}
          onCreate={requestCreateDiagram}
        />
      </section>
    </main>
  )
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
  const quality = useMemo(() => {
    const type = detectDiagramType(source)
    return type === 'unknown' ? undefined : summarizeMermaidQuality(type, assessMermaidVisualQuality(type, source))
  }, [source])

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
      {!error && quality?.needsRevision ? (
        <div className="mermaid-quality-chip" role="status" title={quality.findings.map((issue) => issue.message).join('；')}>建议拆图</div>
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

function shortPath(value: string): string {
  const parts = value.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
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
