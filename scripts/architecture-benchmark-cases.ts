import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'
import { architectureCases } from '../tests/fixtures/architecture/cases.js'

export interface ArchitectureBenchmarkCase {
  id: string
  description: string
  intent: ArchitectureIntentGraph
  source: 'reference' | 'synthetic'
}

const reference: ArchitectureBenchmarkCase[] = architectureCases.map((example) => ({
  ...example, source: 'reference',
}))

function cloneGraph(input: ArchitectureIntentGraph): ArchitectureIntentGraph {
  return {
    ...input,
    nodes: input.nodes.map((node) => ({ ...node })),
    relations: input.relations.map((relation) => ({ ...relation })),
  }
}

/** Deterministic stress variants. These are not real project architecture or invented evidence. */
function variants(example: ArchitectureBenchmarkCase): ArchitectureBenchmarkCase[] {
  const reversed = cloneGraph(example.intent)
  reversed.nodes.reverse()
  reversed.relations.reverse()

  const longTitles = cloneGraph(example.intent)
  longTitles.nodes = longTitles.nodes.map((node, index) => ({
    ...node,
    text: index % 2 === 0 ? `${node.text} · 高可用服务与运行控制` : node.text,
  }))

  const busy = cloneGraph(example.intent)
  const hub = busy.nodes.find((node) => node.icon === 'service' || node.icon === 'ai')
    ?? busy.nodes.find((node) => node.icon === 'gateway') ?? busy.nodes[0]
  for (let i = 0; i < 5; i += 1) {
    const id = `synthetic_leaf_${i}`
    busy.nodes.push({ id, text: `模拟依赖 ${i + 1}`, icon: i % 2 ? 'database' : 'service' })
    busy.relations.push({ from: hub.id, to: id })
  }
  return [
    { id: `${example.id}-reversed`, description: '相同拓扑，逆序输入验证确定性与顺序偏差', intent: reversed, source: 'synthetic' },
    { id: `${example.id}-long-labels`, description: '中文长节点标题与文字溢出压力', intent: longTitles, source: 'synthetic' },
    { id: `${example.id}-fanout`, description: '核心节点增加五条明确的虚构扇出依赖', intent: busy, source: 'synthetic' },
  ]
}

function stressGraph(count: number): ArchitectureBenchmarkCase {
  const nodes: ArchitectureIntentGraph['nodes'] = []
  const relations: ArchitectureIntentGraph['relations'] = []
  const roles = ['gateway', 'service', 'worker', 'queue', 'database', 'cache', 'search', 'web'] as const
  for (let i = 0; i < count; i += 1) {
    nodes.push({ id: `component_${i}`, text: `模拟组件 ${i + 1}`, icon: roles[i % roles.length] })
    if (i > 0) relations.push({ from: `component_${i - 1}`, to: `component_${i}` })
    if (i >= 5 && i % 4 === 0) relations.push({ from: `component_${i - 5}`, to: `component_${i}` })
  }
  return {
    id: `synthetic-${count}-nodes`,
    description: `完全虚构的 ${count} 节点长链与跨层依赖；用于性能/布局边界`,
    intent: { title: `${count} 节点合成压力图`, nodes, relations },
    source: 'synthetic',
  }
}

/** Five tracked reference cases remain the fast default; extended is opt-in. */
export function architectureBenchmarkCases(suite: 'core' | 'extended' | 'stress' = 'core'): ArchitectureBenchmarkCase[] {
  if (suite === 'core') return reference
  if (suite === 'stress') return [stressGraph(30), stressGraph(50), stressGraph(80)]
  return reference.flatMap((example) => [example, ...variants(example)])
}
