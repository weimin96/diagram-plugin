import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api.js'
import type { CanvasNode, CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureDesign.js'

const engine = new ELK()
export type ElkBenchmarkVariant = 'flat' | 'compound'

type Shape = { id: string; x?: number; y?: number; width?: number; height?: number; children?: Shape[] }

function collectPositions(shapes: readonly Shape[] | undefined, map = new Map<string, { x: number; y: number }>(), x = 0, y = 0) {
  for (const shape of shapes ?? []) {
    const absoluteX = x + (shape.x ?? 0)
    const absoluteY = y + (shape.y ?? 0)
    map.set(shape.id, { x: absoluteX, y: absoluteY })
    collectPositions(shape.children, map, absoluteX, absoluteY)
  }
  return map
}

/** Prototype adapter: geometry only. Existing CanvasScene is never changed in place. */
export async function layoutWithElk(scene: CanvasScene, variant: ElkBenchmarkVariant): Promise<CanvasScene> {
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const arrows = scene.elements.filter((item) => item.type === 'arrow')
  if (!nodes.length) throw new Error('No Canvas nodes to lay out')
  const nodeIds = new Set(nodes.map((item) => item.id))
  const children = nodes.map((node) => ({ id: node.id, width: node.width, height: node.height }))
  const edges = arrows.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] }))
  if (edges.length !== arrows.length) throw new Error('Invalid relation endpoint')

  const groups = new Map<string, typeof children>()
  const others: typeof children = []
  if (variant === 'compound') {
    const inputNodes = new Map(nodes.map((node) => [node.id, node]))
    for (const child of children) {
      const groupId = inputNodes.get(child.id)?.groupId
      if (!groupId) others.push(child)
      else groups.set(groupId, [...(groups.get(groupId) ?? []), child])
    }
  }
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.padding': '[top=35,left=35,bottom=35,right=35]',
      ...(variant === 'compound' ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
    },
    children: variant === 'flat'
      ? children
      : [
        ...others,
        ...[...groups.entries()].map(([id, entries]) => ({
          id,
          children: entries,
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'DOWN',
            'elk.padding': '[top=40,left=25,bottom=25,right=25]',
            'elk.spacing.nodeNode': '40',
          },
        })),
      ],
    edges,
  }
  // We only exercise ELK in an explicitly invoked dev benchmark. No runtime
  // engine switch, bundled worker, persisted schema change or production migration.
  const layout = await engine.layout(graph)
  const absolute = collectPositions(layout.children)
  const margin = 30
  const width = Math.ceil((layout.width ?? 1200) + 2 * margin)
  const height = Math.ceil((layout.height ?? 800) + 2 * margin)
  const repositioned: CanvasScene = {
    ...scene,
    width,
    height,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') return {
        ...item, points: undefined, fromAnchor: undefined, toAnchor: undefined,
        bundleKey: undefined, start: undefined, end: undefined,
      }
      const position = absolute.get(item.id)
      return position && !item.locked
        ? { ...item, x: Math.round(position.x + margin), y: Math.round(position.y + margin) }
        : item
    }),
  }
  // Reuse the project's canonical editable routing model. This isolates the
  // ordering/positioning contribution of ELK without inventing new arrow semantics.
  return routeArchitectureEdges(repositioned)
}
