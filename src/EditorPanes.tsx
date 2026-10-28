import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { ViewMode } from './editorPolicy.js'

export interface SourcePaneProps {
  label: string
  typeLabel: string
  onFind: () => void
  onOpenFile: () => void
  children: ReactNode
}

/** The source side: a label that says what you are actually editing, plus the editor. */
export function SourcePane({ label, typeLabel, onFind, onOpenFile, children }: SourcePaneProps) {
  return (
    <section className="source-pane">
      <div className="pane-head">
        <span>{label}</span>
        <div className="pane-head-actions">
          <span>{typeLabel}</span>
          <button type="button" onClick={onFind}>查找</button>
          <button type="button" onClick={onOpenFile}>打开文件</button>
        </div>
      </div>
      {children}
    </section>
  )
}

export interface PreviewPaneProps {
  hidden: boolean
  head: { label: string; status: string; cramped: boolean } | null
  children: ReactNode
}

/** The rendered side. `head` is null when the compact canvas layout drops the strip. */
export function PreviewPane({ hidden, head, children }: PreviewPaneProps) {
  return (
    <section className="preview-pane" hidden={hidden}>
      {head ? (
        <div className="pane-head">
          <span>{head.label}</span>
          <div className="pane-head-actions">
            {head.cramped ? <span className="pane-head-hint" title="展开侧边栏可获得更完整的画布">窄面板</span> : null}
            <span>{head.status}</span>
          </div>
        </div>
      ) : null}
      {children}
    </section>
  )
}

export interface EditorPanesProps {
  mode: ViewMode
  splitPercent: number
  onSplitChange: (percent: number) => void
  containerRef: RefObject<HTMLDivElement | null>
  showSource: boolean
  showPreview: boolean
  previewHidden: boolean
  sourcePane: ReactNode
  previewPane: ReactNode
}

const MIN_SPLIT = 28
const MAX_SPLIT = 68
const DEFAULT_SPLIT = 44

/**
 * The split geometry. It owns the drag gesture and nothing else: which panes
 * exist is decided by the caller from the capability, and the ratio is state
 * the panel persists with the rest of the view preferences.
 */
export function EditorPanes({
  mode,
  splitPercent,
  onSplitChange,
  containerRef,
  showSource,
  showPreview,
  previewHidden,
  sourcePane,
  previewPane,
}: EditorPanesProps) {
  const drag = useRef<{ pointerId: number; left: number; width: number } | null>(null)
  return (
    <div
      ref={containerRef}
      className={`editor-workspace mode-${mode}`}
      style={{ '--diagram-split': `${splitPercent}%` } as CSSProperties}
    >
      {showSource ? sourcePane : null}
      {mode === 'split' ? (
        <button
          className="split-resizer"
          type="button"
          aria-label="调整源码和预览宽度"
          title="拖动调整源码和预览宽度"
          onDoubleClick={() => onSplitChange(DEFAULT_SPLIT)}
          onPointerDown={(event) => {
            const bounds = containerRef.current?.getBoundingClientRect()
            if (!bounds) return
            drag.current = { pointerId: event.pointerId, left: bounds.left, width: bounds.width }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const current = drag.current
            if (!current || current.pointerId !== event.pointerId) return
            const next = ((event.clientX - current.left) / current.width) * 100
            onSplitChange(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, next)))
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId === event.pointerId) drag.current = null
          }}
          onPointerCancel={() => { drag.current = null }}
        />
      ) : null}
      {showPreview ? previewPane : null}
    </div>
  )
}
