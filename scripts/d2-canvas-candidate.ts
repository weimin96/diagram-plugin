import type { CanvasArrow, CanvasNode, CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureDesign.js'
import { architectureSceneToD2 } from './d2-architecture-fixture.js'

type Position = { x: number; y: number }

/** Read only the geometry of explicit rectangular D2 nodes. A missing or
 * transformed shape is a failed experiment, never an inferred coordinate. */
export function d2SvgNodePositions(svg: string, ids: readonly string[]): Map<string, Position> {
  const positions = new Map<string, Position>()
  for (const id of ids) {
    if (!/^(g\d+\.)?n\d+$/.test(id)) throw new Error(`非法 D2 节点别名：${id}`)
    // D2 v0.9.0 identifies shapes by base64 CSS classes rather than id.
    // Older D2 SVGs used plain id attributes; support both deliberately.
    const markers = [`<g class="${Buffer.from(id).toString('base64')}">`, `<g id="${id}">`]
    const hits = markers.flatMap((marker) => {
      const offset = svg.indexOf(marker)
      return offset < 0 ? [] : [{ marker, offset }]
    })
    if (hits.length !== 1) throw new Error(`D2 SVG 节点不存在或重复：${id}`)
    const [{ marker: tag, offset: start }] = hits
    if (svg.indexOf(tag, start + tag.length) >= 0) throw new Error(`D2 SVG 节点不存在或重复：${id}`)
    const shape = svg.slice(start + tag.length, start + tag.length + 2000)
    if (!/^\s*<g class="shape"\s*>/.test(shape)) throw new Error(`D2 SVG 节点结构不受支持：${id}`)
    const opening = shape.indexOf('<rect ')
    const nextClose = shape.indexOf('</g>')
    if (opening < 0 || (nextClose >= 0 && opening > nextClose)) throw new Error(`D2 SVG 节点无矩形边界：${id}`)
    const tagEnd = shape.indexOf('>', opening)
    const rect = shape.slice(opening, tagEnd)
    const get = (key: string) => {
      const value = rect.match(new RegExp(`\\b${key}="(-?\\d+(?:\\.\\d+)?)"`))?.[1]
      return value === undefined ? NaN : Number(value)
    }
    const x = get('x'), y = get('y'), w = get('width'), h = get('height')
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || Math.max(Math.abs(x), Math.abs(y), w, h) > 1e7) {
      throw new Error(`D2 SVG 节点几何无效：${id}`)
    }
    positions.set(id, { x, y })
  }
  return positions
}

/** Trial-only editable candidate. D2 chooses ordering/placement; the native
 * Canvas engine keeps all IDs, sizes, labels and relations, and reroutes edges. */
export function d2SvgToEditableCanvas(scene: CanvasScene, svg: string): CanvasScene {
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  if (!nodes.length || nodes.some((node) => node.locked)) throw new Error('D2 实验仅支持存在未锁定节点的架构画布')
  const ids = architectureSceneToD2(scene).nodes
  const positions = d2SvgNodePositions(svg, ids.map((item) => item.d2Id))
  const minX = Math.min(...[...positions.values()].map((item) => item.x))
  const minY = Math.min(...[...positions.values()].map((item) => item.y))
  const shifted = new Map(ids.map((item) => [item.canvasId, {
    x: Math.round(positions.get(item.d2Id)!.x - minX + 96),
    y: Math.round(positions.get(item.d2Id)!.y - minY + 170),
  }]))
  const width = Math.max(960, ...nodes.map((node) => shifted.get(node.id)!.x + node.width + 96))
  const height = Math.max(680, ...nodes.map((node) => shifted.get(node.id)!.y + node.height + 96))
  const candidate: CanvasScene = {
    ...scene, width, height,
    elements: scene.elements.map((item) => {
      if (item.type === 'arrow') {
        const arrow: CanvasArrow = { ...item, routing: 'orthogonal', points: undefined,
          fromAnchor: undefined, toAnchor: undefined, bundleKey: undefined, start: undefined, end: undefined }
        return arrow
      }
      const position = shifted.get(item.id)
      return position ? { ...item, ...position } : item
    }),
  }
  return routeArchitectureEdges(candidate)
}
