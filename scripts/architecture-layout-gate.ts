import { canvasArrowBoxRoute, type CanvasNode, type CanvasScene } from '../src/canvas.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { assessArchitecturePresentation } from '../src/architecturePresentationQuality.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'

/** The external engine is not preferred merely because one line collision
 * disappears. Both candidates must be rated in the same editable Canvas. */
export function measureEditableArchitecture(scene: CanvasScene) {
  const quality = assessCanvasVisualQuality(scene).metrics
  const presentation = assessArchitecturePresentation(scene)
  const region = assessArchitectureRouteDiagnostics(scene)
  const byId = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const nonOrthogonalSegments = scene.elements.filter((item) => item.type === 'arrow')
    .reduce((total, arrow) => {
      const from = byId.get(arrow.from), to = byId.get(arrow.to)
      if (!from || !to) return total
      const route = canvasArrowBoxRoute(from, to, arrow)
      return total + route.slice(1).filter((point, index) =>
        Math.abs(point.x - route[index].x) > 0.5 && Math.abs(point.y - route[index].y) > 0.5).length
    }, 0)
  return {
    quality, nonOrthogonalSegments,
    fitPx: presentation.estimatedTitlePxAtFit,
    frames: region.frameOverlaps,
    frameOverlapArea: region.frameOverlapArea,
    intrusionPx: region.unrelatedFrameIntrusionLength,
  }
}

export function judgeExternalLayout(
  baseline: ReturnType<typeof measureEditableArchitecture>,
  candidate: ReturnType<typeof measureEditableArchitecture>,
): { eligible: boolean; reasons: string[] } {
  const a = baseline.quality, b = candidate.quality
  const reasons: string[] = []
  if (b.nodeOverlaps > a.nodeOverlaps || b.edgeNodeIntersections > a.edgeNodeIntersections
    || b.labelNodeIntersections > a.labelNodeIntersections || b.labelOverlaps > a.labelOverlaps
    || b.labelOverflows > a.labelOverflows) reasons.push('新增节点或文字遮挡')
  if (b.edgeCrossings > a.edgeCrossings) reasons.push(`交叉增加 ${a.edgeCrossings}→${b.edgeCrossings}`)
  if (candidate.nonOrthogonalSegments > baseline.nonOrthogonalSegments) {
    reasons.push(`非正交线段增加 ${baseline.nonOrthogonalSegments}→${candidate.nonOrthogonalSegments}`)
  }
  if (b.edgeOverlaps > a.edgeOverlaps) reasons.push(`重叠增加 ${a.edgeOverlaps}→${b.edgeOverlaps}`)
  if (candidate.frames > baseline.frames) reasons.push('分区边界交叠增加')
  if (candidate.frameOverlapArea > baseline.frameOverlapArea) {
    reasons.push(`分区重叠面积增加 ${baseline.frameOverlapArea}→${candidate.frameOverlapArea}px²`)
  }
  if (candidate.intrusionPx > baseline.intrusionPx + 100) reasons.push('跨无关分区穿越增加')
  if (candidate.fitPx < Math.min(11, baseline.fitPx - 0.5)) reasons.push(`可读字号降低 ${baseline.fitPx}→${candidate.fitPx}px`)
  if (b.edgeCrossings === a.edgeCrossings && b.edgeOverlaps === a.edgeOverlaps
    && candidate.fitPx < baseline.fitPx + 1 && candidate.frames >= baseline.frames) {
    reasons.push('没有明确的结构或可读性收益')
  }
  return { eligible: reasons.length === 0, reasons }
}
