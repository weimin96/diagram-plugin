import type { CanvasSpacingGuide } from './canvasOperations.js'
import type { CanvasPoint } from './canvas.js'

/** 拖拽期间用于对齐提示的参考线，只在一次手势内有效。 */
export type SnapGuides = {
  x?: number
  y?: number
  spacing?: CanvasSpacingGuide[]
  sizeLabel?: string
  sizePoint?: CanvasPoint
}

/** 拖动关系端点时命中的箭头插入位置。 */
export type InsertTarget = { arrowId: string; point: CanvasPoint }

/** 一帧内合并后的手势视觉草稿，不进入文档历史。 */
export type GestureVisualDraft = {
  positions: Record<string, CanvasPoint>
  guides: SnapGuides
  insertTarget: InsertTarget | null
}
