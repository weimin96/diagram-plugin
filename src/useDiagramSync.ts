import { errorMessage } from './errors.js'
import { callTool } from './hostRuntime.js'
import type React from 'react'
import type { DiagramDocument, WorkspaceSnapshot } from './types.js'
import type { DiagramListResult, DiagramResult } from './reviewTypes.js'

export interface DiagramSyncDeps {
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: React.Dispatch<React.SetStateAction<WorkspaceSnapshot>>
  selected: DiagramDocument | null
  source: string
  dirty: boolean
  saving: boolean
  externalChange: boolean
  externalDeleted: boolean
  changeReview: { before: DiagramDocument; after: DiagramDocument } | null
  saveInFlight: { current: boolean }
  requestSeq: { current: number }
  threadDiagramListLoading: boolean
  adoptSaved: (document: DiagramDocument, expectedSource: string) => void
  adoptSynced: (document: DiagramDocument) => void
  setSaving: (value: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
  setChangeReview: (review: { before: DiagramDocument; after: DiagramDocument } | null) => void
  setChangeReviewOpen: (open: boolean) => void
  setThreadDiagramListLoading: (value: boolean) => void
  setThreadDiagramListError: (message: string | null) => void
  setThreadDiagramMenuOpen: (open: boolean) => void
}

export interface DiagramSync {
  saveDiagram: () => Promise<void>
  reloadSelected: () => Promise<void>
  restorePreviousChange: () => Promise<void>
  refreshList: () => Promise<void>
  refreshThreadDiagramList: () => Promise<void>
  openThreadDiagramList: () => void
}

/**
 * Keeping the panel and the file in step: save, reload, roll back an external
 * change, and refresh the workspace list. Every write is guarded by a request
 * sequence so a slow response cannot overwrite a newer selection.
 */
export function useDiagramSync(deps: DiagramSyncDeps): DiagramSync {
  const {
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
    requestSeq: requestSeqRef,
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
  } = deps

  async function saveDiagram() {
    if (!selected || !dirty || saving || saveInFlight.current) return
    if (externalChange) {
      setError('文件已在外部修改，请先重新载入最新版本。')
      return
    }
    const requestSeq = requestSeqRef.current
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
      if (requestSeq !== requestSeqRef.current) return
      adoptSaved(result.diagram, source)
      setChangeReview(null)
      setChangeReviewOpen(false)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.some((item) => item.path === result.diagram.path)
          ? snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item)
          : [result.diagram, ...snapshot.diagrams],
      })
    } catch (cause) {
      if (requestSeq === requestSeqRef.current) setError(errorMessage(cause))
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  async function reloadSelected() {
    if (!selected) return
    const requestSeq = requestSeqRef.current
    setError(null)
    try {
      const result = await callTool<DiagramResult>('diagram.get', { workspacePath, path: selected.path })
      if (requestSeq !== requestSeqRef.current) return
      adoptSynced(result.diagram)
      onSnapshot({
        ...snapshot,
        diagrams: snapshot.diagrams.map((item) => item.path === result.diagram.path ? result.diagram : item),
      })
      setNotice('已重新载入磁盘版本')
    } catch (cause) {
      if (requestSeq === requestSeqRef.current) setError(errorMessage(cause))
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
      adoptSynced(result.diagram)
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

  return { saveDiagram, reloadSelected, restorePreviousChange, refreshList, refreshThreadDiagramList, openThreadDiagramList }
}
