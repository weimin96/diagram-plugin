import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { projectArchitectureCase, coreArchitectureModules } from '../scripts/architecture-project-cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasBundleTrunks, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'

test('真实架构基准的每条关系必须来自仓库源码的实际 TS import', async () => {
  const sample = await projectArchitectureCase()
  assert.equal(sample.source, 'project')
  assert.equal(coreArchitectureModules.length, 12)
  assert.equal(sample.intent.nodes.length, 12)
  assert.ok(sample.intent.relations.length >= 20,
    'the bounded core subsystem must exercise a genuinely dense import topology')
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
  assert.deepEqual(sample.intent.relations.map((edge) => `${edge.from}\u0000${edge.to}`).sort(),
    [...observed].sort(), 'never add an inferred dependency or omit an actual selected-module import')
})

test('真实依赖密集图不能因不穿节点就获得错误的自动审查资格', async () => {
  const sample = await projectArchitectureCase()
  const original = JSON.stringify(sample.intent)
  const composed = composeArchitectureGraph(sample.intent)
  const q = composed.quality.metrics
  assert.equal(q.edgeNodeIntersections, 0)
  assert.ok(q.edgeCrossings <= 1,
    'alternating constrained placement/routing must prevent the original real-source crossing regression')
  assert.ok(q.edgeOverlaps <= Math.floor(q.arrows * 0.4),
    'real independent wire overlap must remain meaningfully below the severe-congestion threshold')
  assert.ok(canvasBundleTrunks(composed.scene).length >= 2,
    'negotiating independent corridors must not erase genuine shared source trunks')
  assert.ok(composed.routeDiagnostics.totalRouteLength <= 13_600,
    'joint placement must avoid compensating for crossings with a long perimeter detour')
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
