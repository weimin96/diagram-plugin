/** Deterministic orthogonal corridor search and geometry costs.
 * This module knows only points, rectangular obstacles and occupied segments.
 * It does not know Canvas documents, semantic nodes, grouping, or rendering.
 */
import type { CanvasPoint } from './canvas.js'

export type RouteRect = { x: number; y: number; width: number; height: number }
export type RouteSegment = { a: CanvasPoint; b: CanvasPoint; bundleKey?: string }
export type RouteCorridorHints = { x: number[]; y: number[] }

export function expandRect(box: RouteRect, margin: number): RouteRect {
  return { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 }
}

export function findOrthogonalRoute(
  start: CanvasPoint,
  end: CanvasPoint,
  obstacles: RouteRect[],
  occupied: RouteSegment[],
  bundleKey: string | undefined,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
  hints?: RouteCorridorHints,
  visibilityFallback = false,
): CanvasPoint[] {
  const margin = 24
  const xCandidates = uniqueNumbers([
    ...(hints?.x ?? []),
    ...uniqueNumbers([
    (start.x + end.x) / 2,
    start.x + Math.sign(end.x - start.x || 1) * 56,
    end.x - Math.sign(end.x - start.x || 1) * 56,
    ...obstacles.flatMap((item) => [item.x - margin, item.x + item.width + margin]),
    ]).sort((a, b) => Math.abs(a - (start.x + end.x) / 2) - Math.abs(b - (start.x + end.x) / 2)).slice(0, 28),
  ])
  const yCandidates = uniqueNumbers([
    ...(hints?.y ?? []),
    ...uniqueNumbers([
    (start.y + end.y) / 2,
    start.y + Math.sign(end.y - start.y || 1) * 48,
    end.y - Math.sign(end.y - start.y || 1) * 48,
    ...obstacles.flatMap((item) => [item.y - margin, item.y + item.height + margin]),
    ]).sort((a, b) => Math.abs(a - (start.y + end.y) / 2) - Math.abs(b - (start.y + end.y) / 2)).slice(0, 28),
  ])

  // A single shared X or Y corridor is not enough when an intermediate node
  // blocks the direct path and the destination column is itself stacked with
  // neighboring nodes. Add a bounded two-corridor search so the route can go
  // above/below the blocker, advance through a clear vertical channel, then
  // enter the destination from the side. Keep the cross-product deliberately
  // small because this runs once per relationship.
  const doglegXs = boundedCorridorCandidates(xCandidates, 10)
  const doglegYs = boundedCorridorCandidates(yCandidates, 10)
  const doglegs: CanvasPoint[][] = []
  for (const x of doglegXs) {
    for (const y of doglegYs) {
      doglegs.push(
        [start, { x: start.x, y }, { x, y }, { x, y: end.y }, end],
        [start, { x, y: start.y }, { x, y }, { x: end.x, y }, end],
      )
    }
  }

  const candidates: CanvasPoint[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    ...xCandidates.map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
    ...yCandidates.map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ...doglegs,
  ]
  let best = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const simplified = simplifyRoute(candidate)
    if (!routeRespectsAnchors(simplified, fromAnchor, toAnchor)) continue
    const score = scoreRoute(simplified, obstacles, occupied, bundleKey, bestScore)
    if (score < bestScore) {
      best = simplified
      bestScore = score
    }
  }

  // If every cheap candidate still cuts an obstacle, the topology needs two
  // independent corridors (for example: exit a vertically stacked source
  // column, pass above a middle blocker, then enter a stacked target column).
  // Search this deeper shape only on collision fallback so normal routing stays
  // inexpensive.
  if (bestScore >= 100_000 || routeCrossesOccupied(best, occupied, bundleKey)) {
    for (const firstX of doglegXs) {
      for (const secondX of doglegXs) {
        if (firstX === secondX) continue
        for (const y of doglegYs) {
          const candidate = simplifyRoute([
            start,
            { x: firstX, y: start.y },
            { x: firstX, y },
            { x: secondX, y },
            { x: secondX, y: end.y },
            end,
          ])
          if (!routeRespectsAnchors(candidate, fromAnchor, toAnchor)) continue
          const score = scoreRoute(candidate, obstacles, occupied, bundleKey, bestScore)
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
    }
    for (const firstY of doglegYs) {
      for (const secondY of doglegYs) {
        if (firstY === secondY) continue
        for (const x of doglegXs) {
          const candidate = simplifyRoute([
            start,
            { x: start.x, y: firstY },
            { x, y: firstY },
            { x, y: secondY },
            { x: end.x, y: secondY },
            end,
          ])
          if (!routeRespectsAnchors(candidate, fromAnchor, toAnchor)) continue
          const score = scoreRoute(candidate, obstacles, occupied, bundleKey, bestScore)
          if (score < bestScore) {
            best = candidate
            bestScore = score
          }
        }
      }
    }
  }
  if (visibilityFallback && bestScore >= 100_000) {
    const detour = findObstacleFreeVisibilityRoute(
      start, end, obstacles, occupied, bundleKey, fromAnchor, toAnchor, hints,
    )
    if (detour) {
      const score = scoreRoute(detour, obstacles, occupied, bundleKey, bestScore)
      if (score < bestScore) best = detour
    }
  }
  return best
}

/** Exact obstacle-free fallback over rectilinear visibility corridors.
 * Invoked only after bounded doglegs fail. This is the same geometric solver,
 * not a second layout policy. Direction is part of the search state so bends,
 * source and target port normals are enforced during traversal.
 */
function findObstacleFreeVisibilityRoute(
  start: CanvasPoint, end: CanvasPoint, obstacles: RouteRect[],
  occupied: RouteSegment[], bundleKey: string | undefined,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
  hints?: RouteCorridorHints,
): CanvasPoint[] | undefined {
  const xs = [...new Set([
    start.x, end.x, ...(hints?.x ?? []),
    ...obstacles.flatMap((r) => [r.x - 12, r.x, r.x + r.width, r.x + r.width + 12]),
  ])].filter(Number.isFinite).sort((a, b) => a - b)
  const ys = [...new Set([
    start.y, end.y, ...(hints?.y ?? []),
    ...obstacles.flatMap((r) => [r.y - 12, r.y, r.y + r.height, r.y + r.height + 12]),
  ])].filter(Number.isFinite).sort((a, b) => a - b)
  const width = xs.length, height = ys.length
  if (!width || !height || width * height > 14_000) return undefined
  const pointId = (x: number, y: number) => y * width + x
  const indexId = (node: number, direction: number) => node * 5 + direction
  const startNode = pointId(xs.indexOf(start.x), ys.indexOf(start.y))
  const endNode = pointId(xs.indexOf(end.x), ys.indexOf(end.y))
  const sourceDir = { right: 0, left: 1, bottom: 2, top: 3 }[fromAnchor]
  const targetDir = { right: 1, left: 0, bottom: 3, top: 2 }[toAnchor]
  const sourceState = indexId(startNode, 4)
  const distances = new Float64Array(width * height * 5).fill(Infinity)
  const previous = new Int32Array(distances.length).fill(-1)
  distances[sourceState] = 0
  type Entry = { state: number; distance: number }
  const heap: Entry[] = [{ state: sourceState, distance: 0 }]
  const push = (entry: Entry) => {
    let i = heap.length
    heap.push(entry)
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2)
      if (heap[parent].distance <= entry.distance) break
      heap[i] = heap[parent]
      i = parent
    }
    heap[i] = entry
  }
  const pop = (): Entry | undefined => {
    const first = heap[0]
    const last = heap.pop()
    if (!heap.length || !last) return first
    let i = 0
    while (2 * i + 1 < heap.length) {
      let child = 2 * i + 1
      if (child + 1 < heap.length && heap[child + 1].distance < heap[child].distance) child++
      if (heap[child].distance >= last.distance) break
      heap[i] = heap[child]
      i = child
    }
    heap[i] = last
    return first
  }
  const steps = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ] as const
  let resolved = -1
  while (heap.length) {
    const current = pop()!
    if (current.distance !== distances[current.state]) continue
    const node = Math.floor(current.state / 5), direction = current.state % 5
    if (node === endNode && direction === targetDir) {
      resolved = current.state
      break
    }
    const x = node % width, y = Math.floor(node / width)
    for (let nextDir = 0; nextDir < steps.length; nextDir++) {
      if (direction === 4 && nextDir !== sourceDir) continue
      if (nextDir === (direction ^ 1)) continue // Avoid immediate backtracking.
      const nx = x + steps[nextDir].dx, ny = y + steps[nextDir].dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = pointId(nx, ny)
      if (next === endNode && nextDir !== targetDir) continue
      const a = { x: xs[x], y: ys[y] }, b = { x: xs[nx], y: ys[ny] }
      const segment = { a, b }
      if (obstacles.some((rect) => segmentIntersectsRect(segment, rect))) continue
      const segmentCost = scoreRoute([a, b], [], occupied, bundleKey)
      const nextDistance = current.distance + segmentCost + (direction !== 4 && direction !== nextDir ? 22 : 0)
      const nextState = indexId(next, nextDir)
      if (nextDistance >= distances[nextState]) continue
      distances[nextState] = nextDistance
      previous[nextState] = current.state
      push({ state: nextState, distance: nextDistance })
    }
  }
  if (resolved < 0) return undefined
  const path: CanvasPoint[] = []
  for (let state = resolved; state >= 0; state = previous[state]) {
    const node = Math.floor(state / 5)
    path.push({ x: xs[node % width], y: ys[Math.floor(node / width)] })
  }
  return simplifyRoute(path.reverse())
}

function routeRespectsAnchors(
  route: CanvasPoint[],
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  toAnchor: 'top' | 'right' | 'bottom' | 'left',
): boolean {
  if (route.length < 2) return true
  const start = route[0]
  const first = route[1]
  const beforeEnd = route[route.length - 2]
  const end = route[route.length - 1]
  const leavesSource = fromAnchor === 'right' ? first.x >= start.x
    : fromAnchor === 'left' ? first.x <= start.x
      : fromAnchor === 'bottom' ? first.y >= start.y
        : first.y <= start.y
  const approachesTarget = toAnchor === 'right' ? beforeEnd.x >= end.x
    : toAnchor === 'left' ? beforeEnd.x <= end.x
      : toAnchor === 'bottom' ? beforeEnd.y >= end.y
        : beforeEnd.y <= end.y
  return leavesSource && approachesTarget
}

function boundedCorridorCandidates(values: number[], preferredCount: number): number[] {
  if (!values.length) return []
  return uniqueNumbers([
    ...values.slice(0, preferredCount),
    Math.min(...values),
    Math.max(...values),
  ])
}

export function scoreRoute(route: CanvasPoint[], obstacles: RouteRect[], occupied: RouteSegment[], bundleKey?: string, upperBound = Infinity): number {
  let length = 0
  let collisions = 0
  let overlapPenalty = 0
  let crossingPenalty = 0
  const bendsPenalty = Math.max(0, route.length - 2) * 22
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    length += Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y)
    // Every subsequent cost term is nonnegative. Once the partial score
    // cannot beat the best route, the exact remainder cannot change the
    // winner; avoid scoring thousands of known-losing candidates.
    if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    for (const rect of obstacles) {
      if (!segmentIntersectsRect(segment, rect)) continue
      collisions += 1
      if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    }
    for (const used of occupied) {
      const overlap = segmentOverlap(segment, used)
      overlapPenalty += overlap * (bundleKey && used.bundleKey === bundleKey ? 0.08 : 4)
      if (segmentsCross(segment, used) && (!bundleKey || used.bundleKey !== bundleKey)) {
        const groupBus = bundleKey?.startsWith('group:') || used.bundleKey?.startsWith('group:')
        crossingPenalty += groupBus ? 2200 : 960
      }
      if (length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty >= upperBound) return upperBound
    }
  }
  return length + bendsPenalty + collisions * 100_000 + overlapPenalty + crossingPenalty
}

function routeCrossesOccupied(route: CanvasPoint[], occupied: RouteSegment[], bundleKey?: string): boolean {
  for (let index = 0; index < route.length - 1; index += 1) {
    const segment = { a: route[index], b: route[index + 1] }
    if (occupied.some((used) => segmentsCross(segment, used) && (!bundleKey || used.bundleKey !== bundleKey))) return true
  }
  return false
}

export function segmentIntersectsRect(segment: RouteSegment, rect: RouteRect): boolean {
  const minX = Math.min(segment.a.x, segment.b.x)
  const maxX = Math.max(segment.a.x, segment.b.x)
  const minY = Math.min(segment.a.y, segment.b.y)
  const maxY = Math.max(segment.a.y, segment.b.y)
  if (segment.a.y === segment.b.y) {
    const y = segment.a.y
    return y > rect.y && y < rect.y + rect.height && maxX > rect.x && minX < rect.x + rect.width
  }
  if (segment.a.x === segment.b.x) {
    const x = segment.a.x
    return x > rect.x && x < rect.x + rect.width && maxY > rect.y && minY < rect.y + rect.height
  }
  const inside = (point: CanvasPoint) => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height
  if (inside(segment.a) || inside(segment.b)) return true
  const topLeft = { x: rect.x, y: rect.y }
  const topRight = { x: rect.x + rect.width, y: rect.y }
  const bottomLeft = { x: rect.x, y: rect.y + rect.height }
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height }
  return lineSegmentsIntersect(segment.a, segment.b, topLeft, topRight)
    || lineSegmentsIntersect(segment.a, segment.b, topRight, bottomRight)
    || lineSegmentsIntersect(segment.a, segment.b, bottomRight, bottomLeft)
    || lineSegmentsIntersect(segment.a, segment.b, bottomLeft, topLeft)
}

function lineSegmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
  const cross = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
}

function segmentOverlap(left: RouteSegment, right: RouteSegment): number {
  const leftHorizontal = left.a.y === left.b.y
  const rightHorizontal = right.a.y === right.b.y
  if (leftHorizontal !== rightHorizontal) return 0
  if (leftHorizontal) {
    if (Math.abs(left.a.y - right.a.y) > 8) return 0
    return intervalOverlap(left.a.x, left.b.x, right.a.x, right.b.x)
  }
  if (Math.abs(left.a.x - right.a.x) > 8) return 0
  return intervalOverlap(left.a.y, left.b.y, right.a.y, right.b.y)
}

export function segmentsCross(left: RouteSegment, right: RouteSegment): boolean {
  const leftHorizontal = left.a.y === left.b.y
  const rightHorizontal = right.a.y === right.b.y
  if (leftHorizontal === rightHorizontal) return false
  const horizontal = leftHorizontal ? left : right
  const vertical = leftHorizontal ? right : left
  const hx1 = Math.min(horizontal.a.x, horizontal.b.x)
  const hx2 = Math.max(horizontal.a.x, horizontal.b.x)
  const vy1 = Math.min(vertical.a.y, vertical.b.y)
  const vy2 = Math.max(vertical.a.y, vertical.b.y)
  return vertical.a.x > hx1 && vertical.a.x < hx2 && horizontal.a.y > vy1 && horizontal.a.y < vy2
}

function intervalOverlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)))
}

export function simplifyRoute(points: CanvasPoint[]): CanvasPoint[] {
  const deduped = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  return deduped.filter((point, index) => {
    if (index === 0 || index === deduped.length - 1) return true
    const before = deduped[index - 1]
    const after = deduped[index + 1]
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
  })
}

export function addOccupiedSegments(route: CanvasPoint[], occupied: RouteSegment[], bundleKey?: string) {
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index]
    const b = route[index + 1]
    if (a.x !== b.x && a.y !== b.y) continue
    occupied.push({ a, b, bundleKey })
  }
}

export function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value)))]
}
