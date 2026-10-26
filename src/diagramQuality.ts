import type { CanvasVisualQualityAssessment } from './canvasQuality.js'
import type { MermaidVisualQualityAssessment } from './mermaidQuality.js'
import type { DiagramType, MermaidDiagramType } from './types.js'

export interface DiagramRenderEvidence {
  width: number
  height: number
  contentOverflow: number
  nodeOverlaps: number
  labelOverlaps: number
  /** Text-text intersections, advisory because specialized charts may overlay labels intentionally. */
  textOverlaps?: number
}

export interface DiagramQualityFinding {
  code: string
  severity: 'error' | 'warning'
  message: string
  elementIds: string[]
  origin: 'source' | 'geometry' | 'browser'
}

/** One transport contract, not a replacement for each engine's exact metrics.
 * A browser measurement is NOT a perceptual review; a review is NOT approval. */
export interface DiagramQualityReport {
  version: 1
  type: DiagramType
  engine: 'canvas' | 'mermaid'
  needsRevision: boolean
  geometry: 'not-measured' | 'passed' | 'needs-revision'
  visualReview: 'not-assessed' | 'blocked' | 'eligible'
  humanApproval: 'not-approved'
  evidence: 'source' | 'browser'
  findings: DiagramQualityFinding[]
  metrics: Record<string, number>
}

export function summarizeCanvasQuality(
  quality: CanvasVisualQualityAssessment,
  review?: { readyForVisualReview: boolean; blockers: readonly string[] },
): DiagramQualityReport {
  const findings = quality.issues.map((issue): DiagramQualityFinding => ({
    ...issue, origin: 'geometry',
  }))
  for (const blocker of review?.blockers ?? []) {
    findings.push({
      code: 'visual-review-blocked', severity: 'error', message: blocker,
      elementIds: [], origin: 'geometry',
    })
  }
  return {
    version: 1, type: 'canvas', engine: 'canvas',
    needsRevision: quality.needsRevision || Boolean(review?.blockers.length),
    geometry: quality.needsRevision ? 'needs-revision' : 'passed',
    visualReview: review ? review.readyForVisualReview ? 'eligible' : 'blocked' : 'not-assessed',
    humanApproval: 'not-approved', evidence: 'source',
    findings, metrics: { ...quality.metrics },
  }
}

export function summarizeMermaidQuality(
  type: MermaidDiagramType,
  quality: MermaidVisualQualityAssessment,
  render?: DiagramRenderEvidence,
): DiagramQualityReport {
  const findings: DiagramQualityFinding[] = quality.reasons.map((message) => ({
    code: 'source-readability', severity: 'warning', message, elementIds: [], origin: 'source',
  }))
  if (render?.contentOverflow) findings.push({
    code: 'text-overflow', severity: 'error', message: `文字或内容超出图形边界：${render.contentOverflow}`,
    elementIds: [], origin: 'browser',
  })
  if (render?.nodeOverlaps) findings.push({
    code: 'node-overlap', severity: 'error', message: `渲染节点相互遮挡：${render.nodeOverlaps}`,
    elementIds: [], origin: 'browser',
  })
  if (render?.labelOverlaps) findings.push({
    code: 'label-overlap', severity: 'warning', message: `渲染标签可能重叠：${render.labelOverlaps}`,
    elementIds: [], origin: 'browser',
  })
  if (render?.textOverlaps) findings.push({
    code: 'text-overlap', severity: 'warning', message: `实际渲染文字可能相互遮挡：${render.textOverlaps}`,
    elementIds: [], origin: 'browser',
  })
  const invalidSize = Boolean(render && (![render.width, render.height].every(
    (value) => Number.isFinite(value) && value > 0)))
  if (invalidSize) findings.push({
    code: 'invalid-render-size', severity: 'error', message: '渲染 SVG 的实际尺寸无效',
    elementIds: [], origin: 'browser',
  })
  const renderFailure = invalidSize || Boolean(render?.contentOverflow || render?.nodeOverlaps)
  return {
    version: 1, type, engine: 'mermaid',
    needsRevision: quality.splitRecommended || renderFailure,
    geometry: !render ? 'not-measured' : renderFailure ? 'needs-revision' : 'passed',
    // Browser pixel geometry alone cannot approve a composition or readability.
    visualReview: 'not-assessed', humanApproval: 'not-approved',
    evidence: render ? 'browser' : 'source',
    findings,
    metrics: { ...quality.metrics, ...(render ? { ...render } : {}) },
  }
}
