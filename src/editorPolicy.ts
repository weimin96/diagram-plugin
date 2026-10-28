import type { DiagramCapability } from './diagramCapabilities.js'
import type { DiagramSurface } from './types.js'

export type ViewMode = 'preview' | 'source' | 'split'
export type EditorChrome = 'full' | 'compact'
export type SplitAxis = 'horizontal' | 'vertical'

/**
 * Single decision point for editor chrome.
 *
 * Three independent axes feed it — host surface, measured width and the diagram
 * type's capabilities — so no JSX branch has to infer "can this be edited?" from
 * the surface name again. Surface only caps the chrome; width and capability
 * decide what is actually rendered.
 */
export interface EditorPolicyInput {
  surface: DiagramSurface
  /** Measured width of the editor shell in CSS pixels. */
  width: number
  capability: DiagramCapability
}

export interface EditorPolicy {
  chrome: EditorChrome
  /** View modes the current document can offer, in display order. */
  modes: readonly ViewMode[]
  /** Mode used when the user has no stored preference for this document. */
  defaultMode: ViewMode
  splitAxis: SplitAxis
  /** Full toolbar actions: generate, style, export, history, change review. */
  showWorkspaceTools: boolean
  showMinimap: boolean
  /** Narrow enough that the architecture canvas should suggest expanding. */
  cramped: boolean
}

/** Below this width a horizontal split stops being legible. */
export const NARROW_EDITOR_WIDTH = 560
/** Below this width the visual editor is cramped but still usable. */
export const CRAMPED_EDITOR_WIDTH = 620
/** Above this width even a thread surface earns the full toolbar. */
export const FULL_CHROME_WIDTH = 900

export function resolveEditorPolicy(input: EditorPolicyInput): EditorPolicy {
  const { surface, width, capability } = input
  const modes: ViewMode[] = capability.sourceEdit ? ['preview', 'source', 'split'] : ['preview']
  const chrome: EditorChrome = surface === 'workspace' || width >= FULL_CHROME_WIDTH ? 'full' : 'compact'
  return {
    chrome,
    modes,
    // Draggable documents open on the canvas itself; structured documents open on
    // source + live preview so editing is visible without hunting for a toggle.
    defaultMode: capability.visualEdit ? 'preview' : 'split',
    splitAxis: width < NARROW_EDITOR_WIDTH ? 'vertical' : 'horizontal',
    showWorkspaceTools: chrome === 'full',
    showMinimap: capability.visualEdit && width < NARROW_EDITOR_WIDTH,
    cramped: capability.visualEdit && width < CRAMPED_EDITOR_WIDTH,
  }
}

export function viewModeLabel(mode: ViewMode): string {
  return mode === 'preview' ? '预览' : mode === 'source' ? '源码' : '分屏'
}
