import { canvasArrowBoxRoute, canvasGroupFrames, type CanvasNode, type CanvasScene } from '../src/canvas.js'
import { assessCanvasVisualQuality } from '../src/canvasQuality.js'
import { assessArchitecturePresentation } from '../src/architecturePresentationQuality.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'

/** The external engine is not preferred merely because one line collision
 * disappears. Both candidates must be rated in the same editable Canvas. */
export function measureEditableArchitecture(scene: CanvasScene) {
  const quality = assessCanvasVisualQuality(scene).metrics
  const presentation = assessArchitecturePresentation(scene)
  const region = assessArchitectureRouteDiagnostics(scene)
  const frameOverflowPx = canvasGroupFrames(scene).reduce((total, frame) =>
    total + Math.max(0, -frame.x) + Math.max(0, -frame.y)
      + Math.max(0, frame.x + frame.width - scene.width)
      + Math.max(0, frame.y + frame.height - scene.height), 0)
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
    routeBends: region.totalRouteBends, frameOverflowPx,
    portNormals: region.terminalNormalViolations,
    fitPx: presentation.estimatedTitlePxAtFit,
    frames: region.frameOverlaps,
    frameOverlapArea: region.frameOverlapArea,
    intrusionPx: region.unrelatedFrameIntrusionLength,
    routeLength: region.totalRouteLength,
    perimeterDetours: region.perimeterDetours,
  }
}

/** No rendered SVG can stand in for a real, editable relationship graph. */
export function compareEditableArchitectureSemantics(
  source: CanvasScene, candidate: CanvasScene,
): { faithful: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (source.type !== candidate.type || source.version !== candidate.version) reasons.push('Canvas 文件协议改变')
  if (JSON.stringify(source.groups ?? []) !== JSON.stringify(candidate.groups ?? [])
    || JSON.stringify(source.lanes ?? []) !== JSON.stringify(candidate.lanes ?? [])) {
    reasons.push('语义分区或泳道改变')
  }
  const sourceById = new Map(source.elements.map((element) => [element.id, element]))
  const candidateById = new Map(candidate.elements.map((element) => [element.id, element]))
  if (sourceById.size !== source.elements.length || candidateById.size !== candidate.elements.length
    || sourceById.size !== candidateById.size) reasons.push('节点或关系 ID 数量改变或重复')
  for (const [id, item] of sourceById) {
    const next = candidateById.get(id)
    if (!next || next.type !== item.type) { reasons.push(`${id}: 缺失或类型改变`); continue }
    if (item.type === 'arrow' && next.type === 'arrow') {
      if (item.from !== next.from || item.to !== next.to || item.label !== next.label
        || item.emphasis !== next.emphasis) reasons.push(`${id}: 关系语义或方向改变`)
    } else if (item.type !== 'arrow' && next.type !== 'arrow') {
      if (item.text !== next.text || item.width !== next.width || item.height !== next.height
        || item.groupId !== next.groupId || item.emphasis !== next.emphasis) {
        reasons.push(`${id}: 节点文字、尺寸或归属改变`)
      }
      if (item.locked !== next.locked) reasons.push(`${id}: 锁定属性改变`)
      if (item.locked && (item.x !== next.x || item.y !== next.y)) {
        reasons.push(`${id}: 锁定节点位置改变`)
      }
    }
  }
  return { faithful: reasons.length === 0, reasons }
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
  if (candidate.portNormals > baseline.portNormals) {
    reasons.push(`声明端口法向缺陷增加 ${baseline.portNormals}→${candidate.portNormals}`)
  }
  // Purely cosmetic or terminal-only improvements must not buy extra bends.
  // A genuine reduction in independent crossings/overlaps may still justify
  // a more complex route and will be assessed with all the other constraints.
  if (candidate.routeBends > baseline.routeBends
    && b.edgeCrossings >= a.edgeCrossings && b.edgeOverlaps >= a.edgeOverlaps) {
    reasons.push(`关系线转折增加 ${baseline.routeBends}→${candidate.routeBends}，未减少交叉或独立重叠`)
  }
  if (b.edgeOverlaps > a.edgeOverlaps) reasons.push(`重叠增加 ${a.edgeOverlaps}→${b.edgeOverlaps}`)
  if (candidate.frames > baseline.frames) reasons.push('分区边界交叠增加')
  if (candidate.frameOverflowPx > 0) {
    reasons.push(`分区边框或标题超出画布 ${candidate.frameOverflowPx}px`)
  }
  if (candidate.frameOverlapArea > baseline.frameOverlapArea) {
    reasons.push(`分区重叠面积增加 ${baseline.frameOverlapArea}→${candidate.frameOverlapArea}px²`)
  }
  if (candidate.intrusionPx > baseline.intrusionPx + 100) reasons.push('跨无关分区穿越增加')
  if (candidate.fitPx < baseline.fitPx - 0.5) reasons.push(`可读字号降低 ${baseline.fitPx}→${candidate.fitPx}px`)
  if (candidate.routeLength > baseline.routeLength * 1.1) {
    reasons.push(`总线长增加 ${baseline.routeLength}→${candidate.routeLength}px`)
  }
  if (candidate.perimeterDetours > baseline.perimeterDetours) {
    reasons.push(`外围绕行增加 ${baseline.perimeterDetours}→${candidate.perimeterDetours}`)
  }
  if (b.edgeCrossings === a.edgeCrossings && b.edgeOverlaps === a.edgeOverlaps
    && candidate.portNormals >= baseline.portNormals
    && candidate.fitPx < baseline.fitPx + 1 && candidate.frames >= baseline.frames) {
    reasons.push('没有明确的结构或可读性收益')
  }
  return { eligible: reasons.length === 0, reasons }
}
