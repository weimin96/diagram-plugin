/**
 * Patch history for the open Canvas document.
 *
 * Undo/redo touches the document, the save flag, the draft source and three
 * review panels at once, so the panel keeps it behind one hook instead of six
 * functions interleaved with unrelated workspace commands.
 */
import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { parseCanvasScene } from './canvas.js'
import type { CanvasPlaybackRequest } from './CanvasEditor.js'
import type {
  DiagramPatchHistoryChainRedoResult,
  DiagramPatchHistoryChainUndoResult,
  DiagramPatchHistoryEntry,
  DiagramPatchHistoryRedoResult,
  DiagramPatchHistoryResult,
  DiagramPatchHistoryUndoResult,
  DiagramResult,
  DiagramThreadStateResult,
} from './reviewTypes.js'
import type { DiagramDocument, WorkspaceSnapshot } from './types.js'
import { guardPatchHistory, patchHistoryNotice } from './patchHistoryPlan.js'

export type CanvasFocusState = { ids: string[]; key: string; trace?: DiagramThreadStateResult['trace'] }

export interface PatchHistoryDeps {
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  selected: DiagramDocument | null
  source: string
  saving: boolean
  dirty: boolean
  externalChange: boolean
  threadSurface: boolean
  callTool: <T>(name: string, arguments_: Record<string, unknown>) => Promise<T>
  errorMessage: (error: unknown) => string
  requestSeqRef: MutableRefObject<number>
  setSelected: (document: DiagramDocument | null) => void
  setSource: (source: string) => void
  setSaving: (value: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  setExternalChange: (changed: boolean) => void
  setProposalReviewOpen: (open: boolean) => void
  setChangeReviewOpen: (open: boolean) => void
  setGitImpactOpen: (open: boolean) => void
  setCanvasFocus: Dispatch<SetStateAction<CanvasFocusState | null>>
  setCanvasPlayback: Dispatch<SetStateAction<CanvasPlaybackRequest | null>>
}

export function usePatchHistory(deps: PatchHistoryDeps) {
  const {
    workspacePath, snapshot, onSnapshot, selected, source, saving, dirty, externalChange,
    threadSurface, callTool, errorMessage, requestSeqRef,
    setSelected, setSource, setSaving, setError, setNotice, setExternalChange,
    setProposalReviewOpen, setChangeReviewOpen, setGitImpactOpen, setCanvasFocus, setCanvasPlayback,
  } = deps
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DiagramPatchHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [redoingId, setRedoingId] = useState<string | null>(null)

  async function loadPatchHistory(diagramPath = selected?.path) {
    if (!diagramPath) return
    const requestSeq = ++requestSeqRef.current
    setLoading(true)
    try {
      const result = await callTool<DiagramPatchHistoryResult>('diagram.patchHistory', { workspacePath, path: diagramPath, limit: 100 })
      if (requestSeq !== requestSeqRef.current) return
      setEntries(result.entries)
    } catch (cause) {
      if (requestSeq !== requestSeqRef.current) return
      setError(errorMessage(cause))
    } finally {
      if (requestSeq === requestSeqRef.current) setLoading(false)
    }
  }

  function openPatchHistory() {
    if (!selected) return
    setProposalReviewOpen(false)
    setChangeReviewOpen(false)
    setGitImpactOpen(false)
    setOpen(true)
    void loadPatchHistory(selected.path)
  }

  async function undoPatchHistory(entry: DiagramPatchHistoryEntry) {
    const guard = guardPatchHistory({
      entryPath: entry.path,
      selectedPath: selected?.path,
      saving,
      undoingId: undoingId,
      redoingId: redoingId,
      dirty,
      externalChange,
    })
    if (guard.kind === 'reject') {
      const message = patchHistoryNotice(guard)
      if (message) setError(message)
      return
    }
    // guardPatchHistory already rejected a missing selection; this keeps the document narrowed.
    if (!selected) return
    setSaving(true)
    setUndoingId(entry.id)
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
      if (threadSurface && result.diagram.type === 'canvas') {
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
      setUndoingId(null)
    }
  }

  async function undoPatchHistoryChain(entry: DiagramPatchHistoryEntry) {
    const guard = guardPatchHistory({
      entryPath: entry.path,
      selectedPath: selected?.path,
      saving,
      undoingId: undoingId,
      redoingId: redoingId,
      dirty,
      externalChange,
    })
    if (guard.kind === 'reject') {
      const message = patchHistoryNotice(guard)
      if (message) setError(message)
      return
    }
    // guardPatchHistory already rejected a missing selection; this keeps the document narrowed.
    if (!selected) return
    setSaving(true)
    setUndoingId(entry.id)
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
      if (threadSurface && result.diagram.type === 'canvas') {
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
      setUndoingId(null)
    }
  }

  async function redoPatchHistory(entry: DiagramPatchHistoryEntry) {
    const guard = guardPatchHistory({
      entryPath: entry.path,
      selectedPath: selected?.path,
      saving,
      undoingId: undoingId,
      redoingId: redoingId,
      dirty,
      externalChange,
    })
    if (guard.kind === 'reject') {
      const message = patchHistoryNotice(guard)
      if (message) setError(message)
      return
    }
    // guardPatchHistory already rejected a missing selection; this keeps the document narrowed.
    if (!selected) return
    setSaving(true)
    setRedoingId(entry.id)
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
      if (threadSurface && result.diagram.type === 'canvas') {
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
      setRedoingId(null)
    }
  }

  async function redoPatchHistoryChain(entry: DiagramPatchHistoryEntry) {
    const guard = guardPatchHistory({
      entryPath: entry.path,
      selectedPath: selected?.path,
      saving,
      undoingId: undoingId,
      redoingId: redoingId,
      dirty,
      externalChange,
    })
    if (guard.kind === 'reject') {
      const message = patchHistoryNotice(guard)
      if (message) setError(message)
      return
    }
    // guardPatchHistory already rejected a missing selection; this keeps the document narrowed.
    if (!selected) return
    setSaving(true)
    setRedoingId(entry.id)
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
      if (threadSurface && result.diagram.type === 'canvas') {
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
      setRedoingId(null)
    }
  }

    return {
      open, entries, loading, undoingId, redoingId,
      setOpen, setEntries, setLoading, setUndoingId, setRedoingId,
      loadPatchHistory, openPatchHistory,
      undoPatchHistory, undoPatchHistoryChain, redoPatchHistory, redoPatchHistoryChain,
    }
  }
