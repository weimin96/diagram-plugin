/** Local boundary-port reservation and coordinated ingress planning.
 * Reads existing Canvas port geometry without mutating the document or
 * inventing node positions. All proposals require complete-scene approval.
 */
import { CANVAS_PORT_MIN_SEPARATION_PX, canvasArrowBoxRoute, type CanvasArrow, type CanvasNode, type CanvasNote, type CanvasScene } from './canvas.js'

export type FixedSide = 'top' | 'right' | 'bottom' | 'left'
export type PortReservations = ReadonlyMap<string, readonly number[]>
const PORT_EDGE_CLEARANCE_PX = 12
const PORT_CONGESTION_COST_PER_PX = 24
const MAX_FREE_PORT_CHOICES = 2

function portKey(nodeId: string, side: FixedSide): string {
  return `${nodeId}\u0000${side}`
}

/** Read only actual ports from untouched edges; an intentional shared bus is
 * not split. This is transient solver state, never a second Canvas contract. */
export function reservedPorts(arrows: readonly CanvasArrow[], selected: ReadonlySet<string>): PortReservations {
  const reservations = new Map<string, number[]>()
  for (const arrow of arrows) {
    if (selected.has(arrow.id)) continue
    for (const endpoint of ['from', 'to'] as const) {
      const side = arrow[`${endpoint}Anchor`]
      if (side !== 'top' && side !== 'right' && side !== 'bottom' && side !== 'left') continue
      const key = portKey(arrow[endpoint], side)
      const ratio = arrow[`${endpoint}PortRatio`] ?? 0.5
      if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
        reservations.set(key, [...(reservations.get(key) ?? []), ratio])
      }
    }
  }
  return reservations
}

/** Propose at most two openings in the largest free boundary intervals.
 * Keep the center fallback first, never allocate a corner or invent a
 * different side. Geometry scoring then chooses a full orthogonal route. */
export function availablePortRatios(
  box: CanvasNode | CanvasNote,
  side: FixedSide,
  reservations: PortReservations | undefined,
): number[] {
  if (box.rotation) return [0.5] // Orthogonal solver assumes axis-aligned node boundaries.
  const occupied = reservations?.get(portKey(box.id, side))
  if (!occupied?.length) return [0.5]
  const span = side === 'left' || side === 'right' ? box.height : box.width
  const inset = Math.min(0.35, Math.max(0.12, PORT_EDGE_CLEARANCE_PX / Math.max(span, 1)))
  const cuts = [inset, ...occupied.filter((ratio) => ratio > inset && ratio < 1 - inset).sort((a, b) => a - b), 1 - inset]
  const gaps = cuts.slice(1).map((right, i) => ({
    ratio: Math.round((right + cuts[i]) * 500) / 1000,
    width: right - cuts[i],
  })).filter(({ width }) => width > 0.1)
    .sort((a, b) => b.width - a.width || Math.abs(a.ratio - 0.5) - Math.abs(b.ratio - 0.5)
      || a.ratio - b.ratio)
  return [0.5, ...gaps.slice(0, MAX_FREE_PORT_CHOICES).map(({ ratio }) => ratio).filter((ratio) => ratio !== 0.5)]
}

export function portSpacingPenalty(
  box: CanvasNode | CanvasNote,
  side: FixedSide,
  ratio: number,
  reservations: PortReservations | undefined,
): number {
  const occupied = reservations?.get(portKey(box.id, side))
  if (!occupied?.length) return 0
  const span = side === 'left' || side === 'right' ? box.height : box.width
  const separation = Math.min(...occupied.map((other) => Math.abs(other - ratio) * span))
  return Math.max(0, CANVAS_PORT_MIN_SEPARATION_PX - separation) * PORT_CONGESTION_COST_PER_PX
}

/** Offer ingress slots for an already-routed node without replacing the
 * canonical orthogonal router. Candidate endpoints retain the real target
 * side and adjust only the final orthogonal terminal; the caller decides
 * whether any complete scene is worth accepting. */
export function proposeIngressPortSlots(scene: CanvasScene): CanvasScene[] {
  const nodes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote =>
    item.type !== 'arrow').map((item) => [item.id, item]))
  const incoming = new Map<string, CanvasArrow[]>()
  for (const item of scene.elements) {
    if (item.type !== 'arrow' || item.bundleKey || !item.toAnchor || item.toAnchor === 'auto') continue
    const key = `${item.to}\u0000${item.toAnchor}`
    incoming.set(key, [...(incoming.get(key) ?? []), item])
  }
  const proposals: CanvasScene[] = []
  for (const arrivals of incoming.values()) {
    if (arrivals.length < 2) continue
    const target = nodes.get(arrivals[0].to)
    if (!target || target.rotation) continue
    const side = arrivals[0].toAnchor
    const horizontalSide = side === 'left' || side === 'right'
    const span = horizontalSide ? target.height : target.width
    const inset = Math.max(0.15, Math.min(0.3, 12 / span))
    const slots = Array.from({ length: arrivals.length }, (_, index) =>
      Math.round((inset + (1 - 2 * inset) * index / (arrivals.length - 1)) * 1000) / 1000)
    const replaceTerminal = (arrow: CanvasArrow, ratio: number, gap: number): CanvasArrow | undefined => {
      const source = nodes.get(arrow.from)
      if (!source || source.rotation) return undefined
      const route = canvasArrowBoxRoute(source, target, arrow)
      if (route.length < 3) return undefined
      const last = route.at(-1)!, previous = route.at(-2)!, preceding = route.at(-3)!
      const flat = previous.y === last.y && previous.x !== last.x
        && previous.x === preceding.x
      const stub = previous.x === last.x && previous.y !== last.y
        && (horizontalSide
          ? preceding.y === previous.y && route.length >= 4 && route.at(-4)!.x === preceding.x
          : preceding.x === previous.x)
      if (!flat && !stub) return undefined
      const routePoints = route.slice(0, -1).map((point) => ({ ...point }))
      if (horizontalSide) {
        const y = target.y + ratio * span
        if (flat) routePoints[routePoints.length - 1].y = y
        else {
          routePoints.pop()
          routePoints[routePoints.length - 1].y = y
        }
      } else {
        const x = target.x + ratio * span
        const approachY = last.y + (side === 'top' ? -gap : gap)
        routePoints.pop()
        const pivot = routePoints.at(-1)!
        if (pivot.x !== previous.x) return undefined
        routePoints.push({ x: previous.x, y: approachY }, { x, y: approachY })
      }
      const proposed = { ...arrow, toPortRatio: ratio, points: routePoints.slice(1) }
      const path = canvasArrowBoxRoute(source, target, proposed)
      if (path.slice(1).some((point, index) =>
        point.x !== path[index].x && point.y !== path[index].y)) return undefined
      return proposed
    }
    // The existing single-edge search cannot exchange two occupied endpoints.
    // Allocate an entire physical side together, preserving approach order,
    // then let the Composer validate every resulting route on the full scene.
    if (arrivals.length <= 6
      && span * (1 - 2 * inset) / (arrivals.length - 1) >= CANVAS_PORT_MIN_SEPARATION_PX) {
      const ordered = arrivals.map((arrow) => {
        const source = nodes.get(arrow.from)
        const route = source && canvasArrowBoxRoute(source, target, arrow)
        const approach = route?.at(-2)
        return { arrow, coordinate: horizontalSide ? approach?.y : approach?.x }
      }).sort((a, b) => (a.coordinate ?? 0) - (b.coordinate ?? 0)
        || a.arrow.id.localeCompare(b.arrow.id, 'en'))
      const replacements = new Map<string, CanvasArrow>()
      for (const [index, { arrow }] of ordered.entries()) {
        const ratio = slots[index]
        if (ratio === (arrow.toPortRatio ?? 0.5)) continue
        const proposed = replaceTerminal(arrow, ratio, horizontalSide ? 0 : 16)
        if (!proposed) {
          replacements.clear()
          break
        }
        replacements.set(arrow.id, proposed)
      }
      if (replacements.size > 0) proposals.push({
        ...scene, elements: scene.elements.map((item) => replacements.get(item.id) ?? item),
      })
    }
    for (const arrow of arrivals) {
      for (const ratio of slots) {
        if (Math.abs(ratio - (arrow.toPortRatio ?? 0.5)) * span < 8) continue
        // A new endpoint requires an actually free physical port; do not
        // declare a fake capacity win while another edge still occupies it.
        if (arrivals.some((other) => other.id !== arrow.id
          && Math.abs((other.toPortRatio ?? 0.5) - ratio) * span < 12)) continue
        for (const gap of horizontalSide ? [0] : [16, 30]) {
          const proposed = replaceTerminal(arrow, ratio, gap)
          if (!proposed) continue
          proposals.push({ ...scene, elements: scene.elements.map((item) =>
            item.id === arrow.id ? proposed : item) })
        }
      }
    }
  }
  return proposals
}
