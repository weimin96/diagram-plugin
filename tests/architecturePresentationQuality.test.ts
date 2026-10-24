import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasScene } from '../src/canvas.js'
import { assessArchitecturePresentation, recommendArchitectureTitleScale } from '../src/architecturePresentationQuality.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasSceneToSvg, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
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
