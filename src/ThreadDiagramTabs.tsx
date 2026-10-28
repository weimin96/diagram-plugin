import type { RefObject } from 'react'
import type { DiagramSummary } from './types.js'

export interface ThreadDiagramTabsProps {
  paths: string[]
  diagrams: DiagramSummary[]
  selectedPath: string | undefined
  elementRef: RefObject<HTMLDivElement | null>
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

/**
 * The tab strip is a view of one invariant: it shows the conversation's diagram
 * list intersected with what the workspace still has. Ordering, membership and
 * the close fallback all belong to `useThreadTabs`; this component only draws
 * what it is given and reports intent.
 */
export function ThreadDiagramTabs({ paths, diagrams, selectedPath, elementRef, onSelect, onClose }: ThreadDiagramTabsProps) {
  return (
    <div ref={elementRef} className="thread-diagram-tabs" role="group" aria-label="当前对话图表">
      {paths.map((path) => {
        const diagram = diagrams.find((item) => item.path === path)
        if (!diagram) return null
        return (
          <div key={path} className={`thread-diagram-tab${selectedPath === path ? ' is-active' : ''}`}>
            <button type="button" className="thread-diagram-tab-main" onClick={() => onSelect(path)} title={path}>
              <span>{diagram.name}</span>
            </button>
            <button type="button" className="thread-diagram-tab-close" aria-label={`关闭 ${diagram.name}`} onClick={() => onClose(path)}>×</button>
          </div>
        )
      })}
    </div>
  )
}
