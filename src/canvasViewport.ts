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

export interface CanvasViewportRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasViewportFitOptions {
  minWidth: number
  minHeight: number
  paddingX: number
  paddingY: number
  minZoom: number
  maxZoom: number
}

// Framing a selection and framing an architecture scene are the same problem:
// grow the content box by its reading padding, fit it into the scene box, and
// keep the result inside the scene so a fit never reveals blank space.
export function fitCanvasViewport(input: {
  scene: CanvasViewportScene
  rects: readonly CanvasViewportRect[]
  options: CanvasViewportFitOptions
}): CanvasViewport {
  const { scene, rects, options } = input
  if (!rects.length) return { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  const width = Math.max(options.minWidth, right - left + options.paddingX)
  const height = Math.max(options.minHeight, bottom - top + options.paddingY)
  const zoom = clampValue(
    Math.min(scene.width / width, scene.height / height),
    options.minZoom,
    options.maxZoom,
  )
  const viewWidth = scene.width / zoom
  const viewHeight = scene.height / zoom
  return {
    zoom,
    x: clampValue((left + right) / 2 - viewWidth / 2, 0, Math.max(0, scene.width - viewWidth)),
    y: clampValue((top + bottom) / 2 - viewHeight / 2, 0, Math.max(0, scene.height - viewHeight)),
  }
}

// Clicking the minimap centres the viewport on that world point and clamps the
// result to the scene edges, so the minimap can never scroll into empty space.
export function recenterCanvasViewport(input: {
  viewport: CanvasViewport
  scene: CanvasViewportScene
  minimap: CanvasViewportRect
  container: { width: number; height: number; left: number; top: number }
  clientX: number
  clientY: number
}): CanvasViewport {
  const { scene, minimap, container } = input
  const targetX = minimap.x + ((input.clientX - container.left) / Math.max(1, container.width)) * minimap.width
  const targetY = minimap.y + ((input.clientY - container.top) / Math.max(1, container.height)) * minimap.height
  const width = scene.width / input.viewport.zoom
  const height = scene.height / input.viewport.zoom
  return {
    ...input.viewport,
    x: clampValue(targetX - width / 2, 0, Math.max(0, scene.width - width)),
    y: clampValue(targetY - height / 2, 0, Math.max(0, scene.height - height)),
  }
}
