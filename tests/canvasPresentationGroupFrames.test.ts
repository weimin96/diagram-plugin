import assert from 'node:assert/strict'
import test from 'node:test'
import { architectureCases } from './fixtures/architecture/cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { assessArchitectureRouteDiagnostics } from '../src/architectureRouteDiagnostics.js'
import { canvasGroupFrames, canvasPresentationGroupFrames, canvasSceneToSvg, serializeCanvasScene, type CanvasScene } from '../src/canvas.js'

test('generated architecture outlines are visually tighter without changing geometric obstacles or source JSON', () => {
  const scene = composeArchitectureGraph(architectureCases.find((c) => c.id === 'business-platform')!.intent).scene
  const before = serializeCanvasScene(scene)
  const physical = canvasGroupFrames(scene)
  const diagnosticBefore = assessArchitectureRouteDiagnostics(scene)
  const visual = canvasPresentationGroupFrames(scene, physical)
  assert.equal(visual.length, physical.length)
  const original = physical.find((frame) => frame.id === 'arch-processing')!
  const drawn = visual.find((frame) => frame.id === original.id)!
  assert.equal(drawn.y, original.y + 16)
  assert.equal(drawn.height, original.height - 36)
  assert.equal(drawn.width, original.width)
  assert.ok(physical.some((f) => f.id === original.id && f.y === original.y))
  assert.deepEqual(canvasGroupFrames(scene), physical)
  assert.deepEqual(assessArchitectureRouteDiagnostics(scene), diagnosticBefore)
  assert.equal(serializeCanvasScene(scene), before)
  const svg = canvasSceneToSvg(scene)
  assert.ok(svg.includes(`x="${drawn.x}" y="${drawn.y}" width="${drawn.width}" height="${drawn.height}"`))
})

test('freeform and C4, collapsed and authored groups preserve their exact presentation frames', () => {
  const scene: CanvasScene = {
    type: 'diagram-plugin-canvas', version: 1, title: 'Mixed groups',
    width: 900, height: 700,
    architecture: { theme: 'enterprise' },
    groups: [
      { id: 'arch-data', kind: 'boundary', label: 'auto' },
      { id: 'arch-processing', kind: 'boundary', collapsed: true, label: 'collapsed' },
      { id: 'arch-application', kind: 'boundary', c4Type: 'container', label: 'C4' },
      { id: 'custom', kind: 'group', label: 'manual' },
    ],
    elements: [
      { id: 'a', type: 'node', text: 'A', groupId: 'arch-data', x: 80, y: 110, width: 140, height: 80 },
      { id: 'b', type: 'node', text: 'B', groupId: 'arch-processing', x: 280, y: 110, width: 140, height: 80 },
      { id: 'c', type: 'node', text: 'C', groupId: 'arch-application', x: 480, y: 110, width: 140, height: 80 },
      { id: 'd', type: 'node', text: 'D', groupId: 'custom', x: 680, y: 110, width: 140, height: 80 },
    ],
  }
  const geometric = canvasGroupFrames(scene)
  const presentation = canvasPresentationGroupFrames(scene, geometric)
  assert.equal(presentation.find((f) => f.id === 'arch-data')!.height, geometric[0].height - 36)
  for (const id of ['arch-processing', 'arch-application', 'custom']) {
    assert.deepEqual(presentation.find((f) => f.id === id), geometric.find((f) => f.id === id))
  }
  assert.deepEqual(canvasPresentationGroupFrames({ ...scene, architecture: undefined }, geometric), geometric)
})
