import { ThreadActions, type ThreadActionsProps } from './ThreadActions.js'
import { ThreadDiagramPicker, type ThreadDiagramPickerProps } from './ThreadDiagramPicker.js'
import { ThreadDiagramTabs, type ThreadDiagramTabsProps } from './ThreadDiagramTabs.js'

export interface ThreadHeaderProps {
  picker: ThreadDiagramPickerProps
  tabs: ThreadDiagramTabsProps
  actions: ThreadActionsProps
}

/**
 * The panel header: where you open a diagram, which diagrams this conversation
 * has open, and what you can do to the current one. It holds no state; the shape
 * it takes at a given width comes from `resolveEditorPolicy`.
 */
export function ThreadHeader({ picker, tabs, actions }: ThreadHeaderProps) {
  return (
    <div className="thread-companion-head">
      <div className="thread-diagram-menu">
        <ThreadDiagramPicker {...picker} />
      </div>
      {tabs.paths.length > 0 ? <ThreadDiagramTabs {...tabs} /> : null}
      <ThreadActions {...actions} />
    </div>
  )
}
