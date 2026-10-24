import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkNode } from 'elkjs/lib/elk-api.js'
import type { CanvasAnchor, CanvasArrow, CanvasNode, CanvasPoint, CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureDesign.js'

const engine = new ELK()
export type ElkBenchmarkVariant = 'flat' | 'compound' | 'native'

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

function nearestSide(node: CanvasNode, point: CanvasPoint): CanvasAnchor {
  const distances: Array<[CanvasAnchor, number]> = [
    ['left', Math.abs(point.x - node.x)],
    ['right', Math.abs(point.x - node.x - node.width)],
    ['top', Math.abs(point.y - node.y)],
    ['bottom', Math.abs(point.y - node.y - node.height)],
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][0]
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
    children: variant !== 'compound'
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
  const relocated = new Map(nodes.map((node) => {
    const position = absolute.get(node.id)
    return [node.id, {
      ...node,
      x: position ? Math.round(position.x + margin) : node.x,
      y: position ? Math.round(position.y + margin) : node.y,
    }] as const
  }))
  const elkEdges = new Map((layout.edges ?? []).map((edge) => [edge.id, edge]))
  const repositioned: CanvasScene = {
    ...scene,
    width,
    height,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') {
        const clean: CanvasArrow = { ...item, routing: 'orthogonal', points: undefined,
          fromAnchor: undefined, toAnchor: undefined, bundleKey: undefined, start: undefined, end: undefined }
        if (variant !== 'native') return clean
        const edge = elkEdges.get(item.id)
        const sections = edge?.sections
        const from = relocated.get(item.from), to = relocated.get(item.to)
        if (!from || !to || !sections?.length || sections.length !== 1) {
          throw new Error(`Missing or unsupported ELK native edge sections for ${item.id}`)
        }
        const section = sections[0]
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
          .map((point) => ({ x: Math.round(point.x + margin), y: Math.round(point.y + margin) }))
        if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
          throw new Error(`Invalid ELK edge points for ${item.id}`)
        }
        return {
          ...clean,
          fromAnchor: nearestSide(from, points[0]),
          toAnchor: nearestSide(to, points.at(-1)!),
          // Keep ELK's actual port offsets as editable waypoints, while the
          // canonical Canvas anchors remain on the node boundary.
          points,
        }
      }
      const position = absolute.get(item.id)
      return position && !item.locked
        ? { ...item, x: Math.round(position.x + margin), y: Math.round(position.y + margin) }
        : item
    }),
  }
  // Reuse the project's canonical editable routing model. This isolates the
  // ordering/positioning contribution of ELK without inventing new arrow semantics.
  return variant === 'native' ? repositioned : routeArchitectureEdges(repositioned)
}
