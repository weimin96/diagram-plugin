import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasScene } from '../src/canvas.js'
import { assessArchitecturePresentation, recommendArchitectureInitialReadingViewport, recommendArchitectureReadableZoom, recommendArchitectureReadingViewport, recommendArchitectureTitleScale } from '../src/architecturePresentationQuality.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasArchitectureProjection, canvasSceneToSvg, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
import { architectureCases } from './fixtures/architecture/cases.js'

function twoNodes(width: number, nodesAt: number[]): CanvasScene {
  return {
    type: 'diagram-plugin-canvas',
    version: 1, title: '视觉质量', width, height: 1200,
    architecture: { theme: 'enterprise', density: 'compact', view: 'detail' },
    elements: nodesAt.map((x, index) => ({
      id: 'node' + index, type: 'node' as const, text: '业务服务',
      x, y: 120 + index * 75, width: 160, height: 72,
    })),
  }
}

test('视觉可读性独立识别宽画布适配后的字号风险', () => {
  const scene = twoNodes(2400, [140, 600])
  const before = JSON.stringify(scene)
  const evaluation = assessArchitecturePresentation(scene)
  assert.equal(evaluation.estimatedTitlePxAtFit, 6.3)
  assert.ok(evaluation.warnings.includes('small-fit-text'))
  assert.equal(JSON.stringify(scene), before)
  assert.ok(!assessArchitecturePresentation(twoNodes(1200, [140, 600])).warnings.includes('small-fit-text'))
})

test('只在节点数量足够时提示明显空旷的画布', () => {
  const scene = twoNodes(2400, [10, 20, 30, 40, 50, 60])
  const result = assessArchitecturePresentation(scene)
  assert.ok(result.nodeBoundsCoverage < .48)
  assert.ok(result.warnings.includes('low-content-coverage'))
  assert.ok(!assessArchitecturePresentation(twoNodes(2400, [10])).warnings.includes('low-content-coverage'))
})

test('架构基准有可追溯的适配字号与画布覆盖率数据', () => {
  const graph = composeArchitectureGraph(architectureCases.find((item) => item.id === 'agent-runtime')!.intent)
  assert.equal(graph.presentation.referenceWidth, 1200)
  assert.ok(graph.presentation.nodeBoundsCoverage > 0 && graph.presentation.nodeBoundsCoverage <= 1)
  assert.ok(graph.presentation.nodeAreaCoverage > 0 && graph.presentation.nodeAreaCoverage <= 1)
  assert.ok(graph.presentation.estimatedTitlePxAtFit >= 11)
  assert.ok(!graph.presentation.warnings.includes('small-fit-text'))
  assert.ok((graph.scene.architecture?.titleScale ?? 1) > 1)
  const source = serializeCanvasScene(graph.scene)
  assert.equal(parseCanvasScene(source).architecture?.titleScale, graph.scene.architecture?.titleScale)
  // SVG export must use the stored scale rather than the pre-boost font.
  const boostedSvg = canvasSceneToSvg(graph.scene)
  const unboostedSvg = canvasSceneToSvg({ ...graph.scene, architecture: { ...graph.scene.architecture!, titleScale: 1 } })
  assert.notEqual(boostedSvg, unboostedSvg)
  assert.match(boostedSvg, /font-size="16\.\d+"/)
})

test('标题补偿有界，并且不影响已有 Canvas 文件和特别长的标题', () => {
  assert.equal(recommendArchitectureTitleScale(twoNodes(1200, [140, 600])), 1)
  const long = twoNodes(2400, [140, 600])
  const first = long.elements[0]
  if (first.type !== 'node') throw new Error('Expected a node')
  first.text = '这是一条很长很长的系统架构节点说明文字'
  assert.equal(recommendArchitectureTitleScale(long), 1)
})

test('清晰阅读使用实际面板尺寸，同时不修改场景和既有缩放', () => {
  const wide = twoNodes(2400, [140, 600])
  const original = JSON.stringify(wide)
  const calculated = recommendArchitectureReadableZoom(wide, 720, 500)
  assert.ok(calculated > 1 && calculated <= 4)
  assert.ok(12.5 * calculated * Math.min(720 / wide.width, 500 / wide.height) >= 11.5)
  assert.equal(recommendArchitectureReadableZoom(wide, 720, 500, calculated + .2), calculated + .2)
  assert.equal(recommendArchitectureReadableZoom(wide, 260, 160), 4)
  assert.equal(recommendArchitectureReadableZoom(wide, 0, 500), 1)
  const ordinary = { ...wide, architecture: undefined }
  assert.equal(recommendArchitectureReadableZoom(ordinary, 720, 500), 1)
  assert.equal(JSON.stringify(wide), original)
})

test('主链阅读优先聚焦真实高关联核心节点，并维持字号与场景不变', () => {
  const scene: CanvasScene = {
    ...twoNodes(2400, [100, 1950]), height: 960,
    elements: [
      { id: 'entry', type: 'node', text: '入口', x: 100, y: 100, width: 160, height: 72, emphasis: 'primary' },
      { id: 'core', type: 'node', text: '核心', x: 1570, y: 420, width: 160, height: 72, emphasis: 'primary' },
      { id: 'other', type: 'node', text: '外围', x: 2080, y: 700, width: 160, height: 72, emphasis: 'secondary' },
      { id: 'link1', type: 'arrow', from: 'entry', to: 'core', emphasis: 'primary' },
      { id: 'link2', type: 'arrow', from: 'core', to: 'other' },
      { id: 'link3', type: 'arrow', from: 'core', to: 'entry' },
    ],
  }
  const before = JSON.stringify(scene)
  const view = recommendArchitectureReadingViewport(scene, 900, 620)
  const scale = Math.min(900 / scene.width, 620 / scene.height)
  assert.ok(12.5 * view.zoom * scale >= 11.5)
  const centerX = view.x + scene.width / view.zoom / 2
  const centerY = view.y + scene.height / view.zoom / 2
  assert.ok(Math.abs(centerX - 1650) < 0.1, 'center on the primary node with highest relationship degree')
  assert.ok(Math.abs(centerY - 456) < 0.1)
  assert.equal(recommendArchitectureReadingViewport(scene, 900, 620, view.zoom + .2).zoom, view.zoom + .2)
  assert.equal(JSON.stringify(scene), before)
  assert.deepEqual(recommendArchitectureReadingViewport({ ...scene, architecture: undefined }, 900, 620),
    { x: 0, y: 0, zoom: 1 })
})

test('总览只在当前可见节点中选择聚焦对象，不追踪被隐藏的主链节点', () => {
  const scene = twoNodes(2400, [200, 800])
  const primary = scene.elements[0]
  if (primary.type !== 'node') throw new Error('Expected node')
  scene.elements[0] = { ...primary, emphasis: 'primary' }
  const preview = { ...scene, elements: scene.elements.slice(1) }
  const view = recommendArchitectureReadingViewport(preview, 800, 500)
  assert.ok(view.zoom > 1)
  const centerX = view.x + scene.width / view.zoom / 2
  assert.ok(Math.abs(centerX - 880) < 1)
  const full = canvasArchitectureProjection({ ...scene, architecture: { ...scene.architecture!, view: 'detail' } })
  assert.equal(full.scene.elements.length, scene.elements.length)
})

test('过宽架构总览初次打开自动聚焦可读区域，其他画布和详细视图保持默认镜头', () => {
  const wide = twoNodes(2400, Array.from({ length: 19 }, (_, index) => 100 + index * 60))
  const overview = { ...wide, architecture: { ...wide.architecture!, view: 'overview' as const } }
  const original = JSON.stringify(overview)
  const recommendation = recommendArchitectureInitialReadingViewport(overview, overview, 900, 600)
  assert.ok(recommendation && recommendation.zoom > 1)
  const initialFitScale = Math.min(900 / wide.width, 600 / wide.height)
  assert.ok(12.5 * recommendation.zoom * initialFitScale >= 11.5)
  assert.deepEqual(recommendArchitectureInitialReadingViewport(overview, overview, 900, 600), recommendation)
  assert.equal(recommendArchitectureInitialReadingViewport(wide, wide, 900, 600), null)
  assert.equal(recommendArchitectureInitialReadingViewport({ ...overview, architecture: undefined }, overview, 900, 600), null)
  assert.equal(recommendArchitectureInitialReadingViewport(overview, overview, 0, 600), null)
  assert.equal(recommendArchitectureInitialReadingViewport({ ...overview, width: 960 }, overview, 900, 600), null)
  assert.equal(JSON.stringify(overview), original)
})

test('严重分区冲突的折叠总览即使原始标题字号正常，也会首次放大阅读', () => {
  const source = twoNodes(1250, Array.from({ length: 19 }, (_, index) => 40 + index * 45))
  source.height = 1120
  source.architecture!.view = 'overview'
  const projection: CanvasScene = { ...source,
    groups: [{ id: 'arch-application', kind: 'boundary', label: '应用', collapsed: true }],
    elements: source.elements.map((item, index) => item.type === 'node' && index > 2
      ? { ...item, groupId: 'arch-application' } : item),
  }
  assert.ok(assessArchitecturePresentation(source).estimatedTitlePxAtFit >= 11)
  const original = JSON.stringify(source)
  const view = recommendArchitectureInitialReadingViewport(source, projection, 900, 600)
  assert.ok(view && view.zoom > 1)
  assert.equal(JSON.stringify(source), original)
})

test('聚焦镜头不选择被折叠边界隐藏的主链节点', () => {
  const scene: CanvasScene = {
    ...twoNodes(2200, []),
    groups: [{ id: 'applications', label: '应用', kind: 'boundary', collapsed: true }],
    elements: [
      { id: 'hidden', type: 'node', text: '隐藏的主链', x: 1800, y: 90, width: 160, height: 72,
        groupId: 'applications', emphasis: 'primary' },
      { id: 'visible', type: 'node', text: '可见入口', x: 120, y: 180, width: 160, height: 72,
        emphasis: 'secondary' },
    ],
  }
  const view = recommendArchitectureReadingViewport(scene, 900, 620)
  const centerX = view.x + scene.width / view.zoom / 2
  assert.ok(centerX < scene.width / 2, 'collapsed hidden main-path nodes must not drive camera focus')
})
