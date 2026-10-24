import assert from 'node:assert/strict'
import test from 'node:test'
import { anchorPoint, canvasArchitectureCardTemplate, canvasArchitectureProjection, canvasArchitectureScopeProjection, canvasArrowBoxRoute, canvasArrowLabelLayouts, canvasArrowRoutePath, canvasBundleTrunks, canvasCollapsedConnections, canvasIconRefMarkup, canvasSemanticLodProjection, canvasSceneToSvg, createCanvasSource, parseCanvasScene, resolveCanvasSemanticLod, serializeCanvasScene, type CanvasScene } from '../src/canvas.js'
import { canvasArrowLabelText } from '../src/canvasLabelText.js'

test('关系标签按显示宽度换行，中文、英文和超长文本保持有界', () => {
  for (const label of ['事务提交后持久化订单及关联审批记录', 'Validate authorization and persist approved order transaction', '审批处理'.repeat(80)]) {
    const layout = canvasArrowLabelText(label)
    assert.equal(layout.lines.length, 2)
    assert.ok(layout.width <= 218)
    assert.equal(layout.height, 40)
  }
  assert.ok(canvasArrowLabelText('审批处理'.repeat(80)).lines[1].endsWith('…'))
  assert.equal(canvasArrowLabelText('HTTP').lines.join(''), 'HTTP')
})

test('自动标签避让人工位置，并为独立连线生成相同的标签布局', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: '标签占用', width: 1000, height: 600,
    elements: [
      { id: 'a', type: 'node', x: 0, y: 200, width: 100, height: 80, text: '入口' },
      { id: 'b', type: 'node', x: 900, y: 200, width: 100, height: 80, text: '服务' },
      { id: 'automatic', type: 'arrow', from: 'a', to: 'b', fromAnchor: 'right', toAnchor: 'left', label: '自动布局的关系标签', emphasis: 'primary' },
      { id: 'manual', type: 'arrow', from: '', to: '', start: { x: 200, y: 400 }, end: { x: 800, y: 400 }, label: '人工指定位置', labelPosition: { x: 500, y: 226 } },
    ],
  }
  const source = serializeCanvasScene(scene)
  const labels = canvasArrowLabelLayouts(scene)
  const manual = labels.get('manual')!
  const automatic = labels.get('automatic')!
  assert.ok(manual)
  assert.deepEqual([manual.x, manual.y], [500, 226])
  assert.ok(Math.abs(automatic.x - manual.x) >= (automatic.width + manual.width) / 2
    || Math.abs(automatic.y - manual.y) >= (automatic.height + manual.height) / 2)
  assert.equal(serializeCanvasScene(scene), source)
})

test('自环关系绕出节点，而不是塌成一个点', () => {
  const box = { x: 100, y: 100, width: 120, height: 60 }
  const route = canvasArrowBoxRoute(box, box, { routing: 'orthogonal' }, true)
  assert.equal(route.length, 5)
  assert.deepEqual(route[0], { x: 220, y: 130 })
  assert.deepEqual(route.at(-1), { x: 160, y: 100 })
  const path = canvasArrowRoutePath(route)
  assert.equal(path, 'M 220 130 L 256 130 L 256 64 L 160 64 L 160 100')
})

test('正交路由在混合锚点时沿各自锚点法线进出', () => {
  const from = { x: 100, y: 100, width: 100, height: 60 }
  const to = { x: 400, y: 300, width: 100, height: 60 }
  const route = canvasArrowBoxRoute(from, to, { routing: 'orthogonal', fromAnchor: 'top', toAnchor: 'left' })
  assert.deepEqual(route[0], { x: 150, y: 100 })
  assert.deepEqual(route.at(-1), { x: 400, y: 330 })
  assert.equal(route[1].x, route[0].x)
  assert.equal(route.at(-2)!.y, route.at(-1)!.y)
})

test('round-trips a Canvas scene and renders standalone SVG', () => {
  const source = createCanvasSource('Architecture')
  const scene = parseCanvasScene(source)
  assert.equal(scene.type, 'diagram-plugin-canvas')
  assert.equal(scene.title, 'Architecture')
  assert.equal(scene.workbench, 'freeform')
  assert.equal(scene.elements.length, 0)
  scene.elements = [
    { id: 'source', type: 'node', x: 120, y: 120, width: 180, height: 80, text: 'Architecture' },
    { id: 'target', type: 'node', x: 420, y: 260, width: 180, height: 80, text: 'Target' },
    { id: 'source-target', type: 'arrow', from: 'source', to: 'target' },
  ]
  assert.equal(parseCanvasScene(serializeCanvasScene(scene)).elements.length, scene.elements.length)

  const svg = canvasSceneToSvg(scene)
  assert.match(svg, /^<svg /)
  assert.match(svg, /Architecture/)
  assert.match(svg, /marker-end="url\(#arrow\)"/)
})

test('persists Canvas workbench mode while keeping legacy canvases compatible', () => {
  const architecture = parseCanvasScene(createCanvasSource('Architecture', 'architecture'))
  assert.equal(architecture.workbench, 'architecture')
  assert.equal(architecture.architecture?.theme, 'enterprise')
  assert.equal(architecture.elements.length, 0)

  const flowchart = parseCanvasScene(createCanvasSource('Approval', 'flowchart'))
  assert.equal(flowchart.workbench, 'flowchart')
  assert.equal(flowchart.architecture, undefined)
  assert.equal(flowchart.elements.length, 0)

  const legacyArchitecture = parseCanvasScene(JSON.stringify({
    type: 'diagram-plugin-canvas', version: 1, title: 'Legacy', width: 800, height: 600, elements: [], architecture: { theme: 'enterprise' },
  }))
  assert.equal(legacyArchitecture.workbench, 'architecture')
})

test('round-trips registered shape refs and renders their geometry', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    workbench: 'flowchart',
    title: 'Flow shapes',
    width: 800,
    height: 500,
    elements: [
      { id: 'decision', type: 'node', x: 120, y: 100, width: 140, height: 104, text: '是否通过？', shapeRef: 'flowchart:decision' },
      { id: 'database', type: 'node', x: 420, y: 100, width: 156, height: 108, text: '订单库', shapeRef: 'flowchart:database' },
    ],
  }
  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  assert.equal(parsed.elements[0].type === 'node' ? parsed.elements[0].shapeRef : undefined, 'flowchart:decision')
  const svg = canvasSceneToSvg(parsed)
  assert.match(svg, /M 70 0 L 140 52 L 70 104 L 0 52 Z/)
  assert.match(svg, /C 0 0, 156 0, 156 14\.04/)

  const invalid = parseCanvasScene(JSON.stringify({ ...scene, elements: [{ ...scene.elements[0], shapeRef: 'flowchart:not-real' }] }))
  assert.equal(invalid.elements[0].type === 'node' ? invalid.elements[0].shapeRef : undefined, undefined)
})

test('auto anchors respect ellipse and decision geometry instead of the bounding rectangle', () => {
  const decision = { x: 100, y: 100, width: 140, height: 100, shapeRef: 'flowchart:decision' as const }
  const decisionPoint = anchorPoint(decision, 'auto', { x: 300, y: 220 })
  const decisionCenter = { x: 170, y: 150 }
  const diamondEquation = Math.abs(decisionPoint.x - decisionCenter.x) / 70 + Math.abs(decisionPoint.y - decisionCenter.y) / 50
  assert.ok(Math.abs(diamondEquation - 1) < 1e-9)

  const ellipse = { x: 100, y: 100, width: 160, height: 100, shapeRef: 'basic:ellipse' as const }
  const ellipsePoint = anchorPoint(ellipse, 'auto', { x: 320, y: 210 })
  const ellipseEquation = ((ellipsePoint.x - 180) / 80) ** 2 + ((ellipsePoint.y - 150) / 50) ** 2
  assert.ok(Math.abs(ellipseEquation - 1) < 1e-9)

  const rotated = { x: 100, y: 100, width: 200, height: 100, rotation: 90 }
  const right = anchorPoint(rotated, 'right', { x: 400, y: 150 })
  assert.ok(Math.abs(right.x - 200) < 1e-9)
  assert.ok(Math.abs(right.y - 250) < 1e-9)
})

test('round-trips free drawing lines and explicit style overrides', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    workbench: 'freeform',
    title: 'Styled drawing',
    width: 900,
    height: 600,
    elements: [
      { id: 'box', type: 'node', x: 80, y: 80, width: 180, height: 88, text: 'Styled', shapeRef: 'basic:rounded', fillColor: '#ffffff', strokeColor: '#2f73d9', strokeWidth: 2.5, opacity: 0.8, cornerRadius: 24, rotation: 30 },
      { id: 'line', type: 'arrow', from: '', to: '', start: { x: 120, y: 260 }, end: { x: 420, y: 260 }, markerEnd: 'none', strokeColor: '#ef3340', strokeWidth: 3, opacity: 0.7 },
      { id: 'free-arrow', type: 'arrow', from: '', to: '', start: { x: 120, y: 340 }, end: { x: 420, y: 420 }, markerEnd: 'arrow', routing: 'orthogonal' },
      { id: 'stroke', type: 'arrow', from: '', to: '', start: { x: 120, y: 500 }, end: { x: 360, y: 520 }, points: [{ x: 180, y: 470 }, { x: 260, y: 550 }], markerEnd: 'none', strokeColor: '#22a45d', freehand: true },
      { id: 'text', type: 'note', x: 520, y: 120, width: 240, height: 56, text: '独立文字', textOnly: true, fontSize: 28, fontWeight: 700, textColor: '#2f73d9' },
      { id: 'image', type: 'note', x: 520, y: 240, width: 260, height: 180, text: 'screen.png', imagePath: 'docs/diagrams/assets/screen-12345678.png', imageFit: 'cover', cornerRadius: 12 },
    ],
  }
  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  const line = parsed.elements.find((item) => item.id === 'line')
  assert.ok(line && line.type === 'arrow')
  assert.deepEqual(line.start, { x: 120, y: 260 })
  assert.equal(line.markerEnd, 'none')
  assert.equal(line.strokeColor, '#ef3340')
  const box = parsed.elements.find((item) => item.id === 'box')
  assert.ok(box && box.type === 'node')
  assert.equal(box.cornerRadius, 24)
  assert.equal(box.rotation, 30)
  const stroke = parsed.elements.find((item) => item.id === 'stroke')
  assert.ok(stroke && stroke.type === 'arrow')
  assert.equal(stroke.freehand, true)
  const text = parsed.elements.find((item) => item.id === 'text')
  assert.ok(text && text.type === 'note')
  assert.equal(text.textOnly, true)
  assert.equal(text.fontSize, 28)
  assert.equal(text.fontWeight, 700)
  assert.equal(text.textColor, '#2f73d9')
  const image = parsed.elements.find((item) => item.id === 'image')
  assert.ok(image && image.type === 'note')
  assert.equal(image.imagePath, 'docs/diagrams/assets/screen-12345678.png')
  assert.equal(image.imageFit, 'cover')

  const svg = canvasSceneToSvg(parsed, { imageSources: { 'docs/diagrams/assets/screen-12345678.png': 'data:image/png;base64,iVBORw0KGgo=' } })
  assert.match(svg, /stroke="#ef3340" stroke-width="3"/)
  assert.match(svg, /fill="#ffffff" stroke="#2f73d9" stroke-width="2\.5"/)
  assert.match(svg, /transform="rotate\(30 170 124\)"/)
  assert.match(svg, /Q 180 470 220 510/)
  assert.match(svg, /font-size="28" font-weight="700" fill="#2f73d9">独立文字<\/text>/)
  assert.match(svg, /href="data:image\/png;base64,iVBORw0KGgo="/)
  assert.match(svg, /preserveAspectRatio="xMidYMid slice"/)
  assert.equal((svg.match(/marker-end="url\(#arrow\)"/g) ?? []).length, 1)
})

test('rejects malformed Canvas documents', () => {
  assert.throws(() => parseCanvasScene('{bad json'), /JSON 格式无效/)
  assert.throws(() => parseCanvasScene('{"type":"other","version":1,"elements":[]}'), /受支持/)
})

test('round-trips optional architecture presentation metadata on version 1 canvases', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Platform',
    width: 1400,
    height: 900,
    elements: [],
    architecture: { theme: 'presentation', presentation: true, view: 'overview', density: 'compact' },
  }

  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  assert.equal(parsed.version, 1)
  assert.deepEqual(parsed.architecture, { theme: 'presentation', presentation: true, view: 'overview', density: 'compact' })
})

test('round-trips every built-in architecture visual theme', () => {
  for (const theme of ['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch'] as const) {
    const scene: CanvasScene = {
      type: 'diagram-plugin-canvas',
      version: 1,
      title: theme,
      width: 960,
      height: 620,
      architecture: { theme },
      elements: [],
    }
    assert.equal(parseCanvasScene(serializeCanvasScene(scene)).architecture?.theme, theme)
  }
})

test('renders selected AWS Azure and GCP architecture pack icons as embedded SVG images', () => {
  for (const ref of ['aws:lambda', 'azure:functionapps', 'gcp:cloud_run'] as const) {
    const markup = canvasIconRefMarkup(ref)
    assert.match(markup, /<image /)
    assert.match(markup, /data:image\/svg\+xml;base64,/)
    assert.match(markup, new RegExp(`data-icon-ref="${ref}"`))
  }
})

test('round-trips a visual icon override without changing node role or technology semantics', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Icon override',
    width: 960,
    height: 620,
    architecture: { theme: 'enterprise' },
    elements: [
      { id: 'api', type: 'node', x: 180, y: 220, width: 188, height: 80, text: 'Spring API', icon: 'service', stencil: 'spring', iconRef: 'lucide:server' },
    ],
  }

  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  const node = parsed.elements.find((item) => item.id === 'api')
  assert.ok(node && node.type === 'node')
  assert.equal(node.icon, 'service')
  assert.equal(node.stencil, 'spring')
  assert.equal(node.iconRef, 'lucide:server')
  assert.match(canvasSceneToSvg(parsed), /width="20" height="8"/)

  const invalid = parseCanvasScene(JSON.stringify({ ...scene, elements: [{ ...scene.elements[0], iconRef: 'lucide:not-real' }] }))
  const invalidNode = invalid.elements.find((item) => item.id === 'api')
  assert.ok(invalidNode && invalidNode.type === 'node')
  assert.equal(invalidNode.iconRef, undefined)
})

test('architecture themes produce distinct SVG treatments without changing node semantics', () => {
  const base: Omit<CanvasScene, 'architecture'> = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Theme treatments',
    width: 960,
    height: 620,
    groups: [{ id: 'app', label: 'Application', kind: 'boundary' }],
    elements: [
      { id: 'api', type: 'node', x: 180, y: 220, width: 188, height: 80, text: 'Spring API', icon: 'service', stencil: 'spring', groupId: 'app' },
      { id: 'db', type: 'node', x: 590, y: 220, width: 188, height: 80, text: 'PostgreSQL', icon: 'database', stencil: 'postgres', groupId: 'app' },
      { id: 'edge', type: 'arrow', from: 'api', to: 'db', routing: 'orthogonal', emphasis: 'secondary' },
    ],
  }
  const engineering = canvasSceneToSvg({ ...base, architecture: { theme: 'enterprise' } })
  const cloud = canvasSceneToSvg({ ...base, architecture: { theme: 'cloud' } })
  const sketch = canvasSceneToSvg({ ...base, architecture: { theme: 'sketch' } })

  assert.notEqual(engineering, cloud)
  assert.notEqual(cloud, sketch)
  assert.match(engineering, /Spring API/)
  assert.match(cloud, /Spring API/)
  assert.match(sketch, /stroke-opacity="0.62"/)
})

test('places relationship labels on routed segments without stacking them at the same point', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Labels',
    width: 1200,
    height: 700,
    elements: [
      { id: 'api', type: 'node', x: 100, y: 280, width: 180, height: 90, text: 'API' },
      { id: 'db', type: 'node', x: 900, y: 180, width: 180, height: 90, text: 'Database' },
      { id: 'search', type: 'node', x: 900, y: 380, width: 180, height: 90, text: 'Search' },
      { id: 'persist', type: 'arrow', from: 'api', to: 'db', label: 'writes', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left', points: [{ x: 520, y: 325 }, { x: 520, y: 225 }] },
      { id: 'query', type: 'arrow', from: 'api', to: 'search', label: 'queries', routing: 'orthogonal', fromAnchor: 'right', toAnchor: 'left', points: [{ x: 520, y: 325 }, { x: 520, y: 425 }] },
    ],
  }

  const labels = canvasArrowLabelLayouts(scene)
  const persist = labels.get('persist')
  const query = labels.get('query')
  assert.ok(persist)
  assert.ok(query)
  assert.notDeepEqual({ x: persist.x, y: persist.y }, { x: query.x, y: query.y })
})

test('round-trips and honors a manually positioned relationship label', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Manual label',
    width: 1000,
    height: 600,
    elements: [
      { id: 'a', type: 'node', x: 100, y: 200, width: 180, height: 90, text: 'A' },
      { id: 'b', type: 'node', x: 700, y: 200, width: 180, height: 90, text: 'B' },
      { id: 'edge', type: 'arrow', from: 'a', to: 'b', label: 'custom', labelPosition: { x: 510, y: 140 } },
    ],
  }
  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  const arrow = parsed.elements.find((item) => item.id === 'edge')
  assert.ok(arrow && arrow.type === 'arrow')
  assert.deepEqual(arrow.labelPosition, { x: 510, y: 140 })
  const layout = canvasArrowLabelLayouts(parsed).get('edge')
  assert.ok(layout)
  assert.deepEqual({ x: layout.x, y: layout.y }, { x: 510, y: 140 })
})

test('renders compact presentation architecture without dashboard metadata in SVG export', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Unified Knowledge Platform',
    width: 1440,
    height: 900,
    architecture: { theme: 'presentation', presentation: true },
    elements: [
      { id: 'api', type: 'node', x: 120, y: 180, width: 220, height: 100, text: 'Knowledge API', icon: 'api', stencil: 'grpc', emphasis: 'primary' },
      { id: 'db', type: 'node', x: 720, y: 180, width: 220, height: 100, text: 'PostgreSQL', icon: 'database', stencil: 'postgres' },
      { id: 'edge', type: 'arrow', from: 'api', to: 'db', label: 'gRPC', routing: 'orthogonal', emphasis: 'primary' },
      { id: 'noise', type: 'arrow', from: 'api', to: 'db', label: '写入', routing: 'orthogonal', emphasis: 'secondary' },
    ],
  }

  const svg = canvasSceneToSvg(scene)
  assert.doesNotMatch(svg, /SYSTEM ARCHITECTURE/)
  assert.doesNotMatch(svg, /主链路/)
  assert.doesNotMatch(svg, />Container</)
  assert.match(svg, />gRPC</)
  assert.doesNotMatch(svg, />写入</)
  assert.match(svg, /fill="#4169E1"/)
  assert.doesNotMatch(svg, />PG</)
})

test('enterprise architecture renders primary technical nodes with a restrained focus plate in SVG export', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Main business path',
    width: 960, height: 620, architecture: { theme: 'enterprise', view: 'detail' },
    elements: [
      { id: 'api', type: 'node', x: 90, y: 190, width: 180, height: 80, text: 'Core API', icon: 'api', emphasis: 'primary' },
      { id: 'worker', type: 'node', x: 430, y: 190, width: 180, height: 80, text: 'Aux Worker', icon: 'worker', emphasis: 'secondary' },
      { id: 'edge', type: 'arrow', from: 'api', to: 'worker', emphasis: 'primary' },
    ],
  }
  const svg = canvasSceneToSvg(scene)
  assert.match(svg, /fill-opacity="0\.14" stroke="[^"]+" stroke-opacity="0\.35" stroke-width="1"/)
  assert.match(svg, /font-weight="730"[^>]*>Core API<\/text>/)
  assert.doesNotMatch(svg, /font-weight="730"[^>]*>Aux Worker<\/text>/)
  assert.equal((svg.match(/fill-opacity="0\.14"/g) ?? []).length, 1)
  const technical = canvasSceneToSvg({ ...scene, architecture: { theme: 'technical' } })
  assert.doesNotMatch(technical, /font-weight="730"[^>]*>Core API<\/text>/)
})

test('overview projection keeps source data intact while reducing low-priority architecture detail', () => {
  const nodes = Array.from({ length: 30 }, (_, index) => ({
    id: `node-${index}`,
    type: 'node' as const,
    x: 80 + (index % 6) * 210,
    y: 140 + Math.floor(index / 6) * 120,
    width: 180,
    height: 82,
    text: `Service ${index}`,
    icon: index === 0 ? 'gateway' as const : index === 29 ? 'database' as const : 'service' as const,
    emphasis: index === 0 || index === 29 ? 'primary' as const : index < 12 ? 'secondary' as const : 'muted' as const,
    laneId: index < 15 ? 'arch-application' : 'arch-data',
  }))
  const arrows = Array.from({ length: 29 }, (_, index) => ({
    id: `edge-${index}`,
    type: 'arrow' as const,
    from: `node-${index}`,
    to: `node-${index + 1}`,
    emphasis: index === 0 || index === 28 ? 'primary' as const : index < 12 ? 'secondary' as const : 'muted' as const,
  }))
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Large Platform',
    width: 1600,
    height: 1000,
    architecture: { theme: 'technical', view: 'overview', density: 'auto' },
    elements: [...nodes, ...arrows],
  }

  const before = serializeCanvasScene(scene)
  const projection = canvasArchitectureProjection(scene)
  assert.equal(serializeCanvasScene(scene), before)
  assert.ok(projection.hiddenNodes > 0)
  assert.ok(projection.hiddenArrows > 0)
  assert.ok(projection.scene.elements.some((item) => item.id === 'node-0'))
  assert.ok(projection.scene.elements.some((item) => item.id === 'node-29'))
  assert.ok(projection.scene.elements.length < scene.elements.length)
})

test('architecture overview collapses dense semantic regions and aggregates their relationships', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Overview aggregation',
    width: 1700,
    height: 1000,
    architecture: { theme: 'enterprise', view: 'overview', density: 'compact' },
    groups: [
      { id: 'entry', label: 'Entry', kind: 'boundary' },
      { id: 'runtime', label: 'Runtime', kind: 'boundary' },
      { id: 'data', label: 'Data', kind: 'boundary' },
    ],
    elements: [
      { id: 'web', type: 'node', x: 100, y: 180, width: 180, height: 76, text: 'Web', icon: 'web', groupId: 'entry', emphasis: 'primary' },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `runtime-${index}`,
        type: 'node' as const,
        x: 480 + (index % 3) * 200,
        y: 140 + Math.floor(index / 3) * 130,
        width: 170,
        height: 76,
        text: `Runtime ${index}`,
        icon: 'service' as const,
        groupId: 'runtime',
        emphasis: index === 0 ? 'primary' as const : 'secondary' as const,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `data-${index}`,
        type: 'node' as const,
        x: 1080 + (index % 2) * 200,
        y: 140 + Math.floor(index / 2) * 130,
        width: 170,
        height: 76,
        text: `Data ${index}`,
        icon: 'database' as const,
        groupId: 'data',
        emphasis: index === 0 ? 'primary' as const : 'muted' as const,
      })),
      { id: 'web-runtime', type: 'arrow', from: 'web', to: 'runtime-0', emphasis: 'primary' },
      ...Array.from({ length: 5 }, (_, index) => ({ id: `runtime-data-${index}`, type: 'arrow' as const, from: `runtime-${index}`, to: `data-${index}`, emphasis: 'secondary' as const, bundleKey: 'group:runtime->data' })),
    ],
  }

  const projection = canvasArchitectureProjection(scene)
  const runtime = projection.scene.groups?.find((group) => group.id === 'runtime')
  const data = projection.scene.groups?.find((group) => group.id === 'data')
  assert.equal(runtime?.collapsed, true)
  assert.equal(data?.collapsed, true)
  const aggregated = canvasCollapsedConnections(projection.scene)
  assert.ok(aggregated.some((connection) => connection.fromKey === 'node:web' && connection.toKey === 'group:runtime'))
  assert.ok(aggregated.some((connection) => connection.fromKey === 'group:runtime' && connection.toKey === 'group:data' && connection.count >= 4))
  assert.equal(canvasBundleTrunks(projection.scene).length, 0)
  assert.ok(projection.hiddenNodes >= 10)
  assert.ok(projection.hiddenArrows >= 4)
})

test('architecture cards map roles into stable semantic templates', () => {
  assert.equal(canvasArchitectureCardTemplate({ id: 'u', type: 'node', x: 0, y: 0, width: 100, height: 80, text: 'User', icon: 'user' }).kind, 'actor')
  assert.equal(canvasArchitectureCardTemplate({ id: 'g', type: 'node', x: 0, y: 0, width: 100, height: 80, text: 'Gateway', icon: 'gateway' }).kind, 'entry')
  assert.equal(canvasArchitectureCardTemplate({ id: 'q', type: 'node', x: 0, y: 0, width: 100, height: 80, text: 'Kafka', icon: 'queue' }).kind, 'messaging')
  assert.equal(canvasArchitectureCardTemplate({ id: 'd', type: 'node', x: 0, y: 0, width: 100, height: 80, text: 'Postgres', icon: 'database' }).kind, 'data')
})

test('SVG export honors architecture overview projection', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Overview export',
    width: 1600,
    height: 900,
    architecture: { theme: 'presentation', presentation: true, view: 'overview', density: 'comfortable' },
    elements: [
      { id: 'web', type: 'node', x: 100, y: 180, width: 200, height: 90, text: 'Web', icon: 'web', emphasis: 'primary', laneId: 'arch-experience' },
      { id: 'api', type: 'node', x: 420, y: 180, width: 200, height: 90, text: 'API', icon: 'api', emphasis: 'primary', laneId: 'arch-application' },
      { id: 'db', type: 'node', x: 740, y: 180, width: 200, height: 90, text: 'DB', icon: 'database', emphasis: 'primary', laneId: 'arch-data' },
      ...Array.from({ length: 20 }, (_, index) => ({ id: `muted-${index}`, type: 'node' as const, x: 1000 + (index % 4) * 120, y: 120 + Math.floor(index / 4) * 90, width: 110, height: 70, text: `Muted ${index}`, icon: 'service' as const, emphasis: 'muted' as const, laneId: 'arch-application' })),
      { id: 'web-api', type: 'arrow', from: 'web', to: 'api', emphasis: 'primary' },
      { id: 'api-db', type: 'arrow', from: 'api', to: 'db', emphasis: 'primary' },
    ],
  }

  const svg = canvasSceneToSvg(scene)
  assert.match(svg, />Web</)
  assert.match(svg, />API</)
  assert.match(svg, />DB</)
  assert.doesNotMatch(svg, />Muted 19</)
  assert.doesNotMatch(svg, /SYSTEM ARCHITECTURE/)
})

test('architecture group drill-down collapses immediate child boundaries and keeps boundary dependencies', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Drill down',
    width: 1800,
    height: 1000,
    architecture: { theme: 'presentation', view: 'overview', density: 'auto' },
    groups: [
      { id: 'system', label: 'Knowledge Platform', kind: 'boundary', c4Type: 'software-system' },
      { id: 'runtime', label: 'Runtime', kind: 'boundary', c4Type: 'container', parentId: 'system' },
      { id: 'data', label: 'Data', kind: 'boundary', c4Type: 'container', parentId: 'system' },
    ],
    elements: [
      { id: 'web', type: 'node', x: 120, y: 200, width: 200, height: 90, text: 'Web', groupId: 'system', icon: 'web' },
      { id: 'api', type: 'node', x: 500, y: 200, width: 200, height: 90, text: 'API', groupId: 'runtime', icon: 'api' },
      { id: 'worker', type: 'node', x: 500, y: 380, width: 200, height: 90, text: 'Worker', groupId: 'runtime', icon: 'worker' },
      { id: 'db', type: 'node', x: 900, y: 200, width: 200, height: 90, text: 'DB', groupId: 'data', icon: 'database' },
      { id: 'oidc', type: 'node', x: 120, y: 560, width: 200, height: 90, text: 'OIDC Provider', icon: 'external' },
      { id: 'web-api', type: 'arrow', from: 'web', to: 'api' },
      { id: 'api-db', type: 'arrow', from: 'api', to: 'db' },
      { id: 'web-oidc', type: 'arrow', from: 'web', to: 'oidc' },
    ],
  }

  const projection = canvasArchitectureScopeProjection(scene, { kind: 'group', id: 'system' })
  assert.deepEqual(projection.breadcrumbs.map((item) => item.label), ['Knowledge Platform'])
  assert.equal(projection.scene.groups?.find((group) => group.id === 'system')?.collapsed, undefined)
  assert.equal(projection.scene.groups?.find((group) => group.id === 'runtime')?.collapsed, true)
  assert.equal(projection.scene.groups?.find((group) => group.id === 'data')?.collapsed, true)
  assert.ok(projection.scene.elements.some((item) => item.id === 'oidc'))
  assert.ok(projection.scene.elements.some((item) => item.id === 'web-oidc'))
})

test('architecture node focus keeps a bounded neighborhood and group breadcrumbs', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Node focus',
    width: 1600,
    height: 900,
    architecture: { theme: 'technical', view: 'detail', density: 'auto' },
    groups: [
      { id: 'system', label: 'System', kind: 'boundary', c4Type: 'software-system' },
      { id: 'runtime', label: 'Runtime', kind: 'boundary', c4Type: 'container', parentId: 'system' },
    ],
    elements: [
      { id: 'a', type: 'node', x: 100, y: 200, width: 180, height: 80, text: 'A', groupId: 'runtime' },
      { id: 'b', type: 'node', x: 400, y: 200, width: 180, height: 80, text: 'B', groupId: 'runtime' },
      { id: 'c', type: 'node', x: 700, y: 200, width: 180, height: 80, text: 'C', groupId: 'runtime' },
      { id: 'd', type: 'node', x: 1000, y: 200, width: 180, height: 80, text: 'D', groupId: 'runtime' },
      { id: 'ab', type: 'arrow', from: 'a', to: 'b' },
      { id: 'bc', type: 'arrow', from: 'b', to: 'c' },
      { id: 'cd', type: 'arrow', from: 'c', to: 'd' },
    ],
  }

  const projection = canvasArchitectureScopeProjection(scene, { kind: 'node', id: 'b', depth: 1 })
  assert.deepEqual(projection.breadcrumbs.map((item) => item.label), ['System', 'Runtime', 'B'])
  assert.deepEqual(projection.scene.elements.filter((item) => item.type !== 'arrow').map((item) => item.id).sort(), ['a', 'b', 'c'])
  assert.ok(!projection.scene.elements.some((item) => item.id === 'd'))
})

test('semantic LOD becomes more aggressive for large scenes at the same zoom', () => {
  assert.equal(resolveCanvasSemanticLod(0.7, 40), 'compact')
  assert.equal(resolveCanvasSemanticLod(0.7, 1400), 'overview')
  assert.equal(resolveCanvasSemanticLod(1, 3000), 'overview')
  assert.equal(resolveCanvasSemanticLod(1.2, 3000), 'compact')
  assert.equal(resolveCanvasSemanticLod(1.4, 3000), 'detail')
  assert.equal(resolveCanvasSemanticLod(0.34, 40), 'regions')
})

test('region LOD temporarily collapses semantic boundaries without mutating source state', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'LOD',
    width: 1800,
    height: 1000,
    groups: [
      { id: 'system', label: 'Platform', kind: 'boundary', c4Type: 'software-system' },
      { id: 'runtime', label: 'Runtime', kind: 'boundary', c4Type: 'container', parentId: 'system' },
    ],
    elements: [
      { id: 'web', type: 'node', x: 120, y: 180, width: 180, height: 80, text: 'Web', groupId: 'runtime' },
      { id: 'api', type: 'node', x: 420, y: 180, width: 180, height: 80, text: 'API', groupId: 'runtime' },
      { id: 'worker', type: 'node', x: 720, y: 180, width: 180, height: 80, text: 'Worker', groupId: 'runtime' },
      { id: 'db', type: 'node', x: 1020, y: 180, width: 180, height: 80, text: 'DB', groupId: 'system' },
      { id: 'a', type: 'arrow', from: 'web', to: 'api' },
      { id: 'b', type: 'arrow', from: 'api', to: 'worker' },
      { id: 'c', type: 'arrow', from: 'worker', to: 'db' },
    ],
  }
  const before = serializeCanvasScene(scene)
  const projection = canvasSemanticLodProjection(scene, 0.3)
  assert.equal(projection.level, 'regions')
  assert.deepEqual(projection.autoCollapsedGroupIds, ['system'])
  assert.equal(projection.scene.groups?.find((group) => group.id === 'system')?.collapsed, true)
  assert.ok(projection.hiddenNodes >= 4)
  assert.equal(serializeCanvasScene(scene), before)
})

test('region LOD keeps the selected region expanded', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'LOD selection',
    width: 1200,
    height: 700,
    groups: [{ id: 'runtime', label: 'Runtime', kind: 'boundary', c4Type: 'container' }],
    elements: [
      { id: 'a', type: 'node', x: 100, y: 100, width: 160, height: 80, text: 'A', groupId: 'runtime' },
      { id: 'b', type: 'node', x: 340, y: 100, width: 160, height: 80, text: 'B', groupId: 'runtime' },
      { id: 'c', type: 'node', x: 580, y: 100, width: 160, height: 80, text: 'C', groupId: 'runtime' },
    ],
  }
  const projection = canvasSemanticLodProjection(scene, 0.25, ['b'])
  assert.deepEqual(projection.autoCollapsedGroupIds, [])
  assert.equal(projection.scene.groups?.[0].collapsed, undefined)
})

test('semantic LOD samples very large ungrouped canvases while preserving selected nodes', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: 'Huge canvas',
    width: 12000,
    height: 8000,
    elements: Array.from({ length: 5000 }, (_, index) => ({
      id: `node-${index}`,
      type: 'node' as const,
      x: (index % 100) * 110,
      y: Math.floor(index / 100) * 110,
      width: 90,
      height: 70,
      text: `Node ${index}`,
      ...(index === 0 ? { emphasis: 'primary' as const } : {}),
    })),
  }
  const before = serializeCanvasScene(scene)
  const overview = canvasSemanticLodProjection(scene, 0.7, ['node-4999'])
  const overviewNodes = overview.scene.elements.filter((item) => item.type !== 'arrow')
  assert.equal(overview.level, 'overview')
  assert.ok(overviewNodes.length <= 640)
  assert.ok(overviewNodes.some((item) => item.id === 'node-0'))
  assert.ok(overviewNodes.some((item) => item.id === 'node-4999'))
  const defaultOverview = canvasSemanticLodProjection(scene, 1, ['node-4999'])
  assert.equal(defaultOverview.level, 'overview')
  assert.ok(defaultOverview.scene.elements.some((item) => item.id === 'node-4999'))
  const regions = canvasSemanticLodProjection(scene, 0.3, ['node-4999'])
  assert.equal(regions.level, 'regions')
  assert.ok(regions.scene.elements.filter((item) => item.type !== 'arrow').length <= 220)
  assert.equal(serializeCanvasScene(scene), before)
})

test('semantic LOD accepts the resolved tier without altering projection geometry', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Tier projection', width: 1000, height: 700,
    groups: [{ id: 'services', label: 'Services', kind: 'boundary' }],
    elements: Array.from({ length: 10 }, (_, i) => ({ id: `n-${i}`, type: 'node' as const,
      x: 80 + i * 75, y: 140, width: 64, height: 56, text: `Service ${i}`, groupId: 'services' })),
  }
  for (const [zoom, level] of [[1, 'detail'], [0.75, 'compact'], [0.5, 'overview'], [0.2, 'regions']] as const) {
    assert.deepEqual(canvasSemanticLodProjection(scene, level, ['n-4']), canvasSemanticLodProjection(scene, zoom, ['n-4']))
  }
})

test('改名前的 Canvas 文档仍可读取，并写回新类型', () => {
  const legacy = parseCanvasScene(JSON.stringify({
    type: 'codex-diagram-canvas', version: 1, title: '旧画布', width: 900, height: 600, elements: [],
  }))
  assert.equal(legacy.type, 'diagram-plugin-canvas')
  assert.equal(legacy.title, '旧画布')
  assert.equal(JSON.parse(createCanvasSource('新画布')).type, 'diagram-plugin-canvas')
  assert.throws(() => parseCanvasScene(JSON.stringify({ type: 'unknown-canvas', version: 1, elements: [] })), /不是受支持的/)
})
