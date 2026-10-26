import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { allDiagramSkills, diagramSkill } from '../src/diagramSkills/registry.js'
import { diagramTypeGroups, mermaidDiagramTypes } from '../src/types.js'

test('every exposed Mermaid diagram type has a registered skill', () => {
  const exposed = mermaidDiagramTypes.map((item) => item.type).sort()
  const registered = allDiagramSkills().map((item) => item.type).sort()
  assert.deepEqual(registered, exposed)
})

test('every published Mermaid diagram type has a real Chrome stress and pixel-baseline case', async () => {
  const fixtures = await readdir('tests/fixtures/visual-stress')
  const covered = new Set(fixtures.filter((name) => name.endsWith('.mmd'))
    .map((name) => name.split('__')[0]))
  for (const { type } of mermaidDiagramTypes) {
    assert.ok(covered.has(type), `${type} must have a dedicated Chrome fixture, not only a default template`)
  }
  const baseline = await readdir('tests/fixtures/visual-baseline/light')
  for (const { type } of mermaidDiagramTypes) {
    assert.ok(baseline.some((filename) => filename.startsWith(type + '__') && filename.endsWith('.png')),
      `${type} must have a real pixel baseline`)
  }
})

test('primary diagram skills carry type-specific composition and anti-pattern rules', () => {
  for (const type of ['flowchart', 'sequence', 'er', 'state', 'mindmap'] as const) {
    const skill = diagramSkill(type)
    assert.ok(skill.compositionPatterns.length >= 1, `${type} should expose composition archetypes`)
    assert.ok(skill.compositionRules.length >= 3, `${type} should have deep composition rules`)
    assert.ok(skill.densityRules.length >= 1, `${type} should have density rules`)
    assert.ok(skill.evidenceRules.length >= 1, `${type} should have evidence rules`)
    assert.ok(skill.antiPatterns.length >= 3, `${type} should have anti-pattern rules`)
    assert.ok(skill.generationRules.length >= 1, `${type} should have generation rules`)
    assert.ok(skill.validationRules.some((rule) => rule.includes('diagram.inspectQuality')), `${type} should have a quality loop`)
  }
})

test('secondary diagram types still have dedicated skill rules instead of generic fallback', () => {
  for (const type of ['class', 'gantt', 'timeline', 'gitgraph', 'journey', 'quadrant'] as const) {
    const skill = diagramSkill(type)
    assert.equal(skill.type, type)
    assert.ok(skill.compositionRules.length > 0)
    assert.ok(skill.antiPatterns.length > 0)
  }
})

test('extended analysis and data diagram types have specialized skills', () => {
  for (const type of ['kanban', 'requirement', 'sankey', 'xychart', 'pie', 'radar', 'treemap', 'ishikawa'] as const) {
    const skill = diagramSkill(type)
    assert.equal(skill.type, type)
    assert.ok(skill.compositionPatterns.length >= 1, `${type} should expose composition archetypes`)
    assert.ok(skill.compositionRules.length >= 2, `${type} should have composition rules`)
    assert.ok(skill.antiPatterns.length >= 2, `${type} should have anti-pattern rules`)
    assert.ok(skill.generationRules.length >= 1, `${type} should have generation rules`)
  }
})

test('skills encode visual argument, evidence and review instead of card-wall prompting', () => {
  const flowchart = diagramSkill('flowchart')
  assert.ok(flowchart.compositionPatterns.includes('decision-tree'))
  assert.ok(flowchart.compositionPatterns.includes('convergence'))
  assert.ok(flowchart.visualRules.some((rule) => rule.includes('视觉论证')))
  assert.ok(flowchart.visualRules.some((rule) => rule.includes('相同大小的卡片')))
  assert.ok(flowchart.evidenceRules.some((rule) => rule.includes('事实')))
  assert.ok(flowchart.validationRules.some((rule) => rule.includes('needsRevision')))
})

test('diagram type selector groups advanced types instead of flattening the menu', () => {
  const data = diagramTypeGroups.find((group) => group.category === 'data')
  const analysis = diagramTypeGroups.find((group) => group.category === 'analysis')
  const special = diagramTypeGroups.find((group) => group.category === 'special')
  assert.deepEqual(data?.items.map((item) => item.type), ['sankey', 'xychart', 'pie', 'radar', 'treemap'])
  assert.ok(analysis?.items.some((item) => item.type === 'kanban'))
  assert.ok(analysis?.items.some((item) => item.type === 'requirement'))
  assert.deepEqual(special?.items.map((item) => item.type), ['ishikawa'])
})

test('Mermaid skills keep theme colors in Visual Grammar by default', () => {
  for (const type of ['flowchart', 'sequence', 'er', 'state', 'mindmap'] as const) {
    const rules = diagramSkill(type).visualRules.join('\n')
    assert.match(rules, /style\/classDef/)
    assert.match(rules, /Visual Grammar/)
  }
})

test('Mermaid skills expose named visual profiles instead of arbitrary per-node styling', () => {
  const rules = diagramSkill('flowchart').visualRules.join('\n')
  assert.match(rules, /diagram-plugin:style=<profile>/)
  assert.match(rules, /technical/)
  assert.match(rules, /minimal/)
  assert.match(rules, /editorial/)
  assert.match(rules, /presentation/)
})

test('model-facing skills guard Mermaid 11.17 syntax traps found by browser benchmarks', () => {
  const sequence = diagramSkill('sequence')
  assert.ok(sequence.compositionRules.some((rule) => rule.includes('self-message') && rule.includes('EventBus')))

  const requirement = diagramSkill('requirement')
  assert.ok(requirement.compositionRules.some((rule) => rule.includes('text: "下单必须校验库存"')))
  assert.ok(requirement.compositionRules.some((rule) => rule.includes('unknown/none/unspecified')))
  assert.ok(requirement.compositionRules.some((rule) => rule.includes('test_case')))

  const ishikawa = diagramSkill('ishikawa')
  assert.ok(ishikawa.compositionRules.some((rule) => rule.includes('title/effect/category/cause')))

  const gantt = diagramSkill('gantt')
  assert.ok(gantt.compositionRules.some((rule) => rule.includes('after backend frontend')))
  assert.ok(gantt.compositionRules.some((rule) => rule.includes('after backend, frontend')))
})
