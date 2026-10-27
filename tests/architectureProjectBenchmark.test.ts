import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { projectArchitectureCase, projectArchitectureCases, coreArchitectureModules,
  qualityPipelineModules, canvasEditingModules } from '../scripts/architecture-project-cases.js'
import { externalArchitectureSourceCases, parseExternalRepoArgs } from '../scripts/architecture-external-source-cases.js'
import { loadArchitectureReviewedTasks } from '../scripts/architecture-reviewed-tasks.js'
import { measureArchitectureLayoutDemand } from '../scripts/architecture-layout-demand.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasBundleTrunks, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'

test('真实架构基准的每条关系必须来自仓库源码的实际 TS import', async () => {
  const samples = await projectArchitectureCases()
  assert.deepEqual(samples.map((sample) => sample.intent.nodes.map((node) => node.id)), [
    [...coreArchitectureModules], [...qualityPipelineModules], [...canvasEditingModules],
  ], 'each benchmark must describe an independent, declared group of actual modules')
  assert.equal(new Set(samples.map((sample) => sample.id)).size, samples.length)
  assert.equal(coreArchitectureModules.length, 12)
  assert.equal(samples[0].intent.nodes.length, 12)
  assert.ok(samples[0].intent.relations.length >= 20,
    'the bounded core subsystem must exercise a genuinely dense import topology')
  for (const sample of samples) {
    assert.equal(sample.source, 'project')
    const selected = new Set(sample.intent.nodes.map((node) => node.id))
    const observed = new Set<string>()
    for (const node of sample.intent.nodes) {
      assert.deepEqual(node.sourcePaths, [`src/${node.id}.ts`])
      const filename = new URL(`../src/${node.id}.ts`, import.meta.url)
      const ast = ts.createSourceFile(node.id, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true)
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
        const imported = statement.moduleSpecifier.text
        if (!imported.startsWith('./')) continue
        const dependency = imported.split('/').at(-1)!.replace(/\.(?:js|ts|tsx)$/, '')
        if (dependency !== node.id && selected.has(dependency)) observed.add(`${node.id}\u0000${dependency}`)
      }
    }
    assert.ok(observed.size >= 5, 'every real subgraph must contain verifiable relationships')
    assert.deepEqual(sample.intent.relations.map((edge) => `${edge.from}\u0000${edge.to}`).sort(),
      [...observed].sort(), 'never add an inferred dependency or omit an actual selected-module import')
  }
  const demand = measureArchitectureLayoutDemand(samples[0].intent, 80)
  assert.equal(demand.relationCount, samples[0].intent.relations.length)
  assert.equal(demand.maxFanIn, 11)
  assert.equal(demand.assumedSingleSidePortCapacity, 4,
    'reference span is a what-if capacity, not an actual assigned port side')
  assert.ok(demand.overCapacityNodes.some((node) => node.incoming === 11
    && node.requiredSingleSideSpanPx === 168))
  assert.equal(demand.nodesWithoutVerifiedPartition, samples[0].intent.nodes.length,
    'source imports have no independently verified semantic partitions')
  const typed = {
    title: 'Synthetic scenario only',
    nodes: [
      { id: 'a', text: 'A', partition: 'application' as const },
      { id: 'b', text: 'B', partition: 'data' as const },
      { id: 'c', text: 'C', partition: 'processing' as const },
      { id: 'd', text: 'D' },
    ],
    relations: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' },
      { from: 'c', to: 'a' }, { from: 'c', to: 'd' }],
    primaryPath: ['a', 'b', 'c'],
  }
  const topology = measureArchitectureLayoutDemand(typed, 80)
  assert.deepEqual(topology.cycleComponents, [['a', 'b', 'c']])
  assert.equal(topology.confirmedCrossPartitionRelations, 3)
  assert.equal(topology.unknownPartitionRelations, 1)
  assert.equal(topology.nodesWithoutVerifiedPartition, 1)
  assert.equal(topology.primaryPathIsReal, true)
  assert.equal(topology.cyclicInternalRelations, 3)
  assert.equal(topology.topologicalLayerCount, 2)
  assert.deepEqual(topology.routingFrontiers, [{ afterLayer: 0,
    relationCount: 1, distinctSources: 1, distinctTargets: 1 }])
  assert.equal(measureArchitectureLayoutDemand({ ...typed, primaryPath: ['a', 'c'] }, 80).primaryPathIsReal, false)
  assert.equal(measureArchitectureLayoutDemand({ ...typed, relations: [...typed.relations].reverse() }, 80)
    .confirmedCrossPartitionRelations, topology.confirmedCrossPartitionRelations)
  assert.deepEqual(measureArchitectureLayoutDemand({ ...typed, relations: [...typed.relations].reverse() }, 80)
    .routingFrontiers, topology.routingFrontiers,
  'logical DAG frontier pressure cannot depend on import enumeration order')
  const longEdge = measureArchitectureLayoutDemand({ title: 'Synthetic long edge',
    nodes: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }, { id: 'z', text: 'Z' }],
    relations: [{ from: 'x', to: 'y' }, { from: 'y', to: 'z' }, { from: 'x', to: 'z' }],
  }, 80)
  assert.equal(longEdge.topologicalLayerCount, 3)
  assert.deepEqual(longEdge.routingFrontiers.map((frontier) => frontier.relationCount), [2, 2],
    'a real long dependency consumes two logical layer-cut frontiers without fabricating new edges')
  assert.throws(() => measureArchitectureLayoutDemand({ ...typed,
    relations: [...typed.relations, { from: 'a', to: 'missing' }] }, 80), /Unknown architecture relation endpoint/)
  assert.throws(() => measureArchitectureLayoutDemand(typed, 0), /finite positive/)
  const sourceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
  const imported = await externalArchitectureSourceCases('diagram-source', sourceRoot, 1)
  assert.equal(imported.length, 1, 'the generic collector must support a real, Git-tracked repository')
  assert.equal(imported[0].provenance.revision.length, 40)
  assert.equal(imported[0].intent.nodes.length, 16)
  assert.equal(imported[0].intent.relations.length, imported[0].provenance.imports.length,
    'every extracted relation must have an exact originating import')
  const paths = new Map(imported[0].intent.nodes.map((node) => [node.id, node.sourcePaths![0]]))
  for (const edge of imported[0].intent.relations) {
    const from = paths.get(edge.from)!, to = paths.get(edge.to)!
    const evidence = imported[0].provenance.imports.find((item) => item.from === from && item.to === to)
    assert.ok(evidence, 'never credit relationships without AST import evidence')
    const text = await readFile(path.join(sourceRoot, from), 'utf8')
    assert.equal(evidence.sourceSha256, createHash('sha256').update(text).digest('hex'))
    const tree = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true)
    const node = tree.statements.find((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false
      if (tree.getLineAndCharacterOfPosition(statement.getStart(tree)).line + 1 !== evidence.line) return false
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith('.')) return false
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
        .replace(/\.(?:jsx?|mjs|cjs|ts|tsx|mts|cts)$/, '')
      return [to.replace(/\.(?:ts|tsx|mts|cts)$/, ''), to.replace(/\/index\.(?:ts|tsx)$/, '')].includes(resolved)
    })
    assert.ok(node, 'importer, target, line and source digest must match a real tracked file')
  }
  assert.deepEqual(parseExternalRepoArgs(['--repo=one:/tmp/one','--repo=two:/tmp/two']).map((item) => item.label),
    ['one', 'two'])
  assert.throws(() => parseExternalRepoArgs(['--repo=one:/tmp/a','--repo=one:/tmp/b']),
    /Duplicate source repository label/)
  await assert.rejects(externalArchitectureSourceCases('unsafe', '../other-repo'), /absolute path/)
  // Synthetic, deliberately unreviewed contract fixture; NEVER treated as a
  // real user-approved system topology by the corpus audit.
  const folder = await mkdtemp(path.join(os.tmpdir(), 'diagram-reviewed-tasks-'))
  try {
    const sourcePaths = ['src/architectureComposer.ts', 'src/architectureRouting.ts',
      'src/architecturePortPlanning.ts']
    const evidence = await Promise.all(sourcePaths.map(async (relativePath, index) => ({
      id: `proof${index + 1}`, relativePath,
      fileSha256: createHash('sha256').update(await readFile(path.join(sourceRoot, relativePath))).digest('hex'),
      startLine: 1, endLine: 1,
    })))
    const task = { id: 'contract-fixture', repository: 'fixture-code',
      purpose: 'Test traceable nonvisual system layout intent contract',
      readingGoal: 'Read from composer through router to planning',
      intent: { title: 'Synthetic contract fixture',
        nodes: [
          { id: 'composer', text: 'Composer', partition: 'application', evidenceIds: ['proof1'] },
          { id: 'router', text: 'Router', partition: 'processing', evidenceIds: ['proof2'] },
          { id: 'port', text: 'Planner', partition: 'data', evidenceIds: ['proof3'] },
        ],
        relations: [{ from: 'composer', to: 'router', evidenceIds: ['proof1'] },
          { from: 'router', to: 'port', evidenceIds: ['proof2'] }],
        primaryPath: ['composer', 'router', 'port'],
      }, evidence,
    }
    const file = path.join(folder, 'tasks.json')
    await writeFile(file, JSON.stringify({ version: 1, tasks: [task] }))
    const mapping = new Map([['fixture-code', sourceRoot]])
    const pending = await loadArchitectureReviewedTasks(file, mapping)
    assert.equal(pending.cases.length, 1)
    assert.equal(pending.cases[0].reviewAttested, false)
    assert.equal(pending.pendingReview, 1)
    assert.equal(pending.cases[0].intent.relations.length, 2)
    const ledgerFile = path.join(folder, 'review.json')
    const reviews = [{ taskId: task.id, reviewer: 'fixture-reviewer',
      reviewedAt: '2026-01-01T00:00:00Z', decision: 'approved' }]
    await writeFile(ledgerFile, JSON.stringify({ version: 1,
      manifestSha256: pending.manifestSha256, reviews }))
    const attested = await loadArchitectureReviewedTasks(file, mapping, ledgerFile)
    assert.equal(attested.cases[0].reviewAttested, true)
    await writeFile(ledgerFile, JSON.stringify({ version: 1, manifestSha256: pending.manifestSha256,
      reviews: [{ ...reviews[0], decision: 'rejected' }] }))
    assert.equal((await loadArchitectureReviewedTasks(file, mapping, ledgerFile)).cases[0].reviewAttested, false,
      'a separate explicit rejection must never count as a reviewed real task')
    const tampered = structuredClone(task)
    tampered.evidence[0].fileSha256 = '0'.repeat(64)
    await writeFile(file, JSON.stringify({ version: 1, tasks: [tampered] }))
    await assert.rejects(loadArchitectureReviewedTasks(file, mapping), /Stale source evidence/)
    await writeFile(file, JSON.stringify({ version: 1, tasks: [task] }))
    const brokenPath = structuredClone(task)
    brokenPath.intent.primaryPath = ['composer', 'port', 'router']
    await writeFile(file, JSON.stringify({ version: 1, tasks: [brokenPath] }))
    await assert.rejects(loadArchitectureReviewedTasks(file, mapping), /not a verified directed chain/)
    await writeFile(file, JSON.stringify({ version: 1, tasks: [task, task] }))
    await assert.rejects(loadArchitectureReviewedTasks(file, mapping), /Duplicate architecture task ID/)
    await writeFile(file, JSON.stringify({ version: 1, tasks: [task, { ...task, id: 'new-draft' }] }))
    await assert.rejects(loadArchitectureReviewedTasks(file, mapping, ledgerFile), /stale task manifest/)
    const traversal = structuredClone(task)
    traversal.evidence[0].relativePath = '../outside.ts'
    await writeFile(file, JSON.stringify({ version: 1, tasks: [traversal] }))
    await assert.rejects(loadArchitectureReviewedTasks(file, mapping), /Unsafe evidence path/)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('真实依赖密集图不能因不穿节点就获得错误的自动审查资格', async () => {
  const sample = await projectArchitectureCase()
  const original = JSON.stringify(sample.intent)
  const composed = composeArchitectureGraph(sample.intent)
  const q = composed.quality.metrics
  assert.equal(q.edgeNodeIntersections, 0)
  assert.equal(q.edgeCrossings, 0,
    'prioritized full-scene negotiation and residual cleanup must eliminate the real-source crossings')
  assert.ok(q.edgeOverlaps <= 3,
    'joint terminal and corridor negotiation must preserve the real independent-overlap improvement')
  assert.ok(composed.routeDiagnostics.ingressPortConflicts <= 1,
    'final joint port allocation must resolve real endpoint congestion without losing other routes')
  assert.ok(canvasBundleTrunks(composed.scene).length >= 2,
    'negotiating independent corridors must not erase genuine shared source trunks')
  assert.ok(composed.routeDiagnostics.totalRouteLength <= 11_800,
    'final all-relation review must shorten independent free corridors after conflict repair')
  assert.ok(composed.routeDiagnostics.perimeterDetours <= 8,
    'joint optimization must actually reduce real same-region exterior detours')
  assert.ok(composed.evaluation.structuralScore >= 81,
    'prioritized routing and bounded residual cleanup must improve the complete scene')
  assert.ok(composed.candidates.some((candidate) =>
    candidate.layout === composed.evaluation.layout
    && candidate.density === composed.evaluation.density
    && candidate.rawSelectionScore === composed.evaluation.rawSelectionScore),
  'candidate evaluation exposed to hosts must match the negotiated editable scene')
  assert.equal(composed.presentation.estimatedTitlePxAtFit, 12.5)
  assert.deepEqual(composed.visualPlan.review.blockers, [])
  assert.equal(composed.visualPlan.review.readyForVisualReview, true,
    'resolved geometry is eligible for visual inspection, not yet human-approved')
  assert.ok(composed.evaluation.structuralScore >= 0 && composed.evaluation.structuralScore <= 90)
  assert.ok(composed.evaluation.rawSelectionScore <= composed.evaluation.structuralScore,
    'display-score clipping must not conceal worse raw geometry in candidate selection')
  assert.deepEqual(composeArchitectureGraph(sample.intent).scene, composed.scene,
    'saturated-score recovery remains deterministic across repeated generations')
  assert.ok(composed.evaluation.rawSelectionScore >= composed.evaluation.structuralScore,
    'successful dense-corridor negotiation must not rely on hiding a negative raw score')
  // Readability is a geometry gate, not an absence-of-node-intersection gate.
  // The genuine source graph currently remains too crowded for approval.
  if (q.edgeCrossings >= 3 || q.edgeOverlaps * 2 >= q.arrows) {
    assert.equal(composed.visualPlan.review.readyForVisualReview, false)
    assert.ok(composed.visualPlan.review.blockers.length > 0)
  }
  const ids = new Set(composed.scene.elements.filter((element) => element.type === 'arrow').map((arrow) => arrow.id))
  if (q.edgeCrossings > 0) {
    assert.ok(composed.visualPlan.review.repairTargets.some((target) =>
      target.concern === 'crossing-relationships'
        && target.elementIds.length === 2 && target.elementIds.every((id) => ids.has(id))))
  }
  const saved = parseCanvasScene(serializeCanvasScene(composed.scene))
  assert.equal(saved.elements.filter((element) => element.type === 'node').length, sample.intent.nodes.length)
  assert.deepEqual(saved.elements.filter((element) => element.type === 'arrow').map((edge) => [edge.from, edge.to]),
    sample.intent.relations.map((edge) => [edge.from, edge.to]))
  assert.equal(JSON.stringify(sample.intent), original)
})
