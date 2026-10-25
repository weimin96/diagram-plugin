import { anchorPoint, type CanvasAnchor, type CanvasNode, type CanvasPoint } from '../src/canvas.js'

function closestSide(node: CanvasNode, point: CanvasPoint): CanvasAnchor {
  const sides: Array<[CanvasAnchor, number]> = [
    ['left', Math.abs(point.x - node.x)],
    ['right', Math.abs(point.x - node.x - node.width)],
    ['top', Math.abs(point.y - node.y)],
    ['bottom', Math.abs(point.y - node.y - node.height)],
  ]
  return sides.sort((a, b) => a[1] - b[1])[0][0]
}

function bridge(from: CanvasPoint, to: CanvasPoint, axis: 'x' | 'y'): CanvasPoint[] {
  const corner = axis === 'x' ? { x: to.x, y: from.y } : { x: from.x, y: to.y }
  return [from, corner, to]
}

function boundaryRatio(node: CanvasNode, side: CanvasAnchor, point: CanvasPoint): number | undefined {
  if (side === 'auto') return undefined
  const along = side === 'left' || side === 'right' ? (point.y - node.y) / node.height : (point.x - node.x) / node.width
  const distance = side === 'left' ? Math.abs(point.x - node.x)
    : side === 'right' ? Math.abs(point.x - node.x - node.width)
      : side === 'top' ? Math.abs(point.y - node.y) : Math.abs(point.y - node.y - node.height)
  // A small tolerance accounts for ELK / SVG rounding, not ports inside boxes.
  return distance <= 1 && along >= 0 && along <= 1 ? along : undefined
}

/** Translate genuine orthogonal native bends. When ELK/D2 endpoints lie on the
 * node boundary, persist their exact relative port positions. For unsupported
 * endpoints the prior center-anchor + orthogonal bridge remains explicit.
 * Used solely by the isolated external-layout experiments. */
export function canvasNativeOrthogonalRoute(from: CanvasNode, to: CanvasNode, route: CanvasPoint[]) {
  if (route.length < 2 || route.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    || route.slice(1).some((point, i) => point.x !== route[i].x && point.y !== route[i].y)) {
    throw new Error('External native route is not orthogonal')
  }
  const fromAnchor = closestSide(from, route[0])
  const toAnchor = closestSide(to, route.at(-1)!)
  const fromPortRatio = boundaryRatio(from, fromAnchor, route[0])
  const toPortRatio = boundaryRatio(to, toAnchor, route.at(-1)!)
  const start = anchorPoint(from, fromAnchor, route[0], fromPortRatio)
  const end = anchorPoint(to, toAnchor, route.at(-1)!, toPortRatio)
  const fromAxis = fromAnchor === 'left' || fromAnchor === 'right' ? 'x' : 'y'
  const toAxis = toAnchor === 'left' || toAnchor === 'right' ? 'y' : 'x'
  const connected = [
    ...bridge(start, route[0], fromAxis),
    ...route.slice(1),
    ...bridge(route.at(-1)!, end, toAxis).slice(1),
  ].filter((point, index, points) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  return { routing: 'orthogonal' as const, fromAnchor, toAnchor,
    fromPortRatio, toPortRatio, points: connected.slice(1, -1) }
}
