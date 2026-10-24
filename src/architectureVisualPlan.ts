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
  | 'overlapping-relationships'

export interface ArchitectureVisualRepairTarget {
  concern: ArchitectureVisualConcernCode
  /** IDs are always drawn from an existing scene, never invented. */
  elementIds: string[]
  action: string
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
    concerns: ArchitectureVisualConcernCode[]
    /** Bounded, evidence-based suggestions; not claims that a visual reviewer has inspected pixels. */
    repairTargets: ArchitectureVisualRepairTarget[]
  }
}

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
  const recommendedView = nodes.length >= 22 || relations.length >= 30
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
  const repairTargets: ArchitectureVisualRepairTarget[] = []
  const existingArrows = new Set(relations.map((edge) => edge.id))
  const existingGroups = new Set((scene.groups ?? []).map((group) => group.id))
  for (const intrusion of geometry.worstFrameIntrusions.slice(0, 3)) {
    if (!existingArrows.has(intrusion.edgeId) || !existingGroups.has(intrusion.frameId)) continue
    repairTargets.push({
      concern: 'cross-boundary-intrusion',
      elementIds: [intrusion.edgeId, intrusion.frameId],
      action: `检查跨区线路经过无关分区 ${intrusion.length}px；应与关联线路联合检查，不能单独绕线造成新增交叉`,
    })
  }
  // Expose actual conflicting arrows for a bounded, source-preserving review.
  // Independent edges must not be disguised as a shared bundle to silence a warning.
  const overlaps = quality.issues.filter((issue) => issue.code === 'edge-overlap'
    && issue.elementIds.length === 2 && issue.elementIds.every((id) => existingArrows.has(id)))
  const overlapDegree = new Map<string, number>()
  overlaps.forEach((issue) => issue.elementIds.forEach((id) =>
    overlapDegree.set(id, (overlapDegree.get(id) ?? 0) + 1)))
  overlaps.sort((a, b) => b.elementIds.reduce((sum, id) => sum + (overlapDegree.get(id) ?? 0), 0)
    - a.elementIds.reduce((sum, id) => sum + (overlapDegree.get(id) ?? 0), 0))
  if (quality.metrics.edgeOverlaps >= 2) {
    for (const issue of overlaps.slice(0, 2)) {
      repairTargets.push({
        concern: 'overlapping-relationships',
        elementIds: issue.elementIds,
        action: '复核这两条真实依赖的正交走廊与分支端口；仅在没有新增交叉、穿节点或语义变化时局部重布线，不得伪造共享主干',
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
  if (concerns.includes('frame-overlap')) repairTargets.push({
    concern: 'frame-overlap', elementIds: [],
    action: '检查无关同级分区边界的交叠及分区内节点；先调整分区构图再评估线路',
  })
  // The five-target budget must not hide an unreadable wide diagram behind
  // several local corridor conflicts. Preserve both diagnosis dimensions.
  const reviewPriority: Partial<Record<ArchitectureVisualConcernCode, number>> = {
    'tiny-overview-text': 0,
    'wide-canvas': 1,
    'weak-main-path': 2,
    'cross-boundary-intrusion': 3,
    'overlapping-relationships': 4,
    'frame-overlap': 5,
  }
  repairTargets.sort((a, b) => (reviewPriority[a.concern] ?? 10) - (reviewPriority[b.concern] ?? 10))
  return {
    scenario, reference, recommendedView,
    nodeCount: nodes.length, relationCount: relations.length,
    primaryNodeIds, primaryRelationIds, regions,
    review: {
      readyForVisualReview: quality.metrics.nodeOverlaps === 0
        && quality.metrics.edgeNodeIntersections === 0
        && quality.metrics.labelNodeIntersections === 0,
      concerns,
      repairTargets: repairTargets.slice(0, 5),
    },
  }
}
