import type { CanvasArrow, CanvasNode, CanvasScene } from '../src/canvas.js'

/** Development-only D2 source derived from the exact generated architecture
 * semantics. Stable aliases avoid escaping arbitrary graph IDs in D2 paths.
 * This is for comparing layout choices, not importing D2 SVG as editable Canvas. */
export function architectureSceneToD2(scene: CanvasScene): {
  source: string
  nodes: Array<{ canvasId: string; d2Id: string }>
  relations: Array<{ canvasId: string; from: string; to: string }>
} {
  const nodes = scene.elements.filter((element): element is CanvasNode => element.type === 'node')
  const relations = scene.elements.filter((element): element is CanvasArrow => element.type === 'arrow')
  const groupIds = [...new Set(nodes.map((node) => node.groupId).filter((id): id is string => Boolean(id)))]
  const groups = new Map(groupIds.map((id, index) => [id, `g${index}`]))
  const byNodeId = new Map(nodes.map((node, index) => [node.id, `n${index}`]))
  if (byNodeId.size !== nodes.length) throw new Error('重复架构节点 ID')
  for (const edge of relations) {
    if (!byNodeId.has(edge.from) || !byNodeId.has(edge.to)) throw new Error(`悬空架构关系：${edge.id}`)
  }

  const quote = (value: string) => JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim())
  const groupLabels = new Map((scene.groups ?? []).map((group) => [group.id, group.label]))
  const declaration = (node: CanvasNode, indent = '') =>
    `${indent}${byNodeId.get(node.id)}: ${quote(node.text)}`
  const lines = [
    '# Diagram Plugin experimental benchmark; only semantic nodes and directional relations',
    'direction: right',
  ]
  for (const [id, alias] of groups) {
    lines.push(`${alias}: {`, `  label: ${quote(groupLabels.get(id) ?? id)}`)
    for (const node of nodes.filter((item) => item.groupId === id)) lines.push(declaration(node, '  '))
    lines.push('}')
  }
  for (const node of nodes.filter((item) => !item.groupId)) lines.push(declaration(node))
  const fullId = (id: string) => {
    const node = nodes.find((item) => item.id === id)!
    const alias = byNodeId.get(id)!
    return node.groupId ? `${groups.get(node.groupId)}.${alias}` : alias
  }
  for (const edge of relations) {
    const relationLabel = edge.label || (edge.lineStyle === 'dashed' ? '异步' : '')
    lines.push(`${fullId(edge.from)} -> ${fullId(edge.to)}${relationLabel ? `: ${quote(relationLabel)}` : ''}`)
  }
  return {
    source: lines.join('\n') + '\n',
    nodes: nodes.map((node) => ({ canvasId: node.id, d2Id: fullId(node.id) })),
    relations: relations.map((edge) => ({ canvasId: edge.id, from: edge.from, to: edge.to })),
  }
}
