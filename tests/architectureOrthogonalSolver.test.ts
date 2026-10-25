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
