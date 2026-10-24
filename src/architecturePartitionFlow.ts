import type { CanvasScene } from './canvas.js'

export interface ArchitecturePartitionStep {
  id: string
  label: string
  nodeCount: number
  incoming: number
  outgoing: number
  /** Number of different partitions directly downstream. */
  targets: number
}

export interface ArchitecturePartitionFlow {
  steps: ArchitecturePartitionStep[]
  crossPartitionRelations: number
  internalRelations: number
}

/**
 * Pure, deterministic dependency overview for Canvas architecture regions.
 * It never changes any authored or generated coordinates and does not infer
 * missing edges. Cyclic flows retain a stable fallback ordering.
 */
export function architecturePartitionFlow(scene: CanvasScene): ArchitecturePartitionFlow {
  const groups = scene.groups ?? []
  const index = new Map(groups.map((group, i) => [group.id, i]))
  const counts = new Map(groups.map((group) => [group.id, 0]))
  const byNode = new Map<string, string>()
  for (const item of scene.elements) {
    if (item.type === 'arrow' || !item.groupId || !index.has(item.groupId)) continue
    byNode.set(item.id, item.groupId)
    counts.set(item.groupId, (counts.get(item.groupId) ?? 0) + 1)
  }
  const activeIds = groups.map((group) => group.id).filter((id) => (counts.get(id) ?? 0) > 0)
  const incoming = new Map(activeIds.map((id) => [id, 0]))
  const outgoing = new Map(activeIds.map((id) => [id, 0]))
  const adjacency = new Map(activeIds.map((id) => [id, new Set<string>()]))
  let crossPartitionRelations = 0
  let internalRelations = 0
  for (const arrow of scene.elements) {
    if (arrow.type !== 'arrow') continue
    const from = byNode.get(arrow.from)
    const to = byNode.get(arrow.to)
    if (!from || !to) continue
    if (from === to) {
      internalRelations += 1
      continue
    }
    crossPartitionRelations += 1
    outgoing.set(from, (outgoing.get(from) ?? 0) + 1)
    incoming.set(to, (incoming.get(to) ?? 0) + 1)
    adjacency.get(from)?.add(to)
  }
  // Kahn on distinct partition dependencies. If there is a directed cycle,
  // pick the lowest-original-order unresolved partition and continue.
  const inDegree = new Map(activeIds.map((id) => [id, 0]))
  for (const targets of adjacency.values()) {
    for (const to of targets) inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
  }
  const remaining = new Set(activeIds)
  const order: string[] = []
  while (remaining.size) {
    const next = activeIds.find((id) => remaining.has(id) && inDegree.get(id) === 0)
      ?? activeIds.find((id) => remaining.has(id))!
    order.push(next)
    remaining.delete(next)
    for (const target of adjacency.get(next) ?? []) {
      inDegree.set(target, (inDegree.get(target) ?? 0) - 1)
    }
  }
  const labels = new Map(groups.map((group) => [group.id, group.label || group.id]))
  return {
    steps: order.map((id) => ({
      id, label: labels.get(id)!, nodeCount: counts.get(id) ?? 0,
      incoming: incoming.get(id) ?? 0,
      outgoing: outgoing.get(id) ?? 0,
      targets: adjacency.get(id)?.size ?? 0,
    })),
    crossPartitionRelations,
    internalRelations,
  }
}
