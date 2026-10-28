/**
 * The thread tab strip.
 *
 * One invariant: the strip is the intersection of the conversation's diagram
 * record and the workspace snapshot, in the order the conversation recorded
 * them. Every writer goes through this hook, so a rename, a close or a poll can
 * no longer leave a tab pointing at a path that no longer exists.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { planThreadTabClose, planThreadTabs } from './threadTabPlan.js'
import type { DocumentSession } from './useDocumentSession.js'
import type { WorkspaceSnapshot } from './types.js'

export interface ThreadTabsDeps {
  threadSurface: boolean
  workspacePath: string
  snapshot: WorkspaceSnapshot
  /** Tabs restored from the conversation record when the panel mounted. */
  initialTabs: string[] | undefined
  session: DocumentSession
  callTool: <T>(name: string, arguments_: Record<string, unknown>) => Promise<T>
  selectDiagram: (path: string, keep?: boolean, remember?: boolean) => Promise<void>
  /** Bumped to invalidate an in-flight document load. */
  requestSeq: { current: number }
  /** The user tried to close a dirty tab; the panel asks before discarding. */
  onDiscardRequest: (path: string) => void
  setError: (message: string | null) => void
}

export interface ThreadTabs {
  tabs: string[]
  setTabs: Dispatch<SetStateAction<string[]>>
  rememberTab: (path: string) => void
  closeTab: (path: string, force?: boolean) => Promise<void>
  /** Keep the strip in step when a diagram is renamed or moved. */
  renameTab: (from: string, to: string) => void
}

export function useThreadTabs(deps: ThreadTabsDeps): ThreadTabs {
  const {
    threadSurface,
    snapshot,
    initialTabs,
    session,
    callTool,
    selectDiagram,
    requestSeq,
    onDiscardRequest,
    setError,
  } = deps
  const { document: selected, dirty, setSelected, setSource } = session
  const [tabs, setTabs] = useState<string[]>(() => threadSurface ? (initialTabs ?? []) : [])

  // A different workspace invalidates every tab.
  useEffect(() => {
    const available = new Set(snapshot.diagrams.map((diagram) => diagram.path))
    setTabs(threadSurface ? (snapshot.threadDiagramPaths ?? []).filter((path) => available.has(path)) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.workspacePath])

  // Diagrams deleted elsewhere drop out of the strip.
  useEffect(() => {
    if (!threadSurface) return
    const available = new Set(snapshot.diagrams.map((diagram) => diagram.path))
    setTabs((current) => {
      const next = current.filter((path) => available.has(path))
      return next.length === current.length ? current : next
    })
  }, [threadSurface, snapshot.diagrams])

  const rememberTab = (path: string) => {
    if (!threadSurface) return
    setTabs((current) => current.includes(path) ? current : [...current, path])
  }

  const renameTab = (from: string, to: string) => {
    setTabs((current) => current.map((path) => path === from ? to : path))
  }

  const closeTab = async (path: string, force = false) => {
    if (!threadSurface) return
    if (!force && selected?.path === path && dirty) {
      onDiscardRequest(path)
      return
    }
    const plan = planThreadTabClose(tabs, path)
    setTabs(plan.tabs)
    try {
      await callTool<{ kind: 'diagram-thread-closed'; path?: string }>('diagram.closeThreadDiagram', { path })
    } catch (cause) {
      setError(`关闭当前图失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    if (selected?.path !== path) return
    if (plan.fallback) {
      await selectDiagram(plan.fallback, true, false)
      return
    }
    requestSeq.current += 1
    setSelected(null)
    setSource('')
  }

  return { tabs, setTabs, rememberTab, closeTab, renameTab }
}

/** Re-exported so callers can reason about the strip without the hook. */
export { planThreadTabs }
