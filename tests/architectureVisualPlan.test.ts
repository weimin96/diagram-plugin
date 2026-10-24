import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureCases } from './fixtures/architecture/cases.js'
import { architectureBenchmarkCases } from '../scripts/architecture-benchmark-cases.js'
import { ARCHITECTURE_VISUAL_REFERENCES, planArchitectureVisual } from '../src/architectureVisualPlan.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasArchitectureProjection, serializeCanvasScene } from '../src/canvas.js'

test('专业构图参考规则明确描述阅读路径，而不是虚构审美分数', () => {
  assert.equal(new Set(ARCHITECTURE_VISUAL_REFERENCES.map((item) => item.scenario)).size, 5)
  assert.ok(ARCHITECTURE_VISUAL_REFERENCES.every((item) =>
    item.readingPattern.includes('→') && item.priorities.length >= 3 && item.antiPatterns.length >= 2))
})

test('企业系统、微服务与数据平台选择各自专业构图规范，主链 ID 取自真实关系', () => {
  const expected = {
    'business-platform': 'enterprise-system',
    microservices: 'microservices',
    'data-platform': 'data-platform',
    'agent-runtime': 'ai-agent',
    deployment: 'deployment',
  } as const
  for (const sample of architectureCases) {
    const result = composeArchitectureGraph(sample.intent)
    assert.equal(result.visualPlan.scenario, expected[sample.id as keyof typeof expected], sample.id)
    const nodes = new Set(sample.intent.nodes.map((node) => node.id))
    const edges = new Set(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => item.id))
    assert.ok(result.visualPlan.primaryNodeIds.every((id) => nodes.has(id)), sample.id)
    assert.ok(result.visualPlan.primaryRelationIds.every((id) => edges.has(id)), sample.id)
    assert.equal(result.visualPlan.review.readyForVisualReview, true, sample.id)
  }
})

test('复杂宽图默认总览但完整节点与关系仍在原始场景，详情可恢复', () => {
  const sample = architectureBenchmarkCases('extended').find((item) => item.id === 'data-platform-fanout')!
  const result = composeArchitectureGraph(sample.intent)
  assert.equal(result.visualPlan.recommendedView, 'overview')
  assert.equal(result.scene.architecture?.view, 'overview')
  assert.equal(result.scene.elements.filter((item) => item.type === 'node').length, sample.intent.nodes.length)
  assert.equal(result.scene.elements.filter((item) => item.type === 'arrow').length, sample.intent.relations.length)
  const before = serializeCanvasScene(result.scene)
  const projected = canvasArchitectureProjection(result.scene)
  assert.ok(projected.scene.elements.length <= result.scene.elements.length)
  assert.ok(result.visualPlan.review.repairTargets.some((target) => target.concern === 'tiny-overview-text'),
    '高扇出宽图必须保留真实的适配字号风险，不能被局部线路问题挤出报告')
  const detail = { ...result.scene, architecture: { ...result.scene.architecture!, view: 'detail' as const } }
  assert.equal(canvasArchitectureProjection(detail).scene.elements.length, result.scene.elements.length)
  assert.equal(serializeCanvasScene(result.scene), before, 'projection does not mutate persisted graph')
})

test('高扇出重叠给出真实关系 ID 的定向修复目标，而不是虚构共享主干', () => {
  const sample = architectureBenchmarkCases('extended').find((item) => item.id === 'microservices-fanout')!
  const output = composeArchitectureGraph(sample.intent)
  const targets = output.visualPlan.review.repairTargets.filter((item) => item.concern === 'overlapping-relationships')
  const arrowIds = new Set(output.scene.elements.filter((item) => item.type === 'arrow').map((item) => item.id))
  assert.equal(output.visualPlan.review.concerns.includes('overlapping-relationships'), true)
  assert.ok(targets.length >= 1 && targets.length <= 2)
  assert.ok(targets.every((item) => item.elementIds.length === 2
    && item.elementIds.every((id) => arrowIds.has(id))
    && item.action.includes('不得伪造共享主干')))
  assert.ok(output.visualPlan.review.repairTargets.length <= 5)
})

test('轻量架构保留详情，视觉审查与保存的结构模型互不干扰', () => {
  const result = composeArchitectureGraph(architectureCases[0].intent)
  assert.equal(result.visualPlan.recommendedView, 'detail')
  assert.equal(result.scene.architecture?.view, 'detail')
  const source = serializeCanvasScene(result.scene)
  const review = planArchitectureVisual(result.scene, result.semanticComposition,
    result.quality, result.presentation, result.routeDiagnostics)
  assert.deepEqual(review, result.visualPlan)
  assert.equal(serializeCanvasScene(result.scene), source)
})

test('用户明确给出的场景会持久化，但不会改变真实关系和布局判定', () => {
  const intent = architectureCases.find((item) => item.id === 'business-platform')!.intent
  const result = composeArchitectureGraph({ ...intent, visualScenario: 'enterprise-system' })
  assert.equal(result.visualPlan.scenario, 'enterprise-system')
  assert.equal(result.scene.architecture?.scenario, 'enterprise-system')
  const parsed = JSON.parse(serializeCanvasScene(result.scene))
  assert.equal(parsed.architecture.scenario, 'enterprise-system')
  assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to]),
    intent.relations.map((item) => [item.from, item.to]))
})

test('视觉修正目标仅引用真实元素，不以局部穿区指标诱导破坏其他连线', () => {
  const sample = architectureCases.find((item) => item.id === 'data-platform')!
  const result = composeArchitectureGraph(sample.intent)
  const targets = result.visualPlan.review.repairTargets
  const ids = new Set([
    ...result.scene.elements.map((item) => item.id),
    ...(result.scene.groups ?? []).map((item) => item.id),
  ])
  assert.ok(targets.length <= 5)
  assert.equal(targets.some((item) => item.concern === 'cross-boundary-intrusion'),
    result.routeDiagnostics.unrelatedFrameIntrusionLength > 0,
    '只针对仍实际存在的穿区线路建议修复，不保留旧几何产生的虚假修复目标')
  assert.ok(targets.every((item) => item.elementIds.every((id) => ids.has(id))))
  assert.ok(targets.filter((item) => item.concern === 'cross-boundary-intrusion')
    .every((item) => item.action.includes('不能单独绕线造成新增交叉')))
})
