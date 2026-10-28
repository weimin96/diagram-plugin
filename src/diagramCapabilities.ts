import type { DiagramType } from './types.js'

export type DiagramExportFormat = 'svg' | 'png'

/**
 * What a diagram type can actually do inside the editor.
 *
 * This is surface-independent on purpose: a Mermaid document is not draggable on
 * any host, and a Canvas document is draggable on every host that renders the
 * editor. Host surfaces decide *how much chrome* is shown; they never decide
 * whether a document can be edited.
 */
export interface DiagramCapability {
  /** The document exposes an editable text source. */
  sourceEdit: boolean
  /** Nodes, relations, ports and partitions can be manipulated directly. */
  visualEdit: boolean
  exportFormats: readonly DiagramExportFormat[]
  /** A visual style preset can be applied without editing the source. */
  styleSelect: boolean
  patchHistory: boolean
  playback: boolean
  /** Header label of the source pane. */
  sourceLabel: string
  /** Header label of the preview pane. */
  previewLabel: string
  /** Secondary label describing how the preview is produced. */
  previewStatusLabel: string
}

const MERMAID_CAPABILITY: DiagramCapability = {
  sourceEdit: true,
  visualEdit: false,
  exportFormats: ['svg', 'png'],
  styleSelect: true,
  patchHistory: false,
  playback: false,
  sourceLabel: 'Mermaid',
  previewLabel: '预览',
  previewStatusLabel: '实时渲染',
}

const CANVAS_CAPABILITY: DiagramCapability = {
  sourceEdit: true,
  visualEdit: true,
  exportFormats: ['svg', 'png'],
  styleSelect: false,
  patchHistory: true,
  playback: true,
  sourceLabel: 'Canvas JSON',
  previewLabel: '画布',
  previewStatusLabel: '可视化编辑',
}

/** Unknown or missing types fall back to the structured (Mermaid) capability set. */
export function diagramCapability(type: DiagramType | 'unknown' | undefined): DiagramCapability {
  return type === 'canvas' ? CANVAS_CAPABILITY : MERMAID_CAPABILITY
}
