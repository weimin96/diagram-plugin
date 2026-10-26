import type { DiagramQualityReport, DiagramRenderEvidence } from './diagramQuality.js'
import type { MermaidVisualConfig } from './mermaidVisualGrammar.js'
import type { MermaidDiagramType } from './types.js'

export type PresentationCandidate = {
  id: string
  description: string
  kind: 'radar-top-margin' | 'flowchart-spacing'
  value: number
}

export type PresentationObservation = {
  mode: 'light' | 'dark'
  baseline: DiagramRenderEvidence
  candidates: { id: string; geometry?: DiagramRenderEvidence; error?: string }[]
}

const metrics = ['contentOverflow', 'nodeOverlaps', 'labelOverlaps', 'textOverlaps'] as const

/** Only propose bounded reversible presentation edits supported by Mermaid.
 * Never change authored Mermaid, data, axes, relationships, or font size. */
export function proposePresentationCandidates(
  type: MermaidDiagramType, report: DiagramQualityReport, config: MermaidVisualConfig,
): PresentationCandidate[] {
  if (report.engine !== 'mermaid' || report.type !== type || report.evidence !== 'browser') return []
  if (type === 'radar' && report.findings.some((finding) => finding.code === 'text-overlap')) {
    const base = config.radar?.marginTop
    return typeof base === 'number' && Number.isFinite(base)
      ? [12, 28].map((delta) => ({
          id: `radar-top+${delta}`, description: '增加标题与顶部轴标签留白',
          kind: 'radar-top-margin' as const, value: base + delta,
        })) : []
  }
  if (type === 'flowchart' && report.findings.some((finding) => finding.code === 'label-overlap')) {
    const base = config.flowchart?.nodeSpacing
    return typeof base === 'number' && Number.isFinite(base)
      ? [10, 20].map((delta) => ({
          id: `flowchart-spacing+${delta}`, description: '扩大节点间距以保留关系标签',
          kind: 'flowchart-spacing' as const, value: base + delta,
        })) : []
  }
  return []
}

export function withPresentationCandidate(
  config: MermaidVisualConfig, candidate: PresentationCandidate,
): MermaidVisualConfig {
  if (candidate.kind === 'radar-top-margin') {
    return { ...config, radar: { ...config.radar, marginTop: candidate.value } }
  }
  if (candidate.kind === 'flowchart-spacing') {
    return { ...config, flowchart: {
      ...config.flowchart, nodeSpacing: candidate.value,
      rankSpacing: Math.max(config.flowchart?.rankSpacing ?? 0, candidate.value),
    } }
  }
  return config
}

export type PresentationDecision = {
  selected: PresentationCandidate | null
  state: 'improved' | 'unchanged' | 'rejected'
  reason: string
}

/** Deterministic dual-theme Pareto gate. A smaller collision count alone is
 * not enough: no other collision class may regress, both themes must improve
 * or stay equal, and neither SVG dimension may inflate excessively. */
export function selectPresentationCandidate(
  candidates: readonly PresentationCandidate[],
  observations: readonly PresentationObservation[],
): PresentationDecision {
  if (observations.length !== 2 || new Set(observations.map((item) => item.mode)).size !== 2) {
    return { selected: null, state: 'rejected', reason: '需要同一源码的明暗双主题浏览器证据' }
  }
  let winner: { candidate: PresentationCandidate; area: number; reduction: number } | undefined
  for (const candidate of candidates) {
    let improved = 0
    let area = 0
    let rejected = false
    for (const observation of observations) {
      const next = observation.candidates.find((item) => item.id === candidate.id)
      const old = observation.baseline
      const value = next?.geometry
      if (!value || next?.error || ![old.width, old.height, value.width, value.height].every(
        (item) => Number.isFinite(item) && item > 0,
      ) || value.width > old.width * 1.15 || value.height > old.height * 1.15) {
        rejected = true
        break
      }
      for (const key of metrics) {
        const before = old[key] ?? 0, after = value[key] ?? 0
        if (!Number.isFinite(before) || !Number.isFinite(after) || after > before) {
          rejected = true
          break
        }
        improved += before - after
      }
      if (rejected) break
      area += value.width * value.height / (old.width * old.height)
    }
    if (rejected || improved <= 0) continue
    if (!winner || improved > winner.reduction
      || (improved === winner.reduction && area < winner.area)) {
      winner = { candidate, area, reduction: improved }
    }
  }
  return winner
    ? { selected: winner.candidate, state: 'improved',
        reason: `两个主题的碰撞指标无退化，累计减少 ${winner.reduction} 处，且尺寸增加在边界内` }
    : { selected: null, state: candidates.length ? 'rejected' : 'unchanged',
        reason: candidates.length ? '所有候选未通过无退化、双主题或尺寸门禁' : '未发现适用的可逆展示整改候选' }
}
