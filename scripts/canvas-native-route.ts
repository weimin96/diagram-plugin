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

/** Both D2 and ELK have arbitrary boundary ports; the current Canvas contract
 * only has four side-center anchors. Translate genuine orthogonal waypoints
 * without inventing a diagonal segment, and report the port approximation.
 * Used solely by the isolated external-layout experiments. */
export function canvasNativeOrthogonalRoute(from: CanvasNode, to: CanvasNode, route: CanvasPoint[]) {
  if (route.length < 2 || route.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    || route.slice(1).some((point, i) => point.x !== route[i].x && point.y !== route[i].y)) {
    throw new Error('External native route is not orthogonal')
  }
  const fromAnchor = closestSide(from, route[0])
  const toAnchor = closestSide(to, route.at(-1)!)
  const start = anchorPoint(from, fromAnchor, route[0])
  const end = anchorPoint(to, toAnchor, route.at(-1)!)
  const fromAxis = fromAnchor === 'left' || fromAnchor === 'right' ? 'x' : 'y'
  const toAxis = toAnchor === 'left' || toAnchor === 'right' ? 'y' : 'x'
  const connected = [
    ...bridge(start, route[0], fromAxis),
    ...route.slice(1),
    ...bridge(route.at(-1)!, end, toAxis).slice(1),
  ].filter((point, index, points) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  return { routing: 'orthogonal' as const, fromAnchor, toAnchor, points: connected.slice(1, -1) }
}
