import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { architectureBenchmarkCases } from './architecture-benchmark-cases.js'
import { projectArchitectureCases } from './architecture-project-cases.js'
import { externalArchitectureSourceCases, parseExternalRepoArgs } from './architecture-external-source-cases.js'
import type { ArchitectureIntentGraph } from '../src/architectureComposer.js'

const args = process.argv.slice(2)
const output = path.resolve(args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
  ?? 'test-results/architecture-corpus/audit.json')
const strict = args.includes('--require-diverse-real')
if (args.some((arg) => arg !== '--require-diverse-real' && !arg.startsWith('--out=') && !arg.startsWith('--repo='))) {
  throw new Error('Usage: audit-architecture-corpus [--out=path] [--require-diverse-real] [--repo=label:/absolute/path]')
}
const repositories = parseExternalRepoArgs(args)
if (repositories.some((entry) => entry.label === 'diagram-plugin')) {
  throw new Error('The built-in diagram-plugin evidence cannot be relabeled as another source')
}
const roots = await Promise.all(repositories.map((entry) => realpath(entry.root)))
const currentRoot = await realpath(path.resolve(import.meta.dirname, '..'))
if (new Set(roots).size !== roots.length || roots.includes(currentRoot)) {
  throw new Error('Cross-project corpus repositories must be distinct and must not reuse diagram-plugin')
}

function topology(input: ArchitectureIntentGraph) {
  const inbound = new Map(input.nodes.map((node) => [node.id, 0]))
  const outbound = new Map(input.nodes.map((node) => [node.id, 0]))
  for (const relation of input.relations) {
    if (!inbound.has(relation.to) || !outbound.has(relation.from)) throw new Error('Unknown corpus relation endpoint')
    inbound.set(relation.to, inbound.get(relation.to)! + 1)
    outbound.set(relation.from, outbound.get(relation.from)! + 1)
  }
  const queue = [...inbound].filter(([, count]) => count === 0).map(([id]) => id)
  const remaining = new Map(inbound)
  let traversed = 0
  while (queue.length) {
    const node = queue.shift()!
    traversed++
    for (const edge of input.relations.filter((edge) => edge.from === node)) {
      const next = remaining.get(edge.to)! - 1
      remaining.set(edge.to, next)
      if (next === 0) queue.push(edge.to)
    }
  }
  return {
    nodes: input.nodes.length, relations: input.relations.length,
    maxFanIn: Math.max(0, ...inbound.values()), maxFanOut: Math.max(0, ...outbound.values()),
    cycle: traversed !== input.nodes.length,
    explicitPartitions: new Set(input.nodes.flatMap((node) => node.partition ? [node.partition] : [])).size,
    // Detect input-order perturbations without treating them as new topologies.
    fingerprint: createHash('sha256').update(JSON.stringify({
      nodes: input.nodes.map((node) => node.id).sort(),
      relations: input.relations.map(({ from, to }) => [from, to].join('\u0000')).sort(),
    })).digest('hex').slice(0, 16),
  }
}

const [real, external, reference] = await Promise.all([projectArchitectureCases(),
  Promise.all(repositories.map((repo) => externalArchitectureSourceCases(repo.label, repo.root))),
  Promise.resolve(architectureBenchmarkCases('extended'))])
const cases = [
  ...real.map((item) => ({
    id: item.id, origin: 'verified-source-imports' as const, repository: 'diagram-plugin',
    provenance: 'selected src/*.ts static TypeScript imports; not runtime calls',
    sourcePaths: item.intent.nodes.flatMap((node) => node.sourcePaths ?? []),
    ...topology(item.intent),
  })),
  ...external.flat().map((item) => ({
    id: item.id, origin: 'verified-source-imports' as const, repository: item.provenance.repository,
    revision: item.provenance.revision,
    uncommitted: item.provenance.uncommitted,
    provenance: 'source-backed local Git-tracked static TS import subset; NOT user-approved architecture',
    sourcePaths: item.intent.nodes.flatMap((node) => node.sourcePaths ?? []),
    evidence: item.provenance.imports,
    ...topology(item.intent),
  })),
  ...reference.map((item) => ({
    id: item.id, origin: item.source === 'reference' ? 'fictional-reference' as const : 'synthetic-perturbation' as const,
    repository: null, provenance: 'reference fixture or deterministic synthetic mutation; NOT real-world evidence',
    sourcePaths: [], ...topology(item.intent),
  })),
]
const verified = cases.filter((item) => item.origin === 'verified-source-imports')
const projectCount = new Set(verified.map((item) => item.repository)).size
const distinctTopologies = new Set(cases.map((item) => item.fingerprint)).size
const minimum = { independentRepositories: 3, verifiedRealTasks: 20 }
// Actual, user-grounded system architecture tasks need their own verified
// semantic relationships, partitions and reading intent. An import AST only
// proves source dependencies, not that somebody requested this architecture.
const verifiedRealTasks = 0
const ready = projectCount >= minimum.independentRepositories && verifiedRealTasks >= minimum.verifiedRealTasks
const report = {
  version: 2, kind: 'architecture-evaluation-corpus-audit',
  policy: 'Verified static imports are source-backed module samples, NOT real user architecture tasks. Do not count them toward the real-task acceptance threshold.',
  readiness: ready ? 'ready-for-cross-project-evaluation' : 'insufficient-independent-real-evidence',
  minimum,
  summary: {
    total: cases.length, verifiedSourceSubgraphs: verified.length, verifiedRealTasks,
    independentRepositories: projectCount,
    sourceOnlyCoverageMet: projectCount >= minimum.independentRepositories,
    fictionalReferences: cases.filter((item) => item.origin === 'fictional-reference').length,
    syntheticVariants: cases.filter((item) => item.origin === 'synthetic-perturbation').length,
    distinctExactTopologies: distinctTopologies,
    withCycle: cases.filter((item) => item.cycle).length,
    withExplicitPartitions: cases.filter((item) => item.explicitPartitions > 0).length,
  },
  cases,
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ readiness: report.readiness, ...report.summary, output }, null, 2))
if (strict && !ready) {
  console.error(`Cross-project evidence is insufficient: ${verifiedRealTasks}/${minimum.verifiedRealTasks} verified architecture tasks; ${verified.length} source-import subgraphs from ${projectCount}/${minimum.independentRepositories} repositories.`)
  process.exitCode = 1
}
