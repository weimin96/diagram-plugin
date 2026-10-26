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
  edgeLabelIntrusions?: number
  labelNodeIntrusions?: number
  edgeLabelPairs?: { label: string; edge: string }[]
}

export interface DiagramQualityFinding {
  code: string
  severity: 'error' | 'warning'
  message: string
  elementIds: string[]
  origin: 'source' | 'geometry' | 'browser'
}

/** Suggestions are reviewable next steps, never implicit rewrites. */
export interface DiagramRepairSuggestion {
  findingCode: string
  target: 'source' | 'layout' | 'presentation'
  action: string
  automatic: false
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
  repairSuggestions: DiagramRepairSuggestion[]
  metrics: Record<string, number>
}

function suggestRepair(
  type: DiagramType, findings: readonly DiagramQualityFinding[],
): DiagramRepairSuggestion[] {
  const suggestions: DiagramRepairSuggestion[] = []
  const used = new Set<string>()
  const add = (code: string, target: DiagramRepairSuggestion['target'], action: string) => {
    const key = code + ':' + target
    if (used.has(key)) return
    used.add(key)
    suggestions.push({ findingCode: code, target, action, automatic: false })
  }
  for (const issue of findings) {
    switch (issue.code) {
      case 'source-readability': {
        const action = type === 'sequence' ? '按消息阶段或参与者分视图，保持原消息顺序和方向。'
          : type === 'flowchart' || type === 'state' ? '按真实子流程/状态层次规划总览与细节视图，保留全部转换和异常路径。'
            : type === 'er' || type === 'class' ? '按领域/职责分视图，保留实体、属性、继承及原有关系。'
              : type === 'gantt' || type === 'timeline' || type === 'journey' ? '按真实阶段划分阅读视图，不更改任务、日期或事件事实。'
                : '检查数据密度与最长标签，优先调整阅读分组，不丢弃原始条目或数据。'
        add(issue.code, 'source', action)
        break
      }
      case 'edge-crossing':
      case 'edge-overlap':
      case 'edge-through-node':
      case 'node-overlap':
      case 'edge-label-intrusion':
      case 'label-node-intrusion':
        add(issue.code, 'layout', '检查节点尺寸、端口与布局约束；仅采纳经过完整图几何和语义保真复验的候选。')
        break
      case 'text-overlap':
      case 'text-overflow':
      case 'label-overlap':
      case 'label-outside-canvas': {
        const action = type === 'radar' ? '检查雷达图标题与轴名称的布局距离，保持原始维度和数值。'
          : type === 'xychart' || type === 'pie' || type === 'sankey' ? '检查数据标签与图例空间，不能改写数值或类别来掩盖碰撞。'
            : '检查标题与标签的真实像素尺寸、换行和留白，不通过缩小字号掩盖溢出。'
        add(issue.code, 'presentation', action)
        break
      }
      case 'excessive-edge-detour':
        add(issue.code, 'layout', '联合检查端口容量、节点层次和走廊，不删除或伪造实际依赖。')
        break
      case 'invalid-render-size':
        add(issue.code, 'presentation', '先修复渲染尺寸与 SVG viewBox，再重新进行浏览器几何和像素验收。')
        break
      default:
        if (issue.code === 'visual-review-blocked') {
          add(issue.code, 'presentation', '按具体阻断项整改后重新生成当前版本截图；机器合格不能代替人工批准。')
        }
    }
  }
  return suggestions
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
    findings, repairSuggestions: suggestRepair('canvas', findings),
    metrics: { ...quality.metrics },
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
  if (render?.edgeLabelIntrusions) findings.push({
    code: 'edge-label-intrusion', severity: 'warning',
    message: `其他真实关系线路穿过当前关系标签：${render.edgeLabelIntrusions}`,
    elementIds: [...new Set((render.edgeLabelPairs ?? []).flatMap(({ label, edge }) => [label, edge]))],
    origin: 'browser',
  })
  if (render?.labelNodeIntrusions) findings.push({
    code: 'label-node-intrusion', severity: 'warning',
    message: `关系标签遮挡节点：${render.labelNodeIntrusions}`,
    elementIds: [], origin: 'browser',
  })
  const invalidSize = Boolean(render && (![render.width, render.height].every(
    (value) => Number.isFinite(value) && value > 0)))
  if (invalidSize) findings.push({
    code: 'invalid-render-size', severity: 'error', message: '渲染 SVG 的实际尺寸无效',
    elementIds: [], origin: 'browser',
  })
  const renderFailure = invalidSize || Boolean(render?.contentOverflow || render?.nodeOverlaps)
  // Browser probes may attach diagnostic arrays. Metrics is a numeric
  // contract; keep concrete relation IDs only in the corresponding finding.
  const numericRender = render ? {
    width: render.width, height: render.height,
    contentOverflow: render.contentOverflow, nodeOverlaps: render.nodeOverlaps,
    labelOverlaps: render.labelOverlaps,
    ...(render.textOverlaps !== undefined ? { textOverlaps: render.textOverlaps } : {}),
    ...(render.edgeLabelIntrusions !== undefined ? { edgeLabelIntrusions: render.edgeLabelIntrusions } : {}),
    ...(render.labelNodeIntrusions !== undefined ? { labelNodeIntrusions: render.labelNodeIntrusions } : {}),
  } : {}
  return {
    version: 1, type, engine: 'mermaid',
    needsRevision: quality.splitRecommended || renderFailure,
    geometry: !render ? 'not-measured' : renderFailure ? 'needs-revision' : 'passed',
    // Browser pixel geometry alone cannot approve a composition or readability.
    visualReview: 'not-assessed', humanApproval: 'not-approved',
    evidence: render ? 'browser' : 'source',
    findings, repairSuggestions: suggestRepair(type, findings),
    metrics: { ...quality.metrics, ...numericRender },
  }
}
