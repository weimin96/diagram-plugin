import type { ReactNode } from 'react'
import type { DiagramSummary } from './types.js'

export interface DiagramSidebarProps {
  workspacePath: string
  canSelectWorkspace: boolean
  onRequestWorkspace: () => void
  onCollapse: () => void
  onCreateToggle: () => void
  creating: ReactNode | null
  query: string
  onQueryChange: (value: string) => void
  total: number
  visible: DiagramSummary[]
  selectedPath: string | undefined
  loadingPath: string | null | undefined
  onSelect: (path: string) => void
  onOpenWorkspaceGeneration: () => void
  onRefresh: () => void
  describe: (diagram: DiagramSummary) => string
  shortPath: (path: string) => string
}

/**
 * The workspace sidebar: identity, search and the saved diagrams. It renders a
 * filtered list it does not compute — `visibleDiagrams` is derived by the caller
 * — and reports selection upward, so the panel keeps one owner of "which
 * diagram is open".
 */
export function DiagramSidebar({
  workspacePath,
  canSelectWorkspace,
  onRequestWorkspace,
  onCollapse,
  onCreateToggle,
  creating,
  query,
  onQueryChange,
  total,
  visible,
  selectedPath,
  loadingPath,
  onSelect,
  onOpenWorkspaceGeneration,
  onRefresh,
  describe,
  shortPath,
}: DiagramSidebarProps) {
  return (
    <aside className="diagram-sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <div>
            <div className="eyebrow">DIAGRAMS</div>
            <div className="sidebar-title">图表</div>
          </div>
          <div className="sidebar-head-actions">
            <button className="icon-button" type="button" title="收起图表栏" aria-label="收起图表栏" onClick={onCollapse}>‹</button>
            <button className="icon-text-button" type="button" onClick={onCreateToggle}>新建</button>
          </div>
        </div>
        <button className="workspace-path" type="button" disabled={!canSelectWorkspace} onClick={onRequestWorkspace} title={workspacePath}>{workspacePath}</button>
      </div>

      {creating}

      <div className="diagram-search-wrap">
        <input
          className="diagram-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索图表"
          aria-label="搜索图表"
        />
      </div>
      <div className="sidebar-list-head">
        <span>{query.trim() ? `${visible.length} / ${total}` : `${total} 个图表`}</span>
        <div className="sidebar-list-actions">
          <button type="button" onClick={onOpenWorkspaceGeneration}>工作区→图</button>
          <button type="button" onClick={onRefresh}>刷新</button>
        </div>
      </div>
      <nav className="diagram-list" aria-label="图表列表">
        {visible.map((diagram) => (
          <button
            key={diagram.path}
            className={`diagram-list-item${selectedPath === diagram.path ? ' is-active' : ''}`}
            type="button"
            onClick={() => onSelect(diagram.path)}
          >
            <span className="diagram-list-name">{diagram.name}</span>
            <span className="diagram-list-meta">{describe(diagram)} · {shortPath(diagram.path)}</span>
            {loadingPath === diagram.path ? <span className="loading-line" /> : null}
          </button>
        ))}
        {total === 0 ? <div className="sidebar-empty">当前项目还没有图表。</div> : null}
        {total > 0 && visible.length === 0 ? <div className="sidebar-empty">没有匹配的图表。</div> : null}
      </nav>
    </aside>
  )
}
