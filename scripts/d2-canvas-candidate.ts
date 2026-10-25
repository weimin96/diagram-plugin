import { anchorPoint, type CanvasAnchor, type CanvasArrow, type CanvasNode, type CanvasPoint, type CanvasScene } from '../src/canvas.js'
import { routeArchitectureEdges } from '../src/architectureDesign.js'
import { architectureSceneToD2 } from './d2-architecture-fixture.js'

type Position = { x: number; y: number }

/** D2 SVG encodes edge IDs as base64 CSS classes. Only accept an exact,
 * uniquely matched semantic edge; never borrow another edge's SVG path. */
export function d2SvgEdgePaths(svg: string, aliases: readonly string[]): Map<string, CanvasPoint[]> {
  const paths = new Map<string, CanvasPoint[]>()
  for (const alias of aliases) {
    const markers = [alias, alias.replaceAll('->', '-&gt;')].map((value) =>
      `<g class="${Buffer.from(value).toString('base64')}">`)
    const hits = markers.flatMap((marker) => {
      const index = svg.indexOf(marker)
      return index < 0 ? [] : [{ marker, index }]
    })
    if (hits.length !== 1 || svg.indexOf(hits[0].marker, hits[0].index + hits[0].marker.length) >= 0) {
      throw new Error(`D2 原生关系不存在或重复：${alias}`)
    }
    const { index, marker } = hits[0]
    const nextGroup = svg.slice(index + marker.length).search(/<g class="[A-Za-z0-9+/=]{8,}">/)
    const content = svg.slice(index + marker.length, nextGroup < 0 ? undefined : index + marker.length + nextGroup)
    const matches = [...content.matchAll(/<path\s+d="([^"]+)"[^>]*class="connection\b[^"]*"[^>]*>/g)]
    if (matches.length !== 1) throw new Error(`D2 原生关系路径缺失或重复：${alias}`)
    paths.set(alias, d2OrthogonalPath(matches[0][1]))
  }
  return paths
}

/** TALA / D2 ELK SVGs use M/L/S for straight segments and rounded corners.
 * S control points are retained as square bends; arbitrary Bezier C/Q paths
 * cannot be represented by an orthogonal CanvasArrow and are rejected. */
export function d2OrthogonalPath(path: string): CanvasPoint[] {
  const tokenPattern = /[MLSHVCQZmlshvcqz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g
  const tokens = path.match(tokenPattern) ?? []
  if (path.replace(tokenPattern, '').replace(/[\s,]/g, '')) {
    throw new Error(`D2 原生折线路径包含不识别的内容：${path}`)
  }
  const points: CanvasPoint[] = []
  let i = 0
  while (i < tokens.length) {
    const command = tokens[i++]
    const number = () => {
      const token = tokens[i++]
      const value = Number(token)
      if (!token || !Number.isFinite(value) || /[A-Za-z]/.test(token.replace(/[eE][-+]?\d+$/, ''))) {
        throw new Error(`D2 原生折线路径无效：${path}`)
      }
      return value
    }
    if (command === 'M' || command === 'L') points.push({ x: number(), y: number() })
    else if (command === 'S') {
      points.push({ x: number(), y: number() }, { x: number(), y: number() })
    } else if (command === 'H' && points.length) points.push({ x: number(), y: points.at(-1)!.y })
    else if (command === 'V' && points.length) points.push({ x: points.at(-1)!.x, y: number() })
    else throw new Error(`D2 原生路径不支持的命令：${command}`)
  }
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    || points.slice(1).some((point, index) => point.x !== points[index].x && point.y !== points[index].y)) {
    throw new Error(`D2 原生关系不是正交折线：${path}`)
  }
  const deduped = points.filter((point, index) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  if (deduped.length < 2) throw new Error(`D2 原生关系退化为空路径：${path}`)
  return deduped
}

export function d2RelationAliases(scene: CanvasScene): Array<{ canvasId: string; alias: string }> {
  const fixture = architectureSceneToD2(scene)
  const byNode = new Map(fixture.nodes.map((node) => [node.canvasId, node.d2Id]))
  const counts = new Map<string, number>()
  return fixture.relations.map((relation) => {
    const from = byNode.get(relation.from)!, to = byNode.get(relation.to)!
    const parent = from.includes('.') ? from.split('.')[0] : undefined
    const local = parent && to.startsWith(`${parent}.`)
    const label = local
      ? `${parent}.(${from.slice(parent.length + 1)} -> ${to.slice(parent.length + 1)})`
      : `(${from} -> ${to})`
    const index = counts.get(label) ?? 0
    counts.set(label, index + 1)
    return { canvasId: relation.canvasId, alias: `${label}[${index}]` }
  })
}

function closestSide(node: CanvasNode, point: CanvasPoint): CanvasAnchor {
  const sides: Array<[CanvasAnchor, number]> = [
    ['left', Math.abs(point.x - node.x)], ['right', Math.abs(point.x - node.x - node.width)],
    ['top', Math.abs(point.y - node.y)], ['bottom', Math.abs(point.y - node.y - node.height)],
  ]
  return sides.sort((a, b) => a[1] - b[1])[0][0]
}

/** The saved Canvas contract has side-center anchors, not arbitrary D2 port
 * offsets. Connect those to the original D2 path by an explicit orthogonal
 * adapter, instead of introducing diagonal segments on import. */
function orthogonalBridge(from: CanvasPoint, to: CanvasPoint, axis: 'x' | 'y'): CanvasPoint[] {
  const corner = axis === 'x' ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  return [from, corner, to].filter((point, index, points) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
}

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

/** Experimental native-bend candidate: D2's node placement and line bends,
 * with Canvas's four-side anchor approximation. Labels remain Canvas-placed.
 * Never describe this as an exact D2 native renderer or enable it by default. */
export function d2SvgToNativeBendCanvas(scene: CanvasScene, svg: string): CanvasScene {
  const positioned = d2SvgToEditableCanvas(scene, svg)
  const fixture = architectureSceneToD2(scene)
  const rawPositions = d2SvgNodePositions(svg, fixture.nodes.map((node) => node.d2Id))
  const sourceX = Math.min(...[...rawPositions.values()].map((point) => point.x))
  const sourceY = Math.min(...[...rawPositions.values()].map((point) => point.y))
  const translate = (point: CanvasPoint) => ({ x: Math.round(point.x - sourceX + 96), y: Math.round(point.y - sourceY + 170) })
  const aliases = d2RelationAliases(scene)
  const routes = d2SvgEdgePaths(svg, aliases.map((edge) => edge.alias))
  const byId = new Map(positioned.elements.filter((item): item is CanvasNode => item.type === 'node')
    .map((node) => [node.id, node]))
  const paths = new Map(aliases.map(({ canvasId, alias }) => [canvasId, routes.get(alias)!.map(translate)]))
  if ([...paths.values()].flat().some((point) => point.x < 0 || point.y < 0)) {
    throw new Error('D2 原生关系超出画布左上边界，必须联合平移节点与连线后再导入')
  }
  const edges = positioned.elements.map((item) => {
    if (item.type !== 'arrow') return item
    const route = paths.get(item.id)!
    const fromNode = byId.get(item.from)!, toNode = byId.get(item.to)!
    const fromAnchor = closestSide(fromNode, route[0])
    const toAnchor = closestSide(toNode, route.at(-1)!)
    const first = anchorPoint(fromNode, fromAnchor, route[0])
    const last = anchorPoint(toNode, toAnchor, route.at(-1)!)
    const fromAxis = fromAnchor === 'left' || fromAnchor === 'right' ? 'x' : 'y'
    const toAxis = toAnchor === 'left' || toAnchor === 'right' ? 'y' : 'x'
    const bridged = [
      ...orthogonalBridge(first, route[0], fromAxis),
      ...route.slice(1),
      ...orthogonalBridge(route.at(-1)!, last, toAxis).slice(1),
    ].filter((point, index, points) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
    return {
      ...item, routing: 'orthogonal' as const,
      fromAnchor, toAnchor,
      points: bridged.slice(1, -1),
      bundleKey: undefined,
      labelPosition: undefined,
    }
  })
  const maxX = Math.max(positioned.width, ...[...paths.values()].flat().map((point) => point.x + 80))
  const maxY = Math.max(positioned.height, ...[...paths.values()].flat().map((point) => point.y + 80))
  return { ...positioned, width: Math.ceil(maxX), height: Math.ceil(maxY), elements: edges }
}
