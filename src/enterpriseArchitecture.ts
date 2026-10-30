import type { ArchitectureIntentGraph } from './architectureComposer.js'
import { buildLayeredTemplateScene, type LayeredTemplateLayer } from './canvasTemplates.js'
import { routeArchitectureEdges } from './architectureRouting.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import { assessArchitecturePresentation } from './architecturePresentationQuality.js'
import { planArchitectureVisual } from './architectureVisualPlan.js'
import type { CanvasArrow, CanvasNode, CanvasScene } from './canvas.js'

const regionNames: Record<NonNullable<ArchitectureIntentGraph['nodes'][number]['partition']>, string> = {
  external: '外部与参与方', experience: '访问与接入层', application: '业务应用层',
  processing: '处理与服务层', data: '数据与基础设施层',
}
const regionColors = ['#e7f1fc', '#e7f4f1', '#f0ecfc', '#fdf0e0', '#e7f0f8', '#f5edf3']
const columns = 4
const nodeWidth = 248
const nodeHeight = 88
const columnGap = 28
const rowGap = 24
const leftInset = 220
const topInset = 90
const bandGap = 44

/** Formal proposal view: only user/source-confirmed layer names, modules, and relations. */
export function composeEnterpriseArchitecture(intent: ArchitectureIntentGraph) {
  const ids = new Set<string>()
  const layers = new Map<string, typeof intent.nodes>()
  for (const node of intent.nodes) {
    if (ids.has(node.id)) throw new Error(`架构节点 ID 重复：${node.id}`)
    ids.add(node.id)
    const layer = node.layer?.trim() || (node.partition ? regionNames[node.partition] : undefined)
    if (!layer) throw new Error(`节点「${node.text}」缺少已确认的 layer 或 partition，不能臆造企业方案分层。`)
    layers.set(layer, [...(layers.get(layer) ?? []), node])
  }
  if (layers.size < 2) throw new Error('企业方案风格至少需要两个有事实依据的层级；请先确认业务/技术分层。')
  for (const relation of intent.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) throw new Error(`架构关系引用不存在的节点：${relation.from} → ${relation.to}`)
  }
  if (intent.primaryPath) {
    if (new Set(intent.primaryPath).size !== intent.primaryPath.length || intent.primaryPath.some((id) => !ids.has(id))) {
      throw new Error('架构主链必须引用互不重复的已有节点。')
    }
    for (let i = 1; i < intent.primaryPath.length; i += 1) {
      if (!intent.relations.some((relation) => relation.from === intent.primaryPath![i - 1] && relation.to === intent.primaryPath![i])) {
        throw new Error(`架构主链缺少实际有向关系：${intent.primaryPath[i - 1]} → ${intent.primaryPath[i]}`)
      }
    }
  }
  const entries = [...layers.entries()]
  const specs: LayeredTemplateLayer[] = entries.map(([label, nodes], index) => ({
    label, fillColor: regionColors[index % regionColors.length],
    nodes: nodes.map((node) => ({ text: node.text, subtitle: node.subtitle, icon: node.icon, width: nodeWidth, height: nodeHeight })),
  }))
  const template = buildLayeredTemplateScene(intent.title, { layers: specs })
  const elements: CanvasScene['elements'] = []
  let y = topInset
  for (const [layerIndex, [, nodes]] of entries.entries()) {
    nodes.forEach((node, nodeIndex) => {
      const seed = template.elements.find((element) => element.id === `layer-${layerIndex + 1}-${nodeIndex + 1}`) as CanvasNode
      const { layer: _layer, partition: _partition, ...metadata } = node
      elements.push({
        ...seed, ...metadata, id: node.id, groupId: `__arch-layer-${layerIndex + 1}`,
        x: leftInset + (nodeIndex % columns) * (nodeWidth + columnGap),
        y: y + Math.floor(nodeIndex / columns) * (nodeHeight + rowGap),
      })
    })
    y += Math.ceil(nodes.length / columns) * (nodeHeight + rowGap) + bandGap
  }
  const primaryRelations = new Set((intent.primaryPath ?? []).slice(1).map((node, index) => `${intent.primaryPath![index]}\u0000${node}`))
  const arrows: CanvasArrow[] = intent.relations.map((relation, index) => ({
    id: `__relation-${index + 1}`, type: 'arrow', from: relation.from, to: relation.to,
    ...(relation.label ? { label: relation.label } : {}),
    lineStyle: relation.asynchronous ? 'dashed' : 'solid',
    routing: 'orthogonal', markerEnd: 'arrow',
    emphasis: primaryRelations.has(`${relation.from}\u0000${relation.to}`) ? 'primary' : 'secondary',
  }))
  const scene = routeArchitectureEdges({
    ...template,
    groups: template.groups?.map((group, index) => ({ ...group, id: `__arch-layer-${index + 1}` })),
    width: Math.max(1500, leftInset + columns * (nodeWidth + columnGap) + 48),
    height: Math.max(720, y + 40),
    style: intent.style ?? 'ocean',
    architecture: {
      theme: intent.theme ?? 'presentation', diagramStyle: 'enterprise', view: 'detail', density: intent.density ?? 'comfortable',
      ...(intent.visualScenario ? { scenario: intent.visualScenario } : {}),
    },
    elements: [...elements, ...arrows],
  })
  const quality = assessCanvasVisualQuality(scene)
  const routeDiagnostics = assessArchitectureRouteDiagnostics(scene)
  const presentation = assessArchitecturePresentation(scene)
  const visualPlan = planArchitectureVisual(scene, 'layered', quality, presentation, routeDiagnostics)
  return {
    scene, quality, visualPlan, presentation, routeDiagnostics,
    semanticComposition: 'layered' as const,
    summary: { theme: scene.architecture!.theme, composition: 'layered' as const, partitions: entries.length,
      enrichedNodes: elements.length, routedEdges: arrows.length, primaryNodes: intent.primaryPath?.length ?? 0,
      bundledEdges: 0, view: 'detail' as const, density: scene.architecture!.density!, resolvedDensity: 'comfortable' as const },
    evaluation: undefined, candidates: [], inputOrderStrategy: 'verified-layer-order',
    layoutOrderingStrategy: 'verified-layer-order', reroutedEdges: arrows.length, reorderedPairs: 0,
  }
}
