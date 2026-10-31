import type { ArchitectureIntentGraph } from './architectureComposer.js'
import { buildLayeredTemplateScene, type LayeredTemplateLayer } from './canvasTemplates.js'
import { routeArchitectureEdges } from './architectureRouting.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { assessArchitectureRouteDiagnostics } from './architectureRouteDiagnostics.js'
import { assessArchitecturePresentation } from './architecturePresentationQuality.js'
import { planArchitectureVisual } from './architectureVisualPlan.js'
import { canvasVisualSkin } from './diagramVisualStyles.js'
import { canvasEnterpriseModuleTextLayout, resolveCanvasArchitectureDensity, type CanvasArrow, type CanvasNode, type CanvasScene } from './canvas.js'

const regionNames: Record<NonNullable<ArchitectureIntentGraph['nodes'][number]['partition']>, string> = {
  external: '外部与参与方', experience: '访问与接入层', application: '业务应用层',
  processing: '处理与服务层', data: '数据与基础设施层',
}
const regionColors = ['#e3eff8', '#e6f1eb', '#e8eef9', '#f3eaf4', '#e8f2f2', '#f5eee2']
const bandGap = 44

/** Layer membership comes from evidence; only presentation order is negotiable. */
function orderConnectedModules(
  entries: Array<[string, ArchitectureIntentGraph['nodes']]>,
  relations: ArchitectureIntentGraph['relations'],
  passes: number,
): Array<[string, ArchitectureIntentGraph['nodes']]> {
  const ordered = entries.map(([label, nodes]) => [label, [...nodes]] as [string, ArchitectureIntentGraph['nodes']])
  const membership = new Map(ordered.flatMap(([, nodes], index) => nodes.map((node) => [node.id, index] as const)))
  const neighbours = new Map<string, string[]>()
  for (const edge of relations) {
    if (membership.get(edge.from) === membership.get(edge.to)) continue
    neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to])
    neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from])
  }
  for (let pass = 0; pass < passes; pass += 1) {
    for (const direction of [1, -1]) {
      const order = direction === 1 ? [...ordered.keys()] : [...ordered.keys()].reverse()
      for (const layer of order) {
        const nodes = ordered[layer][1]
        const positions = new Map(ordered.flatMap(([, peers], layerIndex) =>
          peers.map((node, index) => [node.id, { layer: layerIndex, index, count: peers.length }] as const)))
        const scores = new Map(nodes.map((node, index) => {
          const targets = (neighbours.get(node.id) ?? []).flatMap((id) => {
            const target = positions.get(id)
            return target && (target.layer - layer) * direction < 0
              ? [target.index / Math.max(1, target.count - 1)] : []
          })
          return [node.id, targets.length ? targets.reduce((sum, value) => sum + value, 0) / targets.length : index / Math.max(1, nodes.length - 1)] as const
        }))
        nodes.sort((a, b) => (scores.get(a.id)! - scores.get(b.id)!) || a.id.localeCompare(b.id))
      }
    }
  }
  return ordered
}

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
  const originalEntries = [...layers.entries()]
  if (intent.relations.length < 2) return composeLayeredCandidate(intent, originalEntries, bandGap)
  const connectedOrder = orderConnectedModules(originalEntries, intent.relations, 1)
  const reordered = connectedOrder.some(([, nodes], layer) => nodes.some((node, index) =>
    node.id !== originalEntries[layer][1][index].id))
  // The barycentric ordering frequently matches the verified input order.
  // Rerouting the same grid a second time only burns compute without adding a candidate.
  const candidates = reordered ? [originalEntries, connectedOrder] : [originalEntries]
  const configurations = [bandGap, bandGap + 32, bandGap + 64]
  const outputs = candidates.flatMap((entries) => configurations.map((gap) => composeLayeredCandidate(intent, entries, gap)))
  // The historic fixed four-column layout puts 5–8 modules into jagged rows.
  // Try at most two wider, aligned grid geometries; the final routed scene
  // must beat the original in *all* hard safety metrics before adoption.
  const maxLayerSize = Math.max(...originalEntries.map(([, nodes]) => nodes.length))
  if (maxLayerSize >= 5) {
    const alternativeColumns = [...new Set([Math.min(5, maxLayerSize), Math.min(6, maxLayerSize)])]
    for (const columns of alternativeColumns) {
      outputs.push(composeLayeredCandidate(intent, connectedOrder, bandGap + 64, columns))
    }
  }
  const baseline = outputs[0]
  const clippedTitles = (scene: CanvasScene) => scene.elements.filter((item) => item.type === 'node'
    && canvasEnterpriseModuleTextLayout(item, false).typography.truncated).length
  const baselineClippedTitles = clippedTitles(baseline.scene)
  const eligible = outputs.slice(1).filter((candidate) => {
    const before = baseline.quality.metrics, after = candidate.quality.metrics
    return after.nodeOverlaps <= before.nodeOverlaps
      && after.edgeNodeIntersections <= before.edgeNodeIntersections
      && after.labelNodeIntersections <= before.labelNodeIntersections
      && after.labelOverlaps <= before.labelOverlaps
      && after.labelOverflows <= before.labelOverflows
      && after.edgeCrossings <= before.edgeCrossings
      && after.edgeOverlaps <= before.edgeOverlaps
      && candidate.routeDiagnostics.unrelatedFrameIntrusionLength <= baseline.routeDiagnostics.unrelatedFrameIntrusionLength
      && candidate.routeDiagnostics.terminalNormalViolations <= baseline.routeDiagnostics.terminalNormalViolations
      && candidate.routeDiagnostics.nonOrthogonalSegments <= baseline.routeDiagnostics.nonOrthogonalSegments
      && candidate.routeDiagnostics.frameOverlaps <= baseline.routeDiagnostics.frameOverlaps
      && candidate.routeDiagnostics.totalRouteLength <= baseline.routeDiagnostics.totalRouteLength * 1.2
      && clippedTitles(candidate.scene) <= baselineClippedTitles
      && candidate.presentation.estimatedTitlePxAtFit >= baseline.presentation.estimatedTitlePxAtFit
      && candidate.scene.width <= baseline.scene.width * 1.42
      && candidate.scene.height <= baseline.scene.height * 1.3
      && (after.edgeCrossings < before.edgeCrossings || after.edgeOverlaps < before.edgeOverlaps
        || candidate.routeDiagnostics.unrelatedFrameIntrusionLength < baseline.routeDiagnostics.unrelatedFrameIntrusionLength)
  })
  eligible.sort((a, b) => (a.quality.metrics.edgeCrossings * 5 + a.quality.metrics.edgeOverlaps * 2
    + a.routeDiagnostics.unrelatedFrameIntrusionLength / 100)
    - (b.quality.metrics.edgeCrossings * 5 + b.quality.metrics.edgeOverlaps * 2
      + b.routeDiagnostics.unrelatedFrameIntrusionLength / 100))
  const selected = eligible[0] ?? baseline
  const boxes = new Map(selected.scene.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const sourceX = (id: string) => {
    const node = boxes.get(id)!
    return node.x + node.width / 2
  }
  const arrows = selected.scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const routeOrders = [
    arrows.slice().reverse(),
    arrows.slice().sort((a, b) => sourceX(a.from) - sourceX(b.from) || a.id.localeCompare(b.id)),
    arrows.slice().sort((a, b) => Math.abs(sourceX(b.from) - sourceX(b.to)) - Math.abs(sourceX(a.from) - sourceX(a.to))
      || a.id.localeCompare(b.id)),
  ]
  let best = selected
  for (const order of routeOrders) {
    const rerouted = routeArchitectureEdges({
      ...selected.scene,
      elements: [
        ...selected.scene.elements.filter((item) => item.type !== 'arrow'),
        ...order.map(({ points: _points, bundleKey: _bundle, fromAnchor: _from, toAnchor: _to,
          fromPortRatio: _fromRatio, toPortRatio: _toRatio, ...arrow }) => arrow),
      ],
    })
    const byId = new Map(rerouted.elements.filter((item): item is CanvasArrow => item.type === 'arrow').map((item) => [item.id, item]))
    const scene: CanvasScene = {
      ...selected.scene,
      elements: selected.scene.elements.map((item) => item.type === 'arrow'
        ? { ...byId.get(item.id)!, lineStyle: item.lineStyle, label: item.label, emphasis: item.emphasis } : item),
    }
    const quality = assessCanvasVisualQuality(scene)
    const routes = assessArchitectureRouteDiagnostics(scene)
    const before = selected.quality.metrics
    const after = quality.metrics
    if (after.nodeOverlaps > before.nodeOverlaps || after.edgeNodeIntersections > before.edgeNodeIntersections
      || after.labelNodeIntersections > before.labelNodeIntersections || after.labelOverlaps > before.labelOverlaps
      || after.labelOverflows > before.labelOverflows || after.edgeCrossings > before.edgeCrossings
      || after.edgeOverlaps > before.edgeOverlaps
      || routes.unrelatedFrameIntrusionLength > selected.routeDiagnostics.unrelatedFrameIntrusionLength
      || routes.terminalNormalViolations > selected.routeDiagnostics.terminalNormalViolations
      || routes.nonOrthogonalSegments > selected.routeDiagnostics.nonOrthogonalSegments
      || routes.totalRouteLength > selected.routeDiagnostics.totalRouteLength * 1.1) continue
    const score = (assessment: typeof quality) => assessment.metrics.edgeCrossings * 5 + assessment.metrics.edgeOverlaps * 2
    if (score(quality) >= score(best.quality)) continue
    const presentation = assessArchitecturePresentation(scene)
    const visualPlan = planArchitectureVisual(scene, 'layered', quality, presentation, routes)
    best = {
      ...selected, scene, quality, routeDiagnostics: routes, presentation, visualPlan,
      summary: { ...selected.summary, bundledEdges: scene.elements.filter((item) =>
        item.type === 'arrow' && Boolean(item.bundleKey)).length },
    }
  }
  return best
}

function composeLayeredCandidate(intent: ArchitectureIntentGraph, entries: Array<[string, ArchitectureIntentGraph['nodes']]>, gap: number, requestedColumns?: number) {
  const maxLayerSize = Math.max(...entries.map(([, nodes]) => nodes.length))
  const compact = maxLayerSize <= 4
  const tightMatrix = intent.relations.length === 0
  const columns = requestedColumns ?? (tightMatrix ? Math.min(6, Math.max(2, maxLayerSize)) : compact ? Math.max(2, maxLayerSize) : 4)
  const nodeWidth = tightMatrix ? 182 : requestedColumns ? (requestedColumns >= 6 ? 190 : 220) : compact ? 206 : 248
  const nodeHeight = tightMatrix ? 70 : compact ? 74 : 88
  const columnGap = tightMatrix ? 16 : requestedColumns ? (requestedColumns >= 6 ? 14 : 20) : compact ? 22 : 28
  const rowGap = tightMatrix ? 18 : compact ? 22 : 24
  const leftInset = tightMatrix ? 192 : compact ? 202 : 220
  const topInset = tightMatrix ? 82 : compact ? 84 : 90
  const specs: LayeredTemplateLayer[] = entries.map(([label, nodes], index) => ({
    label, fillColor: regionColors[index % regionColors.length],
    nodes: nodes.map((node) => ({ text: node.text, subtitle: node.subtitle, icon: node.icon, width: nodeWidth, height: nodeHeight })),
  }))
  const template = buildLayeredTemplateScene(intent.title, { layers: specs })
  const templateNodes = new Map(template.elements.filter((item): item is CanvasNode => item.type === 'node').map((item) => [item.id, item]))
  const primaryNodes = new Set(intent.primaryPath ?? [])
  const primaryStroke = canvasVisualSkin(intent.style ?? 'ocean', false, 'accent')?.stroke
  const elements: CanvasScene['elements'] = []
  let y = topInset
  for (const [layerIndex, [, nodes]] of entries.entries()) {
    nodes.forEach((node, nodeIndex) => {
      const seed = templateNodes.get(`layer-${layerIndex + 1}-${nodeIndex + 1}`)!
      const { layer: _layer, partition: _partition, ...metadata } = node
      elements.push({
        ...seed, ...metadata, id: node.id, groupId: `__arch-layer-${layerIndex + 1}`,
        fontSize: 15,
        ...(primaryNodes.has(node.id) ? { emphasis: 'primary' as const, strokeColor: primaryStroke, strokeWidth: 2 } : {}),
        x: leftInset + (nodeIndex % columns) * (nodeWidth + columnGap),
        y: y + Math.floor(nodeIndex / columns) * (nodeHeight + rowGap),
      })
    })
    y += Math.ceil(nodes.length / columns) * (nodeHeight + rowGap) + gap + (compact ? 14 : 0)
  }
  const primaryRelations = new Set((intent.primaryPath ?? []).slice(1).map((node, index) => `${intent.primaryPath![index]}\u0000${node}`))
  const arrows: CanvasArrow[] = intent.relations.map((relation, index) => ({
    id: `__relation-${index + 1}`, type: 'arrow', from: relation.from, to: relation.to,
    ...(relation.label ? { label: relation.label } : {}),
    lineStyle: relation.asynchronous ? 'dashed' : 'solid',
    routing: 'orthogonal', markerEnd: 'arrow',
    emphasis: primaryRelations.has(`${relation.from}\u0000${relation.to}`) ? 'primary'
      : intent.relations.length >= 32 ? 'muted' : 'secondary',
  }))
  const routed = routeArchitectureEdges({
    ...template,
    groups: template.groups?.map((group, index) => ({ ...group, id: `__arch-layer-${index + 1}` })),
    width: Math.max(tightMatrix ? 680 : compact ? 800 : 1500, leftInset + columns * (nodeWidth + columnGap) + (tightMatrix ? 36 : 48)),
    height: Math.max(tightMatrix ? 480 : compact ? 520 : 720, y + (tightMatrix ? 22 : compact ? 24 : 40)),
    style: intent.style ?? 'ocean',
    architecture: {
      theme: intent.theme ?? 'presentation', diagramStyle: 'enterprise', view: 'detail', density: intent.density ?? 'auto',
      ...(intent.visualScenario ? { scenario: intent.visualScenario } : {}),
    },
    elements: [...elements, ...arrows],
  })
  const intendedStyles = new Map(arrows.map((arrow) => [arrow.id, arrow.lineStyle] as const))
  const scene: CanvasScene = { ...routed, elements: routed.elements.map((item) => item.type === 'arrow'
    ? { ...item, lineStyle: intendedStyles.get(item.id) ?? item.lineStyle } : item) }
  const quality = assessCanvasVisualQuality(scene)
  const routeDiagnostics = assessArchitectureRouteDiagnostics(scene)
  const presentation = assessArchitecturePresentation(scene)
  const visualPlan = planArchitectureVisual(scene, 'layered', quality, presentation, routeDiagnostics)
  return {
    scene, quality, visualPlan, presentation, routeDiagnostics,
    semanticComposition: 'layered' as const,
    summary: { theme: scene.architecture!.theme, composition: 'layered' as const, partitions: entries.length,
      enrichedNodes: elements.length, routedEdges: arrows.length, primaryNodes: intent.primaryPath?.length ?? 0,
      bundledEdges: scene.elements.filter((item) => item.type === 'arrow' && Boolean(item.bundleKey)).length,
      view: 'detail' as const, density: scene.architecture!.density!, resolvedDensity: resolveCanvasArchitectureDensity(scene) },
    evaluation: undefined, candidates: [], inputOrderStrategy: 'verified-layer-order',
    layoutOrderingStrategy: 'verified-layer-order', reroutedEdges: arrows.length, reorderedPairs: 0,
  }
}
