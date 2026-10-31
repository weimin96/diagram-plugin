import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGenerationPrompt, buildModificationPrompt, buildSubgraphModificationPrompt } from '../src/aiPrompts.js'
import { detectArchitectureStyle } from '../src/architectureStyle.js'
import { composeEnterpriseArchitecture } from '../src/enterpriseArchitecture.js'
import { normalizeGeneratedArchitectureTerminals } from '../src/architectureRouteRepair.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { beautifyArchitectureScene } from '../src/architectureDesign.js'
import { canvasArchitectureGroupPresentation, canvasArrowLabelLayouts, canvasEnterpriseModuleSvg, canvasEnterpriseModuleTextLayout, canvasGroupFrames, canvasPresentationGroupFrames, canvasSceneToSvg, parseCanvasScene, serializeCanvasScene, type CanvasNode } from '../src/canvas.js'
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
    type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'engineering', title: 'Platform', scope: '', instructions: '',
  })
  assert.match(architecture, /diagram\.composeArchitecture/)
  assert.match(architecture, /diagram\.designGuide/)
  assert.match(architecture, /primaryPath/)
  assert.match(architecture, /sourcePaths/)
  assert.match(architecture, /partition/)
  assert.match(architecture, /architectureStyle=engineering/)
  assert.doesNotMatch(architecture, /diagram\.update/)

  const flowchart = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'flowchart', title: 'Approval', scope: '', instructions: '',
  })
  assert.match(flowchart, /canvasWorkbench 使用 flowchart/)
  assert.match(flowchart, /跨角色流程可使用 lanes/)
  assert.match(flowchart, /flowchart:decision/)
  assert.match(flowchart, /shapeRef/)
  assert.doesNotMatch(flowchart, /Architecture Diagram Skill/)
  const c4 = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'architecture', title: 'C4 Container', scope: '', instructions: '展示容器边界',
  })
  assert.match(c4, /diagram\.create/)
  assert.match(c4, /c4Type 和 parentId/)
  assert.doesNotMatch(c4, /diagram\.composeArchitecture/)
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
    architectureStyle: 'engineering',
    title: 'System Architecture',
    scope: 'src/',
    instructions: '展示核心服务、数据层和外部依赖',
  })
  assert.match(prompt, /hub-spoke/)
  assert.match(prompt, /关键依赖/)
  assert.match(prompt, /x\/y\/width\/height/)
  assert.match(prompt, /diagram\.inspectQuality/)
  assert.match(prompt, /quality/)

  const unspecified = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'architecture', title: '系统架构', scope: '', instructions: '',
  })
  assert.match(unspecified, /国内企业方案风格.*国际工程架构风格/)
  assert.doesNotMatch(unspecified, /diagram\.composeArchitecture/)
  assert.equal(detectArchitectureStyle('C4 Container 架构'), 'engineering')
  assert.equal(detectArchitectureStyle('总体功能架构图'), 'enterprise')
  assert.equal(detectArchitectureStyle('企业知识库系统架构'), undefined)

  const proposal = buildGenerationPrompt('/workspace', {
    type: 'canvas', architectureStyle: 'enterprise', title: '总体架构', scope: '', instructions: '',
  })
  assert.match(proposal, /architectureStyle=enterprise/)
  assert.match(proposal, /每个 layer/)
  assert.match(proposal, /visualRole=support-rail.*supportLayers/)
  assert.doesNotMatch(proposal, /不要默认把所有组件排成等权卡片矩阵/)

  const intent = {
    title: 'Enterprise vs Engineering',
    nodes: [
      { id: 'Web', text: 'Web 客户端', icon: 'web' as const, layer: '接入层' },
      { id: 'API', text: '应用服务', icon: 'service' as const, layer: '应用层' },
      { id: 'DB', text: '数据库', icon: 'database' as const, layer: '数据层' },
    ],
    relations: [{ from: 'Web', to: 'API', label: 'HTTP' }, { from: 'API', to: 'DB', label: 'SQL' }],
  }
  const enterprise = composeEnterpriseArchitecture(intent)
  const engineering = composeArchitectureGraph(intent)
  for (const result of [enterprise, engineering]) {
    assert.deepEqual(result.scene.elements.filter((item) => item.type === 'node').map((item) => item.id).sort(), ['API', 'DB', 'Web'])
    assert.deepEqual(result.scene.elements.filter((item) => item.type === 'arrow').map((item) => [item.from, item.to]), [['Web', 'API'], ['API', 'DB']])
  }
  assert.deepEqual(enterprise.scene.groups?.map((group) => group.label), ['接入层', '应用层', '数据层'])
  assert.equal(enterprise.scene.groups?.every((group) => group.labelSide === 'left'), true)
  const proposalSvg = canvasSceneToSvg(enterprise.scene)
  assert.ok(proposalSvg.includes('canvas-enterprise-band'))
  assert.equal((proposalSvg.match(/class="canvas-enterprise-module"/g) ?? []).length, 3,
    'proposal modules use matrix cells rather than engineering icon cards')
  assert.equal((proposalSvg.match(/class="canvas-enterprise-band"/g) ?? []).length, 3)
  assert.match(proposalSvg, /class="canvas-enterprise-module"[^]*?<rect[^>]+rx="5"/,
    'compact proposal cells retain an icon tile')
  assert.ok((proposalSvg.match(/stroke-linejoin="round" stroke-linecap="round"/g) ?? []).length >= 3,
    'authored role icons are displayed rather than silently discarded')
  assert.match(proposalSvg, /font-size="15" font-weight="650"/,
    'module titles stay readable with the icon inside the available width')
  assert.doesNotMatch(canvasSceneToSvg(engineering.scene), /class="canvas-enterprise-module"/,
    'engineering/C4 cards must not inherit domestic proposal cell markup')
  const composed = composeEnterpriseArchitecture({
    title: '有证据的组合式方案',
    proposalMode: 'proposal',
    nodes: [
      { id: 'entry', text: '客户端', layer: '访问入口', icon: 'web' },
      { id: 'gateway', text: 'API网关', layer: '统一接入', icon: 'gateway', visualRole: 'gateway-band' },
      { id: 'admin', text: '用户管理', layer: '服务中台', moduleGroup: '运营平台', visualRole: 'capability-chip' },
      { id: 'role', text: '角色管理', layer: '服务中台', moduleGroup: '运营平台', visualRole: 'capability-chip' },
      { id: 'ops', text: '运维', layer: '服务中台', visualRole: 'support-rail' },
      { id: 'mysql', text: 'MySQL', layer: '数据资源', icon: 'database', visualRole: 'resource-icon' },
    ],
    relations: [
      { from: 'entry', to: 'gateway' }, { from: 'gateway', to: 'admin' },
      { from: 'admin', to: 'mysql' },
    ],
  })
  const composedScene = composed.scene
  const composedSvg = canvasSceneToSvg(composedScene)
  assert.equal(composedScene.elements.filter((item) => item.type === 'node').length, 6)
  assert.equal(composedScene.elements.filter((item) => item.type === 'arrow').length, 3)
  assert.deepEqual(composedScene.elements.filter((item) => item.type === 'arrow')
    .map((item) => [item.from, item.to]), [['entry', 'gateway'], ['gateway', 'admin'], ['admin', 'mysql']])
  assert.equal(composedScene.architecture?.proposalMode, 'proposal')
  assert.ok(composedScene.groups?.some((group) =>
    group.label === '运营平台' && Boolean(group.parentId)), 'capability blocks live in a real editable nested group')
  for (const role of ['gateway-band', 'capability-chip', 'support-rail', 'resource-icon']) {
    assert.match(composedSvg, new RegExp(`proposal-${role}`))
  }
  assert.equal(composed.quality.metrics.nodeOverlaps, 0)
  assert.equal(composedScene.elements.filter((item) => item.type === 'arrow'
    && item.markerEnd === 'arrow').length, 3)
  const reopened = parseCanvasScene(serializeCanvasScene(composedScene))
  assert.deepEqual(reopened.elements.filter((item) => item.type === 'node').map((item) =>
    [item.id, item.proposalRole, item.groupId, item.text]),
  composedScene.elements.filter((item) => item.type === 'node').map((item) =>
    [item.id, item.proposalRole, item.groupId, item.text]),
  'all composed node roles, labels and membership survive reopening')
  assert.deepEqual(reopened.elements.filter((item) => item.type === 'arrow').map((item) =>
    [item.id, item.from, item.to, item.label, item.lineStyle]),
  composedScene.elements.filter((item) => item.type === 'arrow').map((item) =>
    [item.id, item.from, item.to, item.label, item.lineStyle]),
  'all real directed relationships survive reopening')
  assert.deepEqual(reopened.groups, composedScene.groups, 'verified parent-child capability membership survives reopening')
  const dependencySvg = canvasSceneToSvg({
    ...reopened, architecture: { ...reopened.architecture!, proposalMode: 'dependencies' },
  })
  assert.doesNotMatch(dependencySvg, /proposal-gateway-band|proposal-support-rail|proposal-resource-icon/,
    'dependency view renders regular modules but retains original roles in data')
  assert.equal(reopened.elements.find((item) => item.id === 'gateway')?.type, 'node')
  assert.equal((reopened.elements.find((item) => item.id === 'gateway') as CanvasNode).proposalRole, 'gateway-band')
  const spanning = composeEnterpriseArchitecture({
    title: '跨层支撑与自动组合', proposalMode: 'proposal',
    nodes: [
      { id: 'entry', text: '浏览器入口', layer: '入口层', icon: 'web' },
      { id: 'api', text: 'API网关', layer: '接入层', icon: 'gateway' },
      { id: 'auth', text: '身份校验', layer: '应用层', moduleGroup: '身份服务' },
      { id: 'policy', text: '策略管理', layer: '应用层', moduleGroup: '身份服务' },
      { id: 'worker', text: '工作流处理', layer: '能力层', icon: 'service' },
      { id: 'db', text: '关系数据库', layer: '资源层', partition: 'data', icon: 'database' },
      { id: 'ops', text: '运维管理', layer: '应用层', visualRole: 'support-rail',
        supportLayers: ['接入层', '应用层', '能力层', '资源层'] },
      { id: 'audit', text: '安全审计', layer: '能力层', visualRole: 'support-rail',
        supportLayers: ['应用层', '能力层', '资源层'] },
    ],
    relations: [
      { from: 'entry', to: 'api' }, { from: 'api', to: 'auth' },
      { from: 'auth', to: 'worker' }, { from: 'worker', to: 'db' },
    ],
  })
  const spanningNodes = new Map(spanning.scene.elements.filter((item): item is CanvasNode =>
    item.type === 'node').map((node) => [node.id, node]))
  const ops = spanningNodes.get('ops')!, audit = spanningNodes.get('audit')!
  const api = spanningNodes.get('api')!, db = spanningNodes.get('db')!
  assert.equal(api.proposalRole, 'gateway-band', 'single confirmed gateway icon selects a full-width bar')
  assert.equal(db.proposalRole, 'resource-icon', 'verified data partition and database icon select a resource tile')
  assert.equal(spanningNodes.get('auth')?.proposalRole, 'capability-chip')
  assert.equal(spanningNodes.get('policy')?.proposalRole, 'capability-chip')
  assert.ok(ops.y < spanningNodes.get('auth')!.y && ops.y + ops.height > db.y + db.height,
    'cross-layer operations rail spans its confirmed layer range')
  assert.ok(audit.y > ops.y && audit.y + audit.height <= ops.y + ops.height,
    'second support rail has a narrower independently confirmed scope')
  assert.ok(audit.x >= ops.x + ops.width + 10, 'multiple side rails have separate dedicated tracks')
  assert.ok(ops.x > Math.max(...['api', 'auth', 'policy', 'worker', 'db']
    .map((id) => spanningNodes.get(id)!.x + spanningNodes.get(id)!.width)),
  'support rails remain outside all business layer content')
  assert.ok(ops.x + ops.width <= spanning.scene.width && audit.x + audit.width <= spanning.scene.width)
  assert.equal(spanning.quality.metrics.nodeOverlaps, 0)
  assert.equal(spanning.quality.metrics.edgeNodeIntersections, 0)
  assert.deepEqual(spanning.scene.elements.filter((item) => item.type === 'arrow')
    .map((arrow) => [arrow.from, arrow.to]), [
      ['entry', 'api'], ['api', 'auth'], ['auth', 'worker'], ['worker', 'db'],
    ], 'cross-layer visuals never manufacture or drop actual relationships')
  const restoredSpanning = parseCanvasScene(serializeCanvasScene(spanning.scene))
  assert.deepEqual((restoredSpanning.elements.find((item) => item.id === 'ops') as CanvasNode).supportLayers,
    ['接入层', '应用层', '能力层', '资源层'], 'cross-layer coverage survives reopening')
  assert.equal(restoredSpanning.groups?.filter((group) => group.parentId).length, 1,
    'automatic capability container is a real parent-child group')
  const spanningFrames = canvasPresentationGroupFrames(spanning.scene)
  const contained = spanningFrames.find((frame) => frame.label === '身份服务')!
  const outer = spanningFrames.find((frame) => frame.label === '应用层')!
  assert.ok(contained.x >= outer.x && contained.x + contained.width <= outer.x + outer.width
    && contained.y >= outer.y && contained.y + contained.height <= outer.y + outer.height,
  'the presentation layer fully encloses its real nested container')
  assert.match(canvasSceneToSvg(spanning.scene), /proposal-support-rail/)
  assert.throws(() => composeEnterpriseArchitecture({
    ...spanning.scene, title: '非法范围',
    nodes: [
      { id: 'a', text: 'A', layer: 'A', visualRole: 'support-rail' as const, supportLayers: ['A', 'C'] },
      { id: 'b', text: 'B', layer: 'B' }, { id: 'c', text: 'C', layer: 'C' },
    ], relations: [],
  }), /不能跨过未声明支持/, 'non-contiguous support coverage is rejected')
  assert.throws(() => composeEnterpriseArchitecture({
    title: '非法角色', nodes: [
      { id: 'a', text: 'A', layer: 'A', visualRole: 'module' as const, supportLayers: ['A'] },
      { id: 'b', text: 'B', layer: 'B' },
    ], relations: [],
  }), /只适用于/, 'regular modules cannot acquire a fake cross-layer scope')
  assert.throws(() => composeEnterpriseArchitecture({
    title: '未验证的支撑范围', nodes: [
      { id: 'a', text: 'A', layer: 'A', visualRole: 'support-rail' as const, supportLayers: ['A', '不存在的层'] },
      { id: 'b', text: 'B', layer: 'B' },
    ], relations: [],
  }), /必须引用已确认/, 'unknown coverage never fabricates a layer')
  assert.throws(() => composeEnterpriseArchitecture({
    title: '相互矛盾的角色', nodes: [
      { id: 'a', text: 'A', layer: 'A', visualRole: 'support-rail' as const, moduleGroup: '平台' },
      { id: 'b', text: 'B', layer: 'B' },
    ], relations: [],
  }), /不能同时声明/, 'a horizontal module group cannot swallow a cross-layer rail')
  const brandModule = canvasEnterpriseModuleSvg({
    id: 'redis', type: 'node', text: '缓存服务 Redis', subtitle: '热点数据 · 会话',
    x: 0, y: 0, width: 168, height: 82, icon: 'cache', stencil: 'redis',
  }, false, true)
  assert.match(brandModule, /class="canvas-enterprise-module"/)
  assert.match(brandModule, /<path d="[^"]+" fill="#FF4438"\/>/,
    'existing Redis brand path and its brand color are preserved')
  assert.match(brandModule, /热点数据/, 'detail view preserves the real subtitle')
  assert.doesNotMatch(canvasEnterpriseModuleSvg({
    id: 'redis', type: 'node', text: '缓存服务 Redis', subtitle: '热点数据 · 会话',
    x: 0, y: 0, width: 168, height: 82, icon: 'cache', stencil: 'redis',
  }, false, false), /<tspan[^>]*>热点数据/,
  'overview suppresses subtitle text without modifying the underlying node')
  assert.equal(canvasPresentationGroupFrames(enterprise.scene).every((frame) =>
    canvasArchitectureGroupPresentation(enterprise.scene, frame) === 'enterprise-band'), true)
  assert.ok(enterprise.scene.width < 1000, 'small proposal architecture should use a compact canvas')
  const verifiedPath = composeEnterpriseArchitecture({ ...intent, primaryPath: ['Web', 'API', 'DB'] })
  assert.equal(verifiedPath.scene.elements.filter((item) => item.type === 'node' && item.emphasis === 'primary').length, 3)
  assert.equal(verifiedPath.scene.elements.filter((item) => item.type === 'arrow' && item.emphasis === 'primary').length, 2)
  assert.equal(verifiedPath.summary.resolvedDensity, 'comfortable')
  assert.notEqual(engineering.scene.groups?.[0]?.labelSide, 'left')
  const engineFrames = canvasPresentationGroupFrames(engineering.scene)
  assert.ok(engineFrames.some((frame) => frame.memberIds.length === 1
    && canvasArchitectureGroupPresentation(engineering.scene, frame) === 'compact-region'))
  assert.ok(canvasSceneToSvg(engineering.scene).includes('canvas-compact-region'))
  const legacyEngineering = { ...engineering.scene, architecture: { ...engineering.scene.architecture!, diagramStyle: undefined } }
  assert.ok(canvasPresentationGroupFrames(legacyEngineering).some((frame) =>
    canvasArchitectureGroupPresentation(legacyEngineering, frame) === 'compact-region'),
  'existing generated engineering diagrams without an explicit style should display compact auto-regions')
  assert.throws(() => composeEnterpriseArchitecture({ ...intent, nodes: intent.nodes.map((node) => ({ ...node, layer: '应用层' })) }), /至少需要两个/)

  const unequalLayers = composeEnterpriseArchitecture({
    title: '企业分层视图', relations: [], nodes: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `Access${i}`, text: `接入模块${i}`, layer: '接入层' })),
      { id: 'Service', text: '核心服务', layer: '服务层' },
      { id: 'Storage', text: '对象存储', layer: '存储层' },
    ],
  })
  const originalFrames = canvasGroupFrames(unequalLayers.scene)
  const visualFrames = canvasPresentationGroupFrames(unequalLayers.scene)
  assert.notEqual(originalFrames[0].width, originalFrames[1].width, '路由组边界保持真实节点占地')
  assert.equal(new Set(visualFrames.map((frame) => frame.width)).size, 1, '展示分层对齐宽度')
  assert.equal(new Set(visualFrames.map((frame) => frame.x)).size, 1, '展示分层对齐左侧')
  assert.equal(new Set(visualFrames.map((frame) => frame.height)).size, 1, '展示分层统一高度')
  assert.equal(unequalLayers.scene.elements.filter((item) => item.type === 'node').length, 8)
  assert.equal(unequalLayers.scene.elements.filter((item) => item.type === 'arrow').length, 0)
  assert.ok(visualFrames.every((frame) => frame.x >= 0 && frame.height > 0))
  const matrixNodes = unequalLayers.scene.elements.filter((item) => item.type === 'node')
  assert.equal(new Set(matrixNodes.map((item) => item.width)).size, 1)
  assert.equal(new Set(matrixNodes.map((item) => item.height)).size, 1)
  assert.equal(matrixNodes[0].width, 182, 'relation-free proposal schemes use the dense module matrix')

  const renamedGroups = new Map(unequalLayers.scene.groups!.map((group, index) => [group.id, `L${index + 1}`]))
  const scriptedScene = {
    ...unequalLayers.scene,
    groups: unequalLayers.scene.groups!.map((group) =>
      ({ ...group, id: renamedGroups.get(group.id)!, kind: 'boundary' as const })),
    elements: unequalLayers.scene.elements.map((element) =>
      element.type === 'node' ? { ...element, groupId: renamedGroups.get(element.groupId!) } : element),
  }
  scriptedScene.groups[2].label = '基础设施与运维保障层'
  const scriptedFrames = canvasPresentationGroupFrames(scriptedScene)
  assert.equal(scriptedFrames.every((frame) =>
    canvasArchitectureGroupPresentation(scriptedScene, frame) === 'enterprise-band'), true,
  'user-authored group IDs must not change the explicitly selected enterprise visual style')
  assert.ok(scriptedFrames[0].labelRailWidth! > 132, 'long verified layer names receive adequate label width')
  assert.equal((canvasSceneToSvg(scriptedScene).match(/class="canvas-enterprise-band"/g) ?? []).length, 3)
  const restyled = beautifyArchitectureScene(scriptedScene, { theme: 'technical', repartition: true, relayout: false })
  assert.deepEqual(restyled.scene.groups, scriptedScene.groups, 'beautify must not replace proposal layers with engineering partitions')
  assert.deepEqual(restyled.scene.elements, scriptedScene.elements, 'appearance changes cannot disturb authored node or edge geometry')
  assert.equal(restyled.scene.architecture?.diagramStyle, 'enterprise')
  assert.equal(restyled.summary.routedEdges, 0)
  const unevenScene = { ...scriptedScene, elements: scriptedScene.elements.map((element) =>
    element.type === 'node' && element.id !== 'Service' ? { ...element, height: element.height - 8 } : element) }
  assert.deepEqual(beautifyArchitectureScene(unevenScene, { relayout: true }).scene.elements, unevenScene.elements,
    'generic reflow never silently changes user-authored enterprise card dimensions')
  const aligned = beautifyArchitectureScene(unevenScene, { alignCardHeights: true })
  assert.equal(new Set(aligned.scene.elements.filter((item) => item.type === 'node').map((item) => item.height)).size, 1,
    'explicit enterprise reflow aligns unlocked heights only after whole-scene validation')
  assert.ok(aligned.summary.enrichedNodes > 0, 'reflow proposes a real geometry change, not a cosmetic-only no-op')
  assert.deepEqual(aligned.scene.groups, unevenScene.groups)

  const labelled = composeEnterpriseArchitecture({
    ...intent,
    relations: [{ from: 'Web', to: 'API', label: 'HTTPS / REST' }, { from: 'API', to: 'DB', label: 'SQL' }],
  })
  assert.equal(canvasArrowLabelLayouts(labelled.scene).size, 2, 'small diagram labels remain readable between bands')

  const denseNodes = Array.from({ length: 36 }, (_, index) => ({
    id: `Module${index}`, text: `模块${index}`, layer: `第${Math.floor(index / 6) + 1}层`,
  }))
  const denseEdges = Array.from({ length: 48 }, (_, index) => ({
    from: `Module${index % 30}`, to: `Module${6 + ((index * 3 + 11) % 30)}`,
  }))
  const dense = composeEnterpriseArchitecture({ title: '密集关系', nodes: denseNodes, relations: denseEdges })
  assert.equal(dense.scene.elements.filter((item) => item.type === 'arrow').length, denseEdges.length)
  assert.equal(dense.quality.metrics.nodeOverlaps, 0)
  assert.equal(dense.quality.metrics.edgeNodeIntersections, 0)
  assert.ok(dense.quality.metrics.edgeCrossings < 132 && dense.quality.metrics.edgeOverlaps < 240,
    'relation-aware column candidates must reduce the known fixed-four-column conflict baseline')
  assert.ok(dense.routeDiagnostics.terminalNormalViolations <= 20,
    'generated independent relations must reduce tangential entries without loosening geometric collision limits')
  assert.equal(normalizeGeneratedArchitectureTerminals(dense.scene), dense.scene,
    'terminal normalization is idempotent; repeated rendering must not migrate edge waypoints')
  assert.equal(dense.scene.width, 1500, 'dense matrix must not become unreadably wide')
  assert.ok(dense.scene.height < 1930, 'multiline module matrix must reduce redundant layer height')
  assert.equal(new Set(dense.scene.elements.flatMap((item) => item.type === 'node'
    && item.groupId === '__arch-layer-1' ? [item.y] : [])).size, 1,
  'a six-module layer should fit a single aligned row when safe')
  assert.equal(dense.scene.groups?.length, 6)
  assert.equal(dense.scene.architecture?.density, 'auto')
  assert.equal(dense.summary.resolvedDensity, 'compact')
  assert.equal(dense.summary.bundledEdges, dense.scene.elements.filter((item) => item.type === 'arrow' && item.bundleKey).length)
  assert.ok(dense.visualPlan.review && Array.isArray(dense.visualPlan.review.blockers))

  // Dense route-order refinement must preserve the editable graph, not hide edges.
  const denseReopened = composeEnterpriseArchitecture({ title: '密集关系', nodes: denseNodes, relations: denseEdges })
  assert.deepEqual(denseReopened.scene.elements, dense.scene.elements, 'route order is stable across generation')
  assert.equal(dense.scene.elements.filter((item) => item.type === 'arrow').length, denseEdges.length)
  assert.equal(dense.quality.metrics.edgeNodeIntersections, 0)
  const longNames = composeEnterpriseArchitecture({ title: '完整业务名称',
    nodes: denseNodes.map((node) => ({ ...node,
      text: '城市规划业务综合分析治理协同审查和动态监测服务', icon: 'service' as const })),
    relations: denseEdges,
  })
  assert.equal(longNames.scene.elements.filter((item) => item.type === 'node'
    && canvasEnterpriseModuleTextLayout(item, false).typography.truncated).length, 0,
  'a compact grid must never clip readable full module titles merely to fit six columns')
})

test('参考图片忠实重绘不强制走语义自动布局', () => {
  const prompt = buildGenerationPrompt('/workspace', {
    type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'enterprise', title: '原有架构复刻',
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
