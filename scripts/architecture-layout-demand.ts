import { CANVAS_PORT_MIN_SEPARATION_PX } from '../src/canvas.js'
import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'

/** Before geometry exists, only count real graph demand and verified groups.
 * A single-sided left-to-right routing envelope is a SCENARIO, not a claim
 * that every input edge must attach to the left or every output to the right.
 * It must never serve as an automatic rejection or a visual quality score.
 */
export function measureArchitectureLayoutDemand(
  intent: ArchitectureIntentGraph,
  referenceSideSpanPx: number,
) {
  if (!Number.isFinite(referenceSideSpanPx) || referenceSideSpanPx <= 0) {
    throw new Error('Reference side span must be a finite positive dimension')
  }
  const ids = new Set(intent.nodes.map((node) => node.id))
  if (ids.size !== intent.nodes.length) throw new Error('Duplicate architecture intent node')
  const degrees = new Map(intent.nodes.map((node) => [node.id, { incoming: 0, outgoing: 0,
    partition: node.partition ?? null }]))
  const edges = new Set<string>()
  const adjacency = new Map(intent.nodes.map((node) => [node.id, [] as string[]]))
  let confirmedCrossPartitionRelations = 0
  let unknownPartitionRelations = 0
  const partitionInterfaces = new Map<string, number>()
  for (const edge of intent.relations) {
    const source = degrees.get(edge.from), target = degrees.get(edge.to)
    if (!source || !target) throw new Error(`Unknown architecture relation endpoint: ${edge.from}→${edge.to}`)
    const id = `${edge.from}\0${edge.to}`
    if (edges.has(id)) throw new Error(`Duplicate directed architecture relation: ${edge.from}→${edge.to}`)
    edges.add(id)
    source.outgoing++
    target.incoming++
    adjacency.get(edge.from)!.push(edge.to)
    if (!source.partition || !target.partition) unknownPartitionRelations++
    else if (source.partition !== target.partition) {
      confirmedCrossPartitionRelations++
      const key = `${source.partition}→${target.partition}`
      partitionInterfaces.set(key, (partitionInterfaces.get(key) ?? 0) + 1)
    }
  }

  // Tarjan SCC: cyclic modules consume routing space that a pure topological
  // layer ordering cannot represent. Neither SCCs nor partitions are invented.
  const discovery = new Map<string, number>(), low = new Map<string, number>()
  const stack: string[] = [], onStack = new Set<string>(), cycles: string[][] = []
  const components: string[][] = []
  let clock = 0
  function visit(node: string) {
    const time = clock++
    discovery.set(node, time)
    low.set(node, time)
    stack.push(node)
    onStack.add(node)
    for (const next of adjacency.get(node)!) {
      if (!discovery.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, discovery.get(next)!))
    }
    if (low.get(node) === discovery.get(node)) {
      const component: string[] = []
      let popped: string
      do {
        popped = stack.pop()!
        onStack.delete(popped)
        component.push(popped)
      } while (popped !== node)
      components.push(component)
      if (component.length > 1 || edges.has(`${node}\0${node}`)) cycles.push(component.sort())
    }
  }
  for (const node of intent.nodes) if (!discovery.has(node.id)) visit(node.id)

  // Collapse real cyclic strongly connected components BEFORE planning layer
  // demand. A cycle cannot be assigned a fictitious directed DAG layer order.
  // Every long edge crossing multiple DAG layer cuts contributes once to each
  // crossed frontier; the result is logical relation pressure, NOT a physical
  // routing lane count (bundling and geometric placement are still unknown).
  const orderedComponents = components.map((component) => component.slice().sort())
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
  const componentOf = new Map(orderedComponents.flatMap((component, index) =>
    component.map((node) => [node, index] as const)))
  const successors = orderedComponents.map(() => new Set<number>())
  const indegree = orderedComponents.map(() => 0)
  let cyclicInternalRelations = 0
  for (const edge of intent.relations) {
    const source = componentOf.get(edge.from)!, target = componentOf.get(edge.to)!
    if (source === target) {
      cyclicInternalRelations++
    } else if (!successors[source].has(target)) {
      successors[source].add(target)
      indegree[target]++
    }
  }
  const layer = orderedComponents.map(() => 0)
  const queue = indegree.flatMap((degree, index) => degree === 0 ? [index] : [])
  let visited = 0
  while (queue.length) {
    const head = queue.shift()!
    visited++
    for (const target of [...successors[head]].sort((a, b) => a - b)) {
      layer[target] = Math.max(layer[target], layer[head] + 1)
      if (--indegree[target] === 0) queue.push(target)
    }
  }
  if (visited !== orderedComponents.length) throw new Error('SCC condensation must form a DAG')
  const frontierRelations = new Map<number, Array<{ from: string; to: string }>>()
  for (const edge of intent.relations) {
    const start = layer[componentOf.get(edge.from)!]
    const end = layer[componentOf.get(edge.to)!]
    for (let cut = start; cut < end; cut++) {
      frontierRelations.set(cut, [...(frontierRelations.get(cut) ?? []), edge])
    }
  }
  const routingFrontiers = [...frontierRelations].sort(([a], [b]) => a - b)
    .map(([afterLayer, crossing]) => ({
      afterLayer, relationCount: crossing.length,
      distinctSources: new Set(crossing.map((edge) => edge.from)).size,
      distinctTargets: new Set(crossing.map((edge) => edge.to)).size,
    }))

  const spacing = CANVAS_PORT_MIN_SEPARATION_PX
  const capacity = Math.max(0, Math.floor(referenceSideSpanPx / spacing) - 1)
  const demands = [...degrees].map(([nodeId, { incoming, outgoing, partition }]) => ({
    nodeId, partition, incoming, outgoing,
    /** Actual endpoints, before any bundling or shared port placement. */
    relationEndpoints: incoming + outgoing,
    /** Conservative scenario: all incoming LEFT, all outgoing RIGHT. */
    requiredSingleSideSpanPx: (Math.max(incoming, outgoing) + 1) * spacing,
    singleSidePortDeficit: Math.max(0, Math.max(incoming, outgoing) - capacity),
  })).sort((a, b) => b.singleSidePortDeficit - a.singleSidePortDeficit
    || b.relationEndpoints - a.relationEndpoints || a.nodeId.localeCompare(b.nodeId, 'en'))
  const primaryPath = intent.primaryPath ?? []
  const primaryPathIsReal = primaryPath.length < 2 || (new Set(primaryPath).size === primaryPath.length
    && primaryPath.every((node) => ids.has(node))
    && primaryPath.slice(1).every((node, index) => edges.has(`${primaryPath[index]}\0${node}`)))
  return {
    nodeCount: intent.nodes.length,
    relationCount: intent.relations.length,
    relationsPerNode: intent.nodes.length ? Math.round(100 * intent.relations.length / intent.nodes.length) / 100 : 0,
    maxFanIn: Math.max(0, ...demands.map((node) => node.incoming)),
    maxFanOut: Math.max(0, ...demands.map((node) => node.outgoing)),
    referenceSideSpanPx,
    portSpacingPx: spacing,
    assumedSingleSidePortCapacity: capacity,
    overCapacityNodes: demands.filter((node) => node.singleSidePortDeficit > 0),
    cycleComponents: cycles.sort((a, b) => a[0].localeCompare(b[0], 'en')),
    cyclicInternalRelations,
    topologicalLayerCount: Math.max(0, ...layer) + (layer.length ? 1 : 0),
    routingFrontiers,
    maxLogicalFrontierRelations: Math.max(0, ...routingFrontiers.map((frontier) => frontier.relationCount)),
    declaredPartitionCount: new Set([...degrees.values()].flatMap((node) => node.partition ? [node.partition] : [])).size,
    nodesWithoutVerifiedPartition: demands.filter((node) => !node.partition).length,
    confirmedCrossPartitionRelations,
    unknownPartitionRelations,
    partitionInterfaces: [...partitionInterfaces].map(([interfaceName, relations]) => ({ interfaceName, relations }))
      .sort((a, b) => b.relations - a.relations || a.interfaceName.localeCompare(b.interfaceName, 'en')),
    primaryPathSpecified: primaryPath.length >= 2,
    primaryPathIsReal,
  }
}
