import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addOccupiedSegments,
  findOrthogonalRoute,
  scoreRoute,
  segmentIntersectsRect,
  segmentsCross,
  simplifyRoute,
  type RouteRect,
  type RouteSegment,
} from '../src/architectureOrthogonalSolver.js'

test('orthogonal corridor solver finds a node-free route while honoring side anchors', () => {
  const from = { x: 0, y: 0 }, to = { x: 300, y: 0 }
  const obstacle: RouteRect = { x: 115, y: -45, width: 70, height: 90 }
  const route = findOrthogonalRoute(from, to, [obstacle], [], undefined, 'right', 'left')
  assert.deepEqual(route[0], from)
  assert.deepEqual(route.at(-1), to)
  assert.ok(route.slice(1).every((point, index) =>
    point.x === route[index].x || point.y === route[index].y), 'no diagonal legs')
  assert.ok(route.slice(1).every((point, index) =>
    !segmentIntersectsRect({ a: route[index], b: point }, obstacle)), 'avoid obstacle rather than cutting through')
  assert.ok(route.length >= 4)
})

test('orthogonal geometry weighs unrelated occupied corridors but permits named bundles', () => {
  const route = [{ x: 0, y: 0 }, { x: 300, y: 0 }]
  const occupied: RouteSegment[] = []
  addOccupiedSegments(route, occupied, 'bundle-a')
  assert.equal(occupied.length, 1)
  assert.ok(scoreRoute(route, [], occupied) > scoreRoute(route, [], occupied, 'bundle-a'))
  const crossing = { a: { x: 140, y: -60 }, b: { x: 140, y: 60 } }
  assert.equal(segmentsCross(occupied[0], crossing), true)
  assert.deepEqual(simplifyRoute([
    { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 80, y: 0 },
    { x: 140, y: 0 }, { x: 140, y: 80 },
  ]), [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 80 }])
})

test('optional visibility fallback resolves an obstacle maze that bounded doglegs cannot clear', () => {
  const start = { x: 711, y: 274 }, end = { x: 899, y: 702 }
  const obstacles: RouteRect[] = [
    { x: 608, y: 84, width: 206, height: 110 },
    { x: 984, y: 84, width: 206, height: 110 },
    { x: 796, y: 182, width: 206, height: 110 },
    { x: 890, y: 482, width: 206, height: 110 },
    { x: 702, y: 482, width: 206, height: 110 },
    { x: 420, y: 684, width: 206, height: 110 },
    { x: 60, y: 182, width: 206, height: 110 },
    { x: 608, y: 280, width: 206, height: 110 },
  ]
  const before = findOrthogonalRoute(start, end, obstacles, [], undefined, 'bottom', 'top')
  const recovered = findOrthogonalRoute(start, end, obstacles, [], undefined, 'bottom', 'top', undefined, true)
  assert.ok(scoreRoute(before, obstacles, []) >= 100_000,
    'the bounded search cannot escape this interlocking corridor')
  assert.ok(scoreRoute(recovered, obstacles, []) < 100_000)
  assert.deepEqual(recovered[0], start)
  assert.deepEqual(recovered.at(-1), end)
  assert.ok(recovered[1].y >= start.y, 'respect bottom source port')
  assert.ok(recovered.at(-2)!.y <= end.y, 'respect top target port')
  assert.ok(recovered.slice(1).every((point, i) => point.x === recovered[i].x || point.y === recovered[i].y))
  assert.ok(recovered.slice(1).every((point, i) =>
    obstacles.every((rect) => !segmentIntersectsRect({ a: recovered[i], b: point }, rect))))
  assert.deepEqual(findOrthogonalRoute(start, end, obstacles, [], undefined, 'bottom', 'top'), before,
    'opt-in fallback must not change ordinary routing calls')
  const occupied: RouteSegment[] = [
    { a: { x: 608, y: 280 }, b: { x: 608, y: 684 } },
  ]
  const withOccupation = findOrthogonalRoute(start, end, obstacles, occupied,
    undefined, 'bottom', 'top', undefined, true)
  assert.ok(scoreRoute(withOccupation, obstacles, occupied) < 100_000,
    'search-local segment costs must include the current occupied-corridor set')
  assert.deepEqual(findOrthogonalRoute(start, end, obstacles, [], undefined, 'bottom', 'top', undefined, true),
    recovered, 'no computed corridor cost may leak between separate searches')
})
