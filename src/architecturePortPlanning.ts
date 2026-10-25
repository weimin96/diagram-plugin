/** Local boundary-port reservation and free-slot planning.
 * Reads existing Canvas port geometry without mutating the document or
 * inventing node positions. Called only from bounded single-edge repair.
 */
import type { CanvasArrow, CanvasNode, CanvasNote } from './canvas.js'

export type FixedSide = 'top' | 'right' | 'bottom' | 'left'
export type PortReservations = ReadonlyMap<string, readonly number[]>
const PORT_EDGE_CLEARANCE_PX = 12
const PORT_MIN_SEPARATION_PX = 14
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
  return Math.max(0, PORT_MIN_SEPARATION_PX - separation) * PORT_CONGESTION_COST_PER_PX
}
