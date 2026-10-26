import { rectsOverlapWithInset, segmentCrossesRectInterior, type DiagramRect, type DiagramPoint } from './diagramGeometry.js'

/** Detect foreign-relationship occlusions in Mermaid's rendered SVG.
 * Mermaid uses matching data-id on g.edgeLabel g.label and g.edgePaths path.
 * Labels are meant to sit on their OWN edge, so only other edges count.
 *
 * This is browser evidence: curved SVG paths are sampled in screen pixels,
 * not assumed to be straight between their endpoints. No source rewriting.
 */
export function measureMermaidRelationOcclusion(svg: SVGSVGElement): {
  edgeLabelIntrusions: number
  labelNodeIntrusions: number
  samples: { label: string; edge: string }[]
} {
  const rect = (el: Element): DiagramRect | null => {
    const box = el.getBoundingClientRect()
    return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0
      ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }
  const labels = [...svg.querySelectorAll('g.edgeLabel g.label[data-id]')].flatMap((el) => {
    const box = rect(el), id = el.getAttribute('data-id')
    return id && box && (el.textContent ?? '').trim() ? [{ id, box }] : []
  })
  const nodes = [...svg.querySelectorAll('g.nodes g.node')].flatMap((node) => {
    const box = rect(node)
    return box ? [box] : []
  })
  let labelNodeIntrusions = 0
  for (const label of labels) {
    for (const node of nodes) {
      if (rectsOverlapWithInset(label.box, node, 2)) labelNodeIntrusions++
    }
  }

  const pathPoints = [...svg.querySelectorAll<SVGPathElement>('g.edgePaths path[data-id]')].flatMap((edge) => {
    const id = edge.getAttribute('data-id')
    if (!id || !edge.getScreenCTM || !edge.getTotalLength) return []
    const length = edge.getTotalLength(), matrix = edge.getScreenCTM()
    if (!matrix || !Number.isFinite(length) || length <= 0) return []
    const segments = Math.min(256, Math.max(2, Math.ceil(length / 8)))
    const points: DiagramPoint[] = []
    for (let i = 0; i <= segments; i++) {
      const point = edge.getPointAtLength(length * i / segments).matrixTransform(matrix)
      points.push({ x: point.x, y: point.y })
    }
    // Reject distant label/path pairs before doing segment-level clipping.
    // A perfectly vertical or horizontal path can have a zero-size bound
    // on one axis, so keep min/max rather than requiring nonzero dimensions.
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y)
    return [{ id, points, left: Math.min(...xs), right: Math.max(...xs),
      top: Math.min(...ys), bottom: Math.max(...ys) }]
  })
  const samples: { label: string; edge: string }[] = []
  let edgeLabelIntrusions = 0
  for (const label of labels) {
    for (const path of pathPoints) {
      if (path.id === label.id) continue
      if (path.right <= label.box.x + 2 || path.left >= label.box.x + label.box.width - 2
        || path.bottom <= label.box.y + 2 || path.top >= label.box.y + label.box.height - 2) continue
      if (path.points.some((point, index) => index > 0
        && segmentCrossesRectInterior(path.points[index - 1], point, label.box, 2))) {
        edgeLabelIntrusions++
        if (samples.length < 5) samples.push({ label: label.id, edge: path.id })
      }
    }
  }
  return { edgeLabelIntrusions, labelNodeIntrusions, samples }
}
