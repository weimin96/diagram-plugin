/**
 * Thread tab decisions.
 *
 * The companion panel keeps a small set of tabs mirroring the diagrams the
 * conversation touched. Both the follow poll and tab closing need the same
 * rules: keep conversation order, drop paths the workspace no longer has, and
 * pick a neighbour when the active tab disappears.
 */

export interface ThreadTabsPlan {
  /** Conversation order, filtered to paths that still exist in the workspace. */
  tabs: string[]
  /** False when the poll saw paths the workspace listing has not caught up with. */
  complete: boolean
}

export function planThreadTabs(open: string[], available: string[]): ThreadTabsPlan {
  const present = new Set(available)
  const tabs = open.filter((path) => present.has(path))
  return { tabs, complete: tabs.length === open.length }
}

export interface ThreadTabClosePlan {
  tabs: string[]
  /** Neighbour to select after closing the active tab; undefined when none is left. */
  fallback?: string
  /** True when closing the last tab also has to clear the open document. */
  clearsDocument: boolean
}

export function planThreadTabClose(tabs: string[], path: string): ThreadTabClosePlan {
  const index = tabs.indexOf(path)
  const remaining = tabs.filter((candidate) => candidate !== path)
  const fallback = remaining[Math.min(Math.max(0, index - 1), remaining.length - 1)]
  return { tabs: remaining, fallback, clearsDocument: !fallback }
}
