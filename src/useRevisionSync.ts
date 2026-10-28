import { useEffect, useRef, useState } from 'react'
import { errorMessage } from './errors.js'
import { playbackActivityLabel } from './playbackLabels.js'
import { callTool } from './hostRuntime.js'
import type { DiagramDocument, WorkspaceSnapshot } from './types.js'
import type { DiagramListResult, DiagramResult, DiagramRevisionResult, DiagramThreadActivityKind } from './reviewTypes.js'

export type SyncChannel = 'thread' | 'revision'

/** A background channel only surfaces after three consecutive failures. */
const QUIET_FAILURES = 3

export interface RevisionSyncDeps {
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (next: WorkspaceSnapshot | ((current: WorkspaceSnapshot) => WorkspaceSnapshot)) => void
  selected: DiagramDocument | null
  panelVisible: boolean
  saving: boolean
  dirty: boolean
  externalDeleted: boolean
  pendingActivity: React.RefObject<{ key: string; path: string; kind: DiagramThreadActivityKind; modifiedAt?: string } | undefined>
  adoptSynced: (diagram: DiagramDocument) => void
  setDeletedDraftPath: (path: string | null) => void
  setSelected: (diagram: DiagramDocument | null) => void
  setSource: (source: string) => void
  setExternalChange: (value: boolean) => void
  setChangeReview: (review: { before: DiagramDocument; after: DiagramDocument } | null) => void
  setCanvasPlayback: (request: { key: string; path: string; mode: 'create' | 'update'; fromSource?: string; label?: string } | null) => void
  setNotice: (message: string | null) => void
  selectDiagram: (diagramPath: string, force?: boolean, remember?: boolean) => Promise<void>
}

export interface RevisionSync {
  syncIssue: string | null
  succeeded: (channel: SyncChannel) => void
  failed: (channel: SyncChannel) => void
}

/**
 * Keeping the open document honest about what is on disk.
 *
 * Both background channels (conversation follow, file revision) share one failure
 * budget, so a panel that is merely reconnecting never shouts at the user.
 */
export function useRevisionSync(deps: RevisionSyncDeps): RevisionSync {
  const {
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
  } = deps

  const [syncIssue, setSyncIssue] = useState<string | null>(null)
  const backgroundFailures = useRef<Record<SyncChannel, number>>({ thread: 0, revision: 0 })

  function succeeded(channel: SyncChannel) {
    backgroundFailures.current[channel] = 0
    if (backgroundFailures.current.thread < QUIET_FAILURES && backgroundFailures.current.revision < QUIET_FAILURES) setSyncIssue(null)
  }

  function failed(channel: SyncChannel) {
    backgroundFailures.current[channel] += 1
    if (backgroundFailures.current[channel] < QUIET_FAILURES) return
    setSyncIssue(channel === 'thread' ? '对话联动正在重试' : '文件同步正在重试')
  }

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
          succeeded('revision')
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
              const activity = pendingActivity.current
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
              if (activity?.path === selected.path) pendingActivity.current = undefined
            }
          }
          adoptSynced(latest.diagram)
          onSnapshot({
            ...snapshot,
            diagrams: snapshot.diagrams.map((item) => item.path === latest.diagram.path ? latest.diagram : item),
          })
          setNotice('已同步磁盘上的最新修改')
        })
        .catch(async () => {
          if (disposed) return
          if (externalDeleted) return
          failed('revision')
          if (reportedError) return
          reportedError = true
          try {
            const listed = await callTool<DiagramListResult>('diagram.list', { workspacePath })
            if (disposed) return
            if (!listed.diagrams.some((diagram) => diagram.path === selected.path)) {
              if (dirty) {
                setDeletedDraftPath(selected.path)
                setExternalChange(false)
                succeeded('revision')
                return
              }
              const fallback = listed.diagrams[0]
              onSnapshot({ ...snapshot, diagrams: listed.diagrams, activeDiagramPath: fallback?.path })
              setSelected(null)
              setSource('')
              setExternalChange(false)
              succeeded('revision')
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

  return { syncIssue, succeeded, failed }
}
