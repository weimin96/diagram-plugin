import { canvasArrowBoxRoute, canvasArrowRoutePoints, type CanvasArrow, type CanvasNode, type CanvasNote, type CanvasPoint } from './canvas.js'
import type { CanvasRect } from './canvasRectIndex.js'

type Box = CanvasNode | CanvasNote

// A segment can cross the viewport even if neither endpoint node is visible.
// Apply a cheap conservative extent test before the exact route intersection.
export function canvasArrowCrossesViewport(arrow: CanvasArrow, boxes: Map<string, Box>, view: CanvasRect): boolean {
  const standalone = Boolean(arrow.start && arrow.end)
  const from = standalone ? undefined : boxes.get(arrow.from)
  const to = standalone ? undefined : boxes.get(arrow.to)
  if (!standalone && (!from || !to)) return false
  const points = standalone ? [arrow.start!, arrow.end!, ...(arrow.points ?? [])] : [
    { x: from!.x, y: from!.y }, { x: from!.x + from!.width, y: from!.y + from!.height },
    { x: to!.x, y: to!.y }, { x: to!.x + to!.width, y: to!.y + to!.height },
    ...(arrow.points ?? []),
  ]
  // Rotation and self-loops can extend beyond their nodes' axis-aligned rectangles.
  const padding = standalone ? 0 : Math.max(48, from!.width, from!.height, to!.width, to!.height)
  const minX = Math.min(...points.map((point) => point.x)) - padding
  const maxX = Math.max(...points.map((point) => point.x)) + padding
  const minY = Math.min(...points.map((point) => point.y)) - padding
  const maxY = Math.max(...points.map((point) => point.y)) + padding
  if (minX > view.x + view.width || maxX < view.x || minY > view.y + view.height || maxY < view.y) return false

  const route = standalone
    ? canvasArrowRoutePoints(arrow.start!, arrow.end!, arrow)
    : canvasArrowBoxRoute(from!, to!, arrow, arrow.from === arrow.to)
  // Quadratic freehand curves can pass through the viewport between endpoints;
  // their control polygon bounds are conservative, so retain them at this point.
  if (arrow.freehand && route.length > 2) return true
  return route.slice(1).some((end, index) => segmentCrossesRect(route[index], end, view))
}

function segmentCrossesRect(from: CanvasPoint, to: CanvasPoint, view: CanvasRect): boolean {
  let lower = 0
  let upper = 1
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (const [p, q] of [
    [-dx, from.x - view.x], [dx, view.x + view.width - from.x],
    [-dy, from.y - view.y], [dy, view.y + view.height - from.y],
  ]) {
    if (p === 0) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) lower = Math.max(lower, t)
    else upper = Math.min(upper, t)
    if (lower > upper) return false
  }
  return true
}

export const MIN_CANVAS_ZOOM = 0.45
export const MAX_CANVAS_ZOOM = 4

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasViewportScene {
  width: number
  height: number
}

export interface CanvasViewportContainer {
  width: number
  height: number
  left: number
  top: number
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Zooming keeps the world point under the pointer fixed. Without a pointer the
// viewport keeps its origin and only the scale changes, so toolbar zoom and
// keyboard zoom stay predictable.
export function zoomCanvasViewport(input: {
  viewport: CanvasViewport
  scene: CanvasViewportScene
  nextZoom: number
  container?: CanvasViewportContainer
  clientX?: number
  clientY?: number
}): CanvasViewport {
  const clamped = clampValue(input.nextZoom, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM)
  const { container, clientX, clientY } = input
  if (!container || clientX === undefined || clientY === undefined) {
    return { ...input.viewport, zoom: clamped }
  }
  const px = clampValue((clientX - container.left) / Math.max(1, container.width), 0, 1)
  const py = clampValue((clientY - container.top) / Math.max(1, container.height), 0, 1)
  const worldX = input.viewport.x + px * (input.scene.width / input.viewport.zoom)
  const worldY = input.viewport.y + py * (input.scene.height / input.viewport.zoom)
  return {
    x: worldX - px * (input.scene.width / clamped),
    y: worldY - py * (input.scene.height / clamped),
    zoom: clamped,
  }
}

// Wheel and trackpad panning are expressed in screen pixels, so the conversion
// has to account for both the current zoom and the rendered container size.
export function panCanvasViewport(input: {
  viewport: CanvasViewport
  scene: CanvasViewportScene
  container: { width: number; height: number }
  deltaX: number
  deltaY: number
}): CanvasViewport {
  const scaleX = (input.scene.width / input.viewport.zoom) / Math.max(1, input.container.width)
  const scaleY = (input.scene.height / input.viewport.zoom) / Math.max(1, input.container.height)
  return {
    ...input.viewport,
    x: input.viewport.x + input.deltaX * scaleX,
    y: input.viewport.y + input.deltaY * scaleY,
  }
}
