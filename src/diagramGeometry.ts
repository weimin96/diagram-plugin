/** Pure rectangle primitives shared by editable Canvas and browser-rendered
 * Mermaid. All coordinates are in the caller's coordinate space; callers
 * must not compare CSS pixels with untransformed SVG/viewBox coordinates. */
export interface DiagramRect {
  x: number
  y: number
  width: number
  height: number
}

/** SVG percent-sized roots (e.g. width="100%") require a real viewBox.
 * Do not silently treat percent width as 100px or infer a zero-height SVG. */
export function readSvgDimensions(viewBox: string | null, width: string | null, height: string | null): {
  width: number; height: number
} {
  const parts = (viewBox ?? '').trim().split(/\s+/).map(Number)
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] }
  }
  const numberOrZero = (value: string | null): number => {
    if (!value || value.includes('%')) return 0
    const number = Number.parseFloat(value)
    return Number.isFinite(number) && number > 0 ? number : 0
  }
  return { width: numberOrZero(width), height: numberOrZero(height) }
}

/** Existing Canvas node collision semantics: ignore a 2px inset on every
 * side. In particular, a merely touching border is not an overlap. */
export function rectsOverlapWithInset(a: DiagramRect, b: DiagramRect, inset: number): boolean {
  return a.x + inset < b.x + b.width - inset
    && a.x + a.width - inset > b.x + inset
    && a.y + inset < b.y + b.height - inset
    && a.y + a.height - inset > b.y + inset
}

export function rectContains(outer: DiagramRect, inner: DiagramRect, tolerance: number): boolean {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance
}

/** Browser visual evidence, not a geometric optimizer: each pair counts
 * once only if both overlap dimensions strictly exceed the chosen tolerance. */
export function countOverlappingRects(rects: readonly DiagramRect[], tolerance: number): number {
  let conflicts = 0
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i]
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j]
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tolerance
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > tolerance) conflicts++
    }
  }
  return conflicts
}
