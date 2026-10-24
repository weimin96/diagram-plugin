import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { canvasSceneToSvg, parseCanvasScene, serializeCanvasScene } from '../src/canvas.js'
import { canvasStyledBox, canvasVisualSkin, diagramVisualStyles } from '../src/diagramVisualStyles.js'
import { buildGenerationPrompt, buildModificationPrompt } from '../src/aiPrompts.js'

test('内置样式可持久化且只改变渲染，不改写图表内容和手工样式', () => {
  const scene = parseCanvasScene(readFileSync(new URL('./fixtures/canvas-labels/chinese-relations.diagram.json', import.meta.url), 'utf8'))
  const original = serializeCanvasScene(scene)
  const outputs = new Set<string>()
  for (const style of diagramVisualStyles) {
    const styled = parseCanvasScene(serializeCanvasScene({ ...scene, style: style.id }))
    assert.equal(styled.style, style.id)
    assert.deepEqual(styled.elements, scene.elements)
    outputs.add(canvasSceneToSvg(styled))
    assert.match(canvasSceneToSvg(styled, { background: '#18181b' }), /#f8fafc/)
  }
  assert.equal(outputs.size, diagramVisualStyles.length)
  assert.equal(serializeCanvasScene(scene), original)
  const node = { id: 'manual', type: 'node' as const, text: '手工节点', x: 20, y: 20, width: 100, height: 60, fillColor: '#ffeecc', strokeColor: '#123456', strokeWidth: 4, cornerRadius: 7 }
  assert.deepEqual(canvasStyledBox(node, canvasVisualSkin('ocean', false)), node)
  assert.throws(() => parseCanvasScene(JSON.stringify({ ...scene, style: 'unsupported' })), /不支持的画布样式/)
  assert.equal(parseCanvasScene(original).style, undefined)
  const architecture = { ...scene, architecture: { theme: 'technical' as const } }
  assert.notEqual(canvasSceneToSvg({ ...architecture, style: 'ink' }), canvasSceneToSvg(architecture))
  assert.deepEqual(parseCanvasScene(serializeCanvasScene({ ...architecture, style: 'ink' })).elements, scene.elements)
})

test('AI 生成合同包含样式选择场景，局部修改保留原样式', () => {
  const prompt = buildGenerationPrompt('/workspace', { type: 'canvas', title: '审批流程', scope: '', instructions: '' })
  for (const style of diagramVisualStyles) assert.ok(prompt.includes(`scene.style="${style.id}"`))
  assert.match(prompt, /主动选择/)
  assert.match(buildModificationPrompt('/workspace', { path: 'flow.diagram.json', name: '审批流程', type: 'canvas', modifiedAt: '', source: '{}' }, '修改节点标题'), /scene.style/)
})

test('架构节点的实底和手工底色在导出中使用可读前景色', () => {
  const source = parseCanvasScene(readFileSync(new URL('./fixtures/shared-styles/architecture__blueprint.diagram.json', import.meta.url), 'utf8'))
  const scene = { ...source, style: 'ocean' as const, elements: [
    { id: 'entry', type: 'node' as const, text: '主入口', x: 30, y: 30, width: 180, height: 80, emphasis: 'primary' as const },
    { id: 'custom-dark', type: 'node' as const, text: '深色节点', x: 240, y: 30, width: 180, height: 80, fillColor: '#101010' },
    { id: 'custom-light', type: 'node' as const, text: '浅色节点', x: 450, y: 30, width: 180, height: 80, fillColor: '#ffffff' },
  ] }
  const before = serializeCanvasScene(scene)
  const svg = canvasSceneToSvg(scene)
  assert.match(svg, /fill="#243247">主入口<\/text>/)
  assert.match(svg, /fill="#f8fafc">深色节点<\/text>/)
  assert.match(svg, /fill="#243247">浅色节点<\/text>/)
  assert.match(canvasSceneToSvg({ ...scene, style: undefined }), /fill="#f8fafc">深色节点<\/text>/)
  assert.equal(serializeCanvasScene(scene), before)
})
