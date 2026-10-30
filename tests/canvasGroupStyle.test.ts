import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasSceneToSvg, parseCanvasScene, serializeCanvasScene, type CanvasScene } from '../src/canvas.js'
import { createCanvasTemplateScene, createCanvasTemplateSource } from '../src/canvasTemplates.js'
import { fitCanvasText } from '../src/canvasLabelText.js'

test('分层画布保留组底色与左侧层标签', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas',
    version: 1,
    title: '分层样例',
    width: 900,
    height: 600,
    background: '#fff7ed',
    style: 'pastel',
    workbench: 'architecture',
    architecture: { theme: 'enterprise', view: 'detail', density: 'comfortable', scenario: 'enterprise-system' },
    groups: [{ id: 'layer-access', label: '接入层', kind: 'boundary', fillColor: '#fde8ea', labelSide: 'left', labelFontSize: 17, labelColor: '#334155' }],
    elements: [{ id: 'web', type: 'node', x: 180, y: 90, width: 220, height: 80, text: 'React Web', groupId: 'layer-access', fontSize: 18, fontWeight: 700, textColor: '#0f172a' }],
  }
  const parsed = parseCanvasScene(serializeCanvasScene(scene))
  assert.equal(parsed.background, '#fff7ed')
  assert.equal(parsed.groups?.[0]?.fillColor, '#fde8ea')
  assert.equal(parsed.groups?.[0]?.labelSide, 'left')
  assert.equal(parsed.groups?.[0]?.labelFontSize, 17)
  assert.equal(parsed.groups?.[0]?.labelColor, '#334155')
  assert.equal(parsed.elements[0]?.type === 'node' ? parsed.elements[0].fontSize : undefined, 18)
  assert.equal(parsed.elements[0]?.type === 'node' ? parsed.elements[0].fontWeight : undefined, 700)
  const svg = canvasSceneToSvg(parsed)
  assert.match(svg, /fill="#fff7ed"/)
  assert.match(svg, /fill="#fde8ea"/)
  assert.match(svg, /text-anchor="end"/)
  assert.match(svg, /font-size="17"/)
  assert.match(svg, /fill="#334155"/)
  assert.match(svg, /font-weight="700"/)

  const layered = createCanvasTemplateScene('分层模板', 'layered')
  assert.equal(layered.groups?.length, 5)
  assert.equal(layered.groups?.[0]?.labelSide, 'left')
  assert.equal(layered.groups?.[0]?.fillColor, '#fde8ea')
  assert.equal(layered.elements.filter((item) => item.type === 'node').length, 19)
  assert.equal(layered.elements.filter((item) => item.type === 'arrow').length, 4)

  const cards = createCanvasTemplateScene('卡片模板', 'cards')
  assert.equal(cards.groups?.length, 6)
  assert.equal(cards.elements.filter((item) => item.type === 'node').length, 22)
  assert.equal(parseCanvasScene(createCanvasTemplateSource('卡片模板', 'cards')).title, '卡片模板')
  assert.equal(parseCanvasScene(serializeCanvasScene({ ...scene, background: 'red' })).background, undefined)
  const transparent = parseCanvasScene(serializeCanvasScene({ ...scene, background: 'transparent' }))
  assert.equal(transparent.background, 'transparent')
  assert.match(canvasSceneToSvg(transparent), /fill="transparent"/)

  const solid = parseCanvasScene(serializeCanvasScene({ ...scene, groupBorderStyle: 'solid', groups: [{ ...scene.groups![0]!, borderStyle: 'solid' }] }))
  assert.equal(solid.groupBorderStyle, 'solid')
  assert.equal(solid.groups?.[0]?.borderStyle, 'solid')
  assert.doesNotMatch(canvasSceneToSvg(solid), /stroke-dasharray="[^"]+"/)

  const dashed = parseCanvasScene(serializeCanvasScene({ ...scene, groupBorderStyle: 'dashed' }))
  assert.equal(dashed.groupBorderStyle, 'dashed')
  assert.match(canvasSceneToSvg(dashed), /stroke-dasharray="[^"]+"/)

  assert.equal(fitCanvasText('OpenSearch / Qdrant', 500, 20), 'OpenSearch / Qdrant')
  assert.match(fitCanvasText('OpenSearch / Qdrant', 40, 20), /…$/)
  assert.equal(fitCanvasText('接入层', 200, 17), '接入层')
})
