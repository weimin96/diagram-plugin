import { errorMessage } from './errors.js'
import type { DiagramDeletedResult, DiagramResult } from './reviewTypes.js'
import type { CanvasWorkbenchMode } from './canvas.js'
import type { DiagramDocument, DiagramType, WorkspaceSnapshot } from './types.js'

export type DiscardTarget =
  | { kind: 'diagram'; path: string }
  | { kind: 'workspace' }
  | { kind: 'close-thread'; path: string }
  | { kind: 'new-diagram'; type: DiagramType; title: string; canvasWorkbench?: CanvasWorkbenchMode }

export interface DocumentCommandsDeps {
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  selected: DiagramDocument | null
  dirty: boolean
  renameTitle: string
  callTool: <T>(method: string, params: Record<string, unknown>) => Promise<T>
  setSelected: (diagram: DiagramDocument | null) => void
  setSource: (source: string) => void
  setDeletedDraftPath: (path: string | null) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
  setCreating: (value: boolean) => void
  setRenaming: (value: boolean) => void
  setDocumentMenuOpen: (value: boolean) => void
  setDeleteConfirmOpen: (value: boolean) => void
  setDiscardTarget: (target: DiscardTarget | null) => void
  rememberTab: (path: string) => void
  renameTab: (from: string, to: string) => void
  selectDiagram: (path: string, force?: boolean, remember?: boolean) => Promise<void>
}

export interface DocumentCommands {
  createDiagram: (type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) => Promise<void>
  requestCreateDiagram: (type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) => Promise<void>
  renameDiagram: () => Promise<void>
  duplicateDiagram: () => Promise<void>
  deleteDiagram: () => Promise<void>
}

/**
 * Create / rename / duplicate / delete. The one rule they all share: a document
 * with unsaved edits never gets replaced or removed silently — creation asks
 * first through `setDiscardTarget`, the other three simply refuse.
 */
export function useDocumentCommands(deps: DocumentCommandsDeps): DocumentCommands {
  const {
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
    rememberTab,
    renameTab,
    selectDiagram,
  } = deps

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
      rememberTab(result.diagram.path)
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
      renameTab(selected.path, result.diagram.path)
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
      rememberTab(result.diagram.path)
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

  return { createDiagram, requestCreateDiagram, renameDiagram, duplicateDiagram, deleteDiagram }
}
