import type { CanvasNode, CanvasScene } from './canvas.js'
import type { ArchitectureComposition } from './architectureDesign.js'
import { architecturePartitionFlow } from './architecturePartitionFlow.js'
import type { ArchitecturePresentationQuality } from './architecturePresentationQuality.js'
import type { ArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import type { CanvasVisualQualityAssessment } from './canvasQuality.js'

/**
 * Visual design references are requirements, not an automatic aesthetics
 * score. A scene must never acquire fake labels, nodes or edges to satisfy one.
 */
export type ArchitectureVisualScenario =
  | 'enterprise-system' | 'microservices' | 'data-platform' | 'ai-agent' | 'deployment'

export interface ArchitectureVisualReference {
  scenario: ArchitectureVisualScenario
  label: string
  readingPattern: string
  priorities: readonly string[]
  antiPatterns: readonly string[]
}

export const ARCHITECTURE_VISUAL_REFERENCES: readonly ArchitectureVisualReference[] = [
  {
    scenario: 'enterprise-system',
    label: '企业系统',
    readingPattern: '参与者与入口 → 核心应用 → 数据与异步系统',
    priorities: ['系统边界明确', '主业务调用一眼可见', '外围集成保持次要层级'],
    antiPatterns: ['所有服务等权', '多个大面积嵌套边框', '跨区依赖覆盖主链'],
  },
  {
    scenario: 'microservices',
    label: '微服务',
    readingPattern: '入口网关 → 业务服务 → 事件处理与独立数据存储',
    priorities: ['同步/异步语义可区分', '明确服务边界', '关键业务调用与数据归属清晰'],
    antiPatterns: ['消息总线伪装同步调用', '微服务呈现为无序卡片矩阵', '分区间线束压过节点'],
  },
  {
    scenario: 'data-platform',
    label: '数据平台',
    readingPattern: '数据源 → 接入 → 处理 → 存储与索引 → 消费',
    priorities: ['批流处理区别清晰', '主数据流方向一致', '查询消费与数据加工路径不混淆'],
    antiPatterns: ['长反向连线遮挡流程', '数据源和消费端没有区分', '一行挤下所有数据组件'],
  },
  {
    scenario: 'ai-agent',
    label: 'AI Agent',
    readingPattern: '交互入口 → Agent 编排 → 模型、工具与知识',
    priorities: ['Agent 核心突出', '工具/模型/知识的角色分明', '上下游调用有清晰方向'],
    antiPatterns: ['模型与工具等同于普通微服务', '编排过程被装饰图形掩盖', '没有真正的核心节点'],
  },
  {
    scenario: 'deployment',
    label: '部署拓扑',
    readingPattern: '入口网络 → 运行环境 → 工作负载 → 数据基础设施',
    priorities: ['物理与逻辑边界区分', '真实部署技术有依据', '网络与运行依赖可追踪'],
    antiPatterns: ['凭空推断云厂商', '容器关系等同于服务调用', '环境边界重复包裹'],
  },
]

export type ArchitectureVisualConcernCode =
  | 'weak-main-path' | 'dense-detail' | 'tiny-overview-text'
  | 'wide-canvas' | 'cross-boundary-intrusion' | 'frame-overlap'
  | 'overlapping-relationships' | 'crossing-relationships' | 'perimeter-detour'

export interface ArchitectureVisualRepairTarget {
  concern: ArchitectureVisualConcernCode
  /** IDs are always drawn from an existing scene, never invented. */
  elementIds: string[]
  action: string
}

/** A relation is a routing hotspot when it conflicts with several *different*
 * semantic relations. Count distinct peers, not repeated geometric segments. */
export interface ArchitectureOverlapHotspot {
  edgeId: string
  conflictingEdgeIds: string[]
  fromGroupId?: string
  toGroupId?: string
}

export function rankArchitectureOverlapHotspots(
  scene: CanvasScene, quality: CanvasVisualQualityAssessment,
): ArchitectureOverlapHotspot[] {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((item) => [item.id, item]))
  const arrows = new Map(scene.elements.filter((item) => item.type === 'arrow')
    .map((item) => [item.id, item]))
  const peers = new Map<string, Set<string>>()
  for (const issue of quality.issues) {
    if (issue.code !== 'edge-overlap' || issue.elementIds.length !== 2) continue
    const [a, b] = issue.elementIds
    if (!arrows.has(a) || !arrows.has(b) || a === b) continue
    if (!peers.has(a)) peers.set(a, new Set())
    if (!peers.has(b)) peers.set(b, new Set())
    peers.get(a)!.add(b)
    peers.get(b)!.add(a)
  }
  return [...peers.entries()].map(([edgeId, conflicts]) => {
    const edge = arrows.get(edgeId)!
    return {
      edgeId,
      conflictingEdgeIds: [...conflicts].sort((a, b) => a.localeCompare(b, 'en')),
      fromGroupId: nodes.get(edge.from)?.groupId,
      toGroupId: nodes.get(edge.to)?.groupId,
    }
  }).sort((a, b) => b.conflictingEdgeIds.length - a.conflictingEdgeIds.length
    || a.edgeId.localeCompare(b.edgeId, 'en'))
}

export interface ArchitectureVisualPlan {
  scenario: ArchitectureVisualScenario
  reference: ArchitectureVisualReference
  /** Rendering preference only; the full graph is always retained. */
  recommendedView: 'overview' | 'detail'
  nodeCount: number
  relationCount: number
  /** Authoritative IDs taken from existing emphasized nodes and relations. */
  primaryNodeIds: string[]
  primaryRelationIds: string[]
  /** Existing groups in dependency order; no new/grouped-away nodes. */
  regions: Array<{ id: string; label: string; nodeCount: number }>
  review: {
    readyForVisualReview: boolean
    /** Objective geometry blockers, distinct from issues that are inspectable in a human review. */
    blockers: ArchitectureReviewBlocker[]
    concerns: ArchitectureVisualConcernCode[]
    /** Bounded, evidence-based suggestions; not claims that a visual reviewer has inspected pixels. */
    repairTargets: ArchitectureVisualRepairTarget[]
    /** Distinct real conflicting relationships, highest-degree first. */
    overlapHotspots: ArchitectureOverlapHotspot[]
  }
}

export type ArchitectureReviewBlocker =
  | 'node-overlap' | 'edge-through-node' | 'label-through-node'
  | 'severe-edge-crossings' | 'severe-independent-overlaps' | 'severe-frame-overlap'

export function architectureVisualScenario(
  scene: CanvasScene, composition: ArchitectureComposition,
): ArchitectureVisualScenario {
  const nodes = scene.elements.filter((element): element is CanvasNode => element.type === 'node')
  if (composition === 'data-platform') return 'data-platform'
  if (composition === 'agent-runtime') return 'ai-agent'
  if (composition === 'cloud-native') return 'deployment'
  if (nodes.some((node) => node.icon === 'cloud') && nodes.some((node) => node.stencil === 'nginx')
    && nodes.some((node) => /(实例|容器|节点|instance|container|pod)/i.test(node.text))) return 'deployment'
  if (nodes.some((node) => node.stencil === 'kubernetes' || node.stencil === 'docker')
    && nodes.some((node) => node.icon === 'cloud')) return 'deployment'
  const services = nodes.filter((node) => node.icon === 'service').length
  const gateway = nodes.some((node) => node.icon === 'gateway')
  if (composition === 'event-driven' && gateway && services >= 2) return 'microservices'
  return 'enterprise-system'
}

export function planArchitectureVisual(
  scene: CanvasScene,
  composition: ArchitectureComposition,
  quality: CanvasVisualQualityAssessment,
  presentation: ArchitecturePresentationQuality,
  geometry: ArchitectureRouteDiagnostics,
): ArchitectureVisualPlan {
  const nodes = scene.elements.filter((element): element is CanvasNode => element.type === 'node')
  const relations = scene.elements.filter((element) => element.type === 'arrow')
  const scenario = scene.architecture?.scenario ?? architectureVisualScenario(scene, composition)
  const reference = ARCHITECTURE_VISUAL_REFERENCES.find((item) => item.scenario === scenario)!
  const regions = architecturePartitionFlow(scene).steps.map((region) =>
    ({ id: region.id, label: region.label, nodeCount: region.nodeCount }))
  const primaryNodeIds = nodes.filter((node) => node.emphasis === 'primary').map((node) => node.id)
  const primaryRelationIds = relations.filter((edge) => edge.emphasis === 'primary').map((edge) => edge.id)
  // Width and relation count signal cognitive load, not missing semantics.
  // When unrelated functional frames significantly overlap, the detail view
  // is not a readable entry point even for a medium-sized graph. Keep all
  // authored geometry; the existing overview can summarize actual regions.
  const severeFrameCongestion = nodes.length >= 16 && geometry.frameOverlaps >= 2
    && geometry.frameOverlapArea >= scene.width * scene.height * 0.12
  const recommendedView = severeFrameCongestion || nodes.length >= 22 || relations.length >= 30
    || (nodes.length >= 17 && presentation.estimatedTitlePxAtFit < 10)
    ? 'overview' : 'detail'
  const concerns: ArchitectureVisualConcernCode[] = []
  if (nodes.length >= 7 && (primaryNodeIds.length < 3 || primaryRelationIds.length < 2)) concerns.push('weak-main-path')
  if (recommendedView === 'overview') concerns.push('dense-detail')
  if (presentation.estimatedTitlePxAtFit < 11) concerns.push('tiny-overview-text')
  if (scene.width / Math.max(1, scene.height) > 2.3) concerns.push('wide-canvas')
  if (geometry.unrelatedFrameIntrusionLength > 0) concerns.push('cross-boundary-intrusion')
  if (geometry.frameOverlaps > 0) concerns.push('frame-overlap')
  if (quality.metrics.edgeOverlaps >= 2) concerns.push('overlapping-relationships')
  if (quality.metrics.edgeCrossings > 0) concerns.push('crossing-relationships')
  if (geometry.perimeterDetours > 0) concerns.push('perimeter-detour')
  const repairTargets: ArchitectureVisualRepairTarget[] = []
  const existingArrows = new Set(relations.map((edge) => edge.id))
  const existingGroups = new Set((scene.groups ?? []).map((group) => group.id))
  const crossings = quality.issues.filter((issue) => issue.code === 'edge-crossing'
    && issue.elementIds.length === 2 && issue.elementIds.every((id) => existingArrows.has(id)))
  for (const issue of crossings.slice(0, 2)) {
    repairTargets.push({
      concern: 'crossing-relationships',
      elementIds: issue.elementIds,
      action: `关系 ${issue.elementIds.join(' 与 ')} 的真实正交线路交叉；应联合调整节点、端口和走廊，不能用隐藏关系或假总线消除冲突`,
    })
  }
  for (const intrusion of geometry.worstFrameIntrusions.slice(0, 3)) {
    if (!existingArrows.has(intrusion.edgeId) || !existingGroups.has(intrusion.frameId)) continue
    repairTargets.push({
      concern: 'cross-boundary-intrusion',
      elementIds: [intrusion.edgeId, intrusion.frameId],
      action: `检查跨区线路经过无关分区 ${intrusion.length}px；应与关联线路联合检查，不能单独绕线造成新增交叉`,
    })
  }
  for (const detour of geometry.worstPerimeterDetours.slice(0, 2)) {
    if (!existingArrows.has(detour.edgeId)) continue
    repairTargets.push({
      concern: 'perimeter-detour', elementIds: [detour.edgeId],
      action: `${detour.edgeId} 在同分区节点外侧绕行 ${detour.outsideDistance}px，额外线路长度 ${detour.excessLength}px；应联合检查核心节点位置、端口与共享通道，不能只缩短单根线`,
    })
  }
  // Expose actual conflicting arrows for a bounded, source-preserving review.
  // Independent edges must not be disguised as a shared bundle to silence a warning.
  const overlaps = quality.issues.filter((issue) => issue.code === 'edge-overlap'
    && issue.elementIds.length === 2 && issue.elementIds.every((id) => existingArrows.has(id)))
  const overlapHotspots = rankArchitectureOverlapHotspots(scene, quality)
  const overlapDegree = new Map(overlapHotspots.map((item) => [item.edgeId, item.conflictingEdgeIds.length]))
  overlaps.sort((a, b) => b.elementIds.reduce((sum, id) => sum + (overlapDegree.get(id) ?? 0), 0)
    - a.elementIds.reduce((sum, id) => sum + (overlapDegree.get(id) ?? 0), 0)
    || a.elementIds.join('\u0000').localeCompare(b.elementIds.join('\u0000'), 'en'))
  if (quality.metrics.edgeOverlaps >= 2) {
    for (const issue of overlaps.slice(0, 2)) {
      const worst = issue.elementIds.slice().sort((a, b) => (overlapDegree.get(b) ?? 0) - (overlapDegree.get(a) ?? 0))[0]
      const count = overlapDegree.get(worst) ?? 1
      repairTargets.push({
        concern: 'overlapping-relationships',
        elementIds: issue.elementIds,
        action: `${worst} 与 ${count} 条不同关系存在重叠；应联合检查其出口走廊与分支端口，不能仅改变单根线；不得伪造共享主干，不得新增交叉、穿节点或改变语义`,
      })
    }
  }
  if (concerns.includes('weak-main-path')) repairTargets.push({
    concern: 'weak-main-path', elementIds: primaryNodeIds.slice(0, 5),
    action: '检查真实入口与核心业务路径；只根据现有关系调整主次，不得增补虚构连线',
  })
  if (concerns.includes('tiny-overview-text') || concerns.includes('wide-canvas')) repairTargets.push({
    concern: concerns.includes('tiny-overview-text') ? 'tiny-overview-text' : 'wide-canvas',
    elementIds: [],
    action: '检查适配后的字号和画布宽高；优先采用总览及分区下钻，不直接缩小字体或删除数据',
  })
  for (const overlap of geometry.worstFrameOverlaps.slice(0, 2)) {
    if (!existingGroups.has(overlap.firstGroupId) || !existingGroups.has(overlap.secondGroupId)) continue
    repairTargets.push({
      concern: 'frame-overlap', elementIds: [overlap.firstGroupId, overlap.secondGroupId],
      action: `两个无关分区重叠 ${overlap.area}px²${overlap.intrudingNodeIds.length ? `，进入对方边界的节点：${overlap.intrudingNodeIds.join('、')}` : ''}；需联合调整分区布局和关联路线，不能简单平移或缩小节点`,
    })
  }
  // The five-target budget must not hide an unreadable wide diagram behind
  // several local corridor conflicts. Preserve both diagnosis dimensions.
  const reviewPriority: Partial<Record<ArchitectureVisualConcernCode, number>> = {
    'tiny-overview-text': 0,
    'crossing-relationships': 1,
    'wide-canvas': 1,
    'weak-main-path': 2,
    'cross-boundary-intrusion': 3,
    'overlapping-relationships': 4,
    'perimeter-detour': 4,
    'frame-overlap': 3,
  }
  repairTargets.sort((a, b) => (reviewPriority[a.concern] ?? 10) - (reviewPriority[b.concern] ?? 10))
  // Each independent overlap counts one pair of relations sharing visible
  // geometry. At >= one overlapping pair per two relations, line identity is
  // no longer reliably traceable by sight. A small number of isolated pairs
  // can still be inspected in a review; this catches dense real-source graphs
  // without treating any minor crossing as automatic failure.
  const severeRelationCongestion = relations.length > 0
    && quality.metrics.edgeOverlaps * 2 >= relations.length
  const blockers: ArchitectureVisualPlan['review']['blockers'] = []
  if (quality.metrics.nodeOverlaps > 0) blockers.push('node-overlap')
  if (quality.metrics.edgeNodeIntersections > 0) blockers.push('edge-through-node')
  if (quality.metrics.labelNodeIntersections > 0) blockers.push('label-through-node')
  if (quality.metrics.edgeCrossings > 2) blockers.push('severe-edge-crossings')
  if (severeRelationCongestion) blockers.push('severe-independent-overlaps')
  if (geometry.frameOverlapArea >= scene.width * scene.height * 0.1) blockers.push('severe-frame-overlap')
  return {
    scenario, reference, recommendedView,
    nodeCount: nodes.length, relationCount: relations.length,
    primaryNodeIds, primaryRelationIds, regions,
    review: {
      readyForVisualReview: blockers.length === 0,
      blockers,
      concerns,
      repairTargets: repairTargets.slice(0, 5),
      overlapHotspots: overlapHotspots.slice(0, 5),
    },
  }
}
