import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasArrowCrossesViewport, fitCanvasViewport, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, panCanvasViewport, recenterCanvasViewport, zoomCanvasViewport } from '../src/canvasViewport.js'
import type { CanvasArrow, CanvasNode } from '../src/canvas.js'

const boxes = new Map<string, CanvasNode>([
  ['left', { id: 'left', type: 'node', x: -800, y: 150, width: 100, height: 80, text: 'Left' }],
  ['right', { id: 'right', type: 'node', x: 800, y: 150, width: 100, height: 80, text: 'Right' }],
])
const view = { x: 0, y: 0, width: 400, height: 400 }

test('保留两端离屏但穿过视口的直线和正交关系', () => {
  for (const routing of ['straight', 'orthogonal'] as const) {
    const arrow: CanvasArrow = { id: routing, type: 'arrow', from: 'left', to: 'right', routing }
    assert.equal(canvasArrowCrossesViewport(arrow, boxes, view), true, routing)
  }
})

test('不保留未穿过视口的远端连线，但保留穿屏手工折点', () => {
  const overhead = new Map([...boxes].map(([id, box]) => [id, { ...box, y: -500 }]))
  const outside: CanvasArrow = { id: 'outside', type: 'arrow', from: 'left', to: 'right', routing: 'straight', points: [{ x: 200, y: 200 }] }
  const far: CanvasArrow = { id: 'far', type: 'arrow', from: 'left', to: 'left', routing: 'straight', points: [{ x: -600, y: -900 }] }
  assert.equal(canvasArrowCrossesViewport(outside, overhead, view), true)
  assert.equal(canvasArrowCrossesViewport(far, boxes, view), false)
})

test('独立起止点连线按实际路径裁剪，边界相切仍可见', () => {
  const crossing: CanvasArrow = { id: 'free', type: 'arrow', from: '', to: '', start: { x: -200, y: 200 }, end: { x: 600, y: 200 } }
  const tangent: CanvasArrow = { ...crossing, id: 'tangent', start: { x: -200, y: 0 }, end: { x: 600, y: 0 } }
  const outside: CanvasArrow = { ...crossing, id: 'outside', start: { x: -200, y: 600 }, end: { x: 600, y: 600 } }
  assert.equal(canvasArrowCrossesViewport(crossing, boxes, view), true)
  assert.equal(canvasArrowCrossesViewport(tangent, boxes, view), true)
  assert.equal(canvasArrowCrossesViewport(outside, boxes, view), false)
})

// The editor keeps a viewport as (origin, zoom) over a fixed scene box. These are
// the two gestures users perform constantly, so the arithmetic is pinned here
// instead of being reachable only through a rendered SVG.
test('viewport math keeps the pointed world position fixed and frames content predictably', () => {
  const scene = { width: 1200, height: 800 }
  const container = { width: 600, height: 400, left: 100, top: 50 }

  // Toolbar/keyboard zoom has no pointer: the origin must not drift.
  assert.deepEqual(
    zoomCanvasViewport({ viewport: { x: 30, y: 20, zoom: 1 }, scene, nextZoom: 2 }),
    { x: 30, y: 20, zoom: 2 },
  )

  // Zoom is clamped to the documented range in both directions.
  assert.equal(zoomCanvasViewport({ viewport: { x: 0, y: 0, zoom: 1 }, scene, nextZoom: 99 }).zoom, MAX_CANVAS_ZOOM)
  assert.equal(zoomCanvasViewport({ viewport: { x: 0, y: 0, zoom: 1 }, scene, nextZoom: 0.01 }).zoom, MIN_CANVAS_ZOOM)

  // A pointer at the container centre must keep the same world point under it.
  const before = { x: 120, y: 80, zoom: 1.5 }
  const clientX = container.left + container.width / 2
  const clientY = container.top + container.height / 2
  const zoomed = zoomCanvasViewport({ viewport: before, scene, nextZoom: 2.5, container, clientX, clientY })
  const worldBefore = {
    x: before.x + 0.5 * (scene.width / before.zoom),
    y: before.y + 0.5 * (scene.height / before.zoom),
  }
  const worldAfter = {
    x: zoomed.x + 0.5 * (scene.width / zoomed.zoom),
    y: zoomed.y + 0.5 * (scene.height / zoomed.zoom),
  }
  assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 1e-9, `world x drifted: ${worldBefore.x} -> ${worldAfter.x}`)
  assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 1e-9, `world y drifted: ${worldBefore.y} -> ${worldAfter.y}`)
  assert.equal(zoomed.zoom, 2.5)

  // A pointer in the top-left corner anchors the origin, so only zoom changes.
  const corner = zoomCanvasViewport({ viewport: before, scene, nextZoom: 2, container, clientX: container.left, clientY: container.top })
  assert.equal(corner.x, before.x)
  assert.equal(corner.y, before.y)

  // Pointers outside the container are clamped to its edges instead of extrapolating.
  const outside = zoomCanvasViewport({ viewport: before, scene, nextZoom: 2, container, clientX: container.left - 900, clientY: container.top - 900 })
  assert.equal(outside.x, before.x)
  assert.equal(outside.y, before.y)

  // Panning converts screen pixels through the current zoom and container size.
  const panned = panCanvasViewport({ viewport: { x: 10, y: 10, zoom: 2 }, scene, container: { width: 600, height: 400 }, deltaX: 30, deltaY: -20 })
  assert.equal(panned.x, 10 + 30 * ((scene.width / 2) / 600))
  assert.equal(panned.y, 10 - 20 * ((scene.height / 2) / 400))
  assert.equal(panned.zoom, 2)

  // A zero-sized container must not divide by zero.
  const degenerate = panCanvasViewport({ viewport: { x: 0, y: 0, zoom: 1 }, scene, container: { width: 0, height: 0 }, deltaX: 10, deltaY: 10 })
  assert.equal(degenerate.x, 10 * scene.width)
  assert.equal(degenerate.y, 10 * scene.height)

  // Framing a selection grows its box by the reading padding, fits it to the
  // scene, then clamps to the scene edges so a fit never shows blank space.
  const framed = fitCanvasViewport({
    scene: { width: 1000, height: 600 },
    rects: [{ x: 100, y: 50, width: 200, height: 100 }],
    options: { minWidth: 280, minHeight: 180, paddingX: 200, paddingY: 160, minZoom: 0.8, maxZoom: 2.6 },
  })
  // content box = 400x260 -> zoom = min(1000/400, 600/260) = 2.307...
  assert.ok(Math.abs(framed.zoom - 600 / 260) < 1e-9)
  assert.ok(framed.x >= 0 && framed.x + 1000 / framed.zoom <= 1000 + 1e-9)
  assert.ok(framed.y >= 0 && framed.y + 600 / framed.zoom <= 600 + 1e-9)

  // A tiny selection stops at maxZoom instead of filling the screen with one node.
  const closeUp = fitCanvasViewport({
    scene: { width: 1000, height: 600 },
    rects: [{ x: 10, y: 10, width: 10, height: 10 }],
    options: { minWidth: 20, minHeight: 20, paddingX: 0, paddingY: 0, minZoom: 0.5, maxZoom: 2.5 },
  })
  assert.equal(closeUp.zoom, 2.5)

  // An empty selection resets instead of producing NaN bounds.
  assert.deepEqual(fitCanvasViewport({ scene: { width: 1000, height: 600 }, rects: [], options: { minWidth: 1, minHeight: 1, paddingX: 0, paddingY: 0, minZoom: 1, maxZoom: 1 } }), { x: 0, y: 0, zoom: 1 })

  // Minimap clicks centre the viewport on the clicked world point.
  const recentered = recenterCanvasViewport({
    viewport: { x: 0, y: 0, zoom: 2 },
    scene: { width: 1000, height: 600 },
    minimap: { x: 0, y: 0, width: 1000, height: 600 },
    container: { width: 200, height: 120, left: 0, top: 0 },
    clientX: 100,
    clientY: 60,
  })
  assert.deepEqual(recentered, { x: 250, y: 150, zoom: 2 })

  // Clicking the minimap edge never scrolls past the scene.
  const clampedEdge = recenterCanvasViewport({
    viewport: { x: 0, y: 0, zoom: 1 },
    scene: { width: 1000, height: 600 },
    minimap: { x: 0, y: 0, width: 1000, height: 600 },
    container: { width: 200, height: 120, left: 0, top: 0 },
    clientX: 0,
    clientY: 0,
  })
  assert.deepEqual(clampedEdge, { x: 0, y: 0, zoom: 1 })
})
