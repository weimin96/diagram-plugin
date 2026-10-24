import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGenerationPrompt, buildModificationPrompt, buildSubgraphModificationPrompt } from '../src/aiPrompts.js'
import type { DiagramDocument } from '../src/types.js'

test('builds a Canvas-specific generation contract without Mermaid instructions', () => {
  const prompt = buildGenerationPrompt('/workspace', {
    type: 'canvas',
    title: 'Platform Map',
    scope: 'src/',
    instructions: '突出外部依赖',
  })
  assert.match(prompt, /type=diagram-plugin-canvas/)
  assert.match(prompt, /node、note、arrow/)
  assert.match(prompt, /labelPosition/)
  assert.match(prompt, /不要写 Mermaid 语法/)
  assert.match(prompt, /src\//)
})

test('keeps Canvas workbench intent explicit for architecture and flowchart boards', () => {
  const architecture = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'architecture', title: 'Platform', scope: '', instructions: '',
  })
  assert.match(architecture, /diagram\.composeArchitecture/)
  assert.match(architecture, /diagram\.designGuide/)
  assert.doesNotMatch(architecture, /diagram\.update/)

  const flowchart = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'flowchart', title: 'Approval', scope: '', instructions: '',
  })
  assert.match(flowchart, /canvasWorkbench 使用 flowchart/)
  assert.match(flowchart, /跨角色流程可使用 lanes/)
  assert.match(flowchart, /flowchart:decision/)
  assert.match(flowchart, /shapeRef/)
  assert.doesNotMatch(flowchart, /Architecture Diagram Skill/)
})

test('keeps Mermaid generation instructions for structured diagrams', () => {
  const prompt = buildGenerationPrompt('/workspace', {
    type: 'sequence',
    title: 'Request Flow',
    scope: '',
    instructions: '',
  })
  assert.match(prompt, /生成一张 Mermaid 图表/)
  assert.match(prompt, /diagram\.create/)
  assert.match(prompt, /Mermaid 必须可渲染/)
  assert.match(prompt, /Sequence Diagram Skill/)
  assert.match(prompt, /participant 按调用方向稳定排序/)
})

test('injects the matching professional skill for each primary Mermaid type', () => {
  const expectations = [
    ['flowchart', /Flowchart Skill/, /决策节点/],
    ['er', /ER Diagram Skill/, /聚合根/],
    ['state', /State Diagram Skill/, /正常终态/],
    ['mindmap', /Mindmap Skill/, /一级分支/],
  ] as const
  for (const [type, skill, rule] of expectations) {
    const prompt = buildGenerationPrompt('/workspace', { type, title: 'Test', scope: '', instructions: '' })
    assert.match(prompt, skill)
    assert.match(prompt, rule)
    assert.match(prompt, /构图原型/)
    assert.match(prompt, /证据：/)
    assert.match(prompt, /diagram\.inspectQuality/)
  }
})

test('architecture generation uses topology archetypes and a bounded quality loop', () => {
  const prompt = buildGenerationPrompt('/workspace', {
    type: 'canvas',
    title: 'System Architecture',
    scope: 'src/',
    instructions: '展示核心服务、数据层和外部依赖',
  })
  assert.match(prompt, /hub-spoke/)
  assert.match(prompt, /关键依赖/)
  assert.match(prompt, /x\/y\/width\/height/)
  assert.match(prompt, /diagram\.inspectQuality/)
  assert.match(prompt, /quality/)
})

test('参考图片忠实重绘不强制走语义自动布局', () => {
  const prompt = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'architecture', title: '原有架构复刻',
    scope: '', instructions: '参考图片，忠实保留原有分组和布局',
  })
  assert.match(prompt, /diagram\.create/)
  assert.doesNotMatch(prompt, /diagram\.composeArchitecture/)
})

test('data visualization prompts enforce truthful quantitative semantics', () => {
  const sankey = buildGenerationPrompt('/workspace', { type: 'sankey', title: 'Traffic', scope: '', instructions: '' })
  assert.match(sankey, /Sankey Diagram Skill/)
  assert.match(sankey, /同一量纲/)
  assert.match(sankey, /不要为了图形丰富度编造数值/)

  const requirement = buildGenerationPrompt('/workspace', { type: 'requirement', title: 'Requirements', scope: '', instructions: '' })
  assert.match(requirement, /Requirement Diagram Skill/)
  assert.match(requirement, /satisfies\/verifies/)
})

test('prefers incremental Canvas patches for finite conversational edits', () => {
  const diagram = {
    type: 'canvas',
    title: 'Architecture',
    name: 'architecture',
    path: 'docs/diagrams/architecture.diagram.json',
    source: '{}',
    modifiedAt: '2026-10-09T00:00:00.000Z',
  } as DiagramDocument
  const prompt = buildModificationPrompt('/workspace', diagram, '给 API 增加缓存依赖')
  assert.match(prompt, /diagram\.proposeSubgraphPatch/)
  assert.match(prompt, /diagram\.getSubgraph/)
  assert.match(prompt, /不要把未变化的 x\/y\/width\/height/)
  assert.match(prompt, /layout 默认 preserve/)
  assert.match(prompt, /branchLabel/)
  assert.match(prompt, /只有用户明确要求多个方案/)
  assert.match(prompt, /diagram\.composeProposalBranches/)
})

test('subgraph modification prompt sends deltas instead of a full Canvas document', () => {
  const diagram = {
    type: 'canvas',
    title: 'Architecture',
    name: 'architecture',
    path: 'docs/diagrams/architecture.diagram.json',
    source: '{}',
    modifiedAt: '2026-10-09T00:00:00.000Z',
  } as DiagramDocument
  const prompt = buildSubgraphModificationPrompt('/workspace', diagram, ['api'], '增加 Redis')
  assert.match(prompt, /diagram\.getSubgraph/)
  assert.match(prompt, /diagram\.proposeSubgraphPatch/)
  assert.match(prompt, /不要生成或传回完整 Canvas JSON/)
  assert.match(prompt, /新增 node\/note 可以省略 x\/y/)
  assert.match(prompt, /branchLabel/)
  assert.match(prompt, /diagram\.composeProposalBranches/)
})
