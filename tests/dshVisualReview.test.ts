import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { parseDshPixelAssessment } from '../scripts/dsh-visual-review.js'
import { architectureVisualCriteria, evaluateArchitectureVisualReview, type ArchitectureVisualRatings } from '../src/architectureVisualReview.js'

const cwd = '/tmp/diagram-dsh-visual-example'
const ratings = Object.fromEntries(Object.keys(architectureVisualCriteria).map((name) =>
  [name, { score: 2.5, evidence: '实际截图中节点文本基本可辨认，但长线路交错影响整体阅读。' }]))
const assessment = {
  ratings, summary: '这是独立读取实际截图后完成的架构图视觉评分。',
  issues: [{ observation: '可以看到多条依赖线在中央重叠。', suggestedFix: '优先优化中央共享线路走廊和端口。' }],
}
const events = (
  override: {
    tool?: string
    file_path?: string
    status?: string
    result?: string
    final?: string
    extra?: unknown[]
  } = {},
) => [
  { type: 'session', cwd },
  { type: 'tool_call', callId: 'read-1', tool: override.tool ?? 'read_image',
    input: { file_path: override.file_path ?? './anonymous.png' } },
  { type: 'tool_result', callId: 'read-1', status: override.status ?? 'completed',
    result: override.result ?? '<path>/private/tmp/diagram-dsh-visual-example/anonymous.png</path>\n<type>image</type>\n<content>\nimage/png image, 1280x960 px, 62000 bytes\n</content>' },
  ...(override.extra ?? []),
  { type: 'final', text: override.final ?? JSON.stringify(assessment) },
].map((item) => JSON.stringify(item)).join('\n') + '\n'

test('accepts genuine matching read_image success and single JSON rating payload', () => {
  const parsed = parseDshPixelAssessment(events(), cwd)
  assert.equal(parsed.ratings.traceability.score, 2.5)
  assert.equal(parsed.issues.length, 1)
  const sha = 'a'.repeat(64)
  const result = evaluateArchitectureVisualReview({
    id: 'diagram-example', screenshotSha256: sha, canvasSha256: sha,
    svgSha256: sha, readyForVisualReview: true,
  }, {
    id: 'diagram-example', screenshotSha256: sha, canvasSha256: sha, svgSha256: sha,
    reviewer: 'DeepSeek Harness headless read_image reviewer', reviewMode: 'independent-vision',
    approval: 'pending', ratings: parsed.ratings as ArchitectureVisualRatings, summary: parsed.summary,
    issues: parsed.issues.map((issue) => ({ ...issue, elementIds: [] })),
  }, new Set()).perceptualScore
  assert.equal(result, 50)
})

test('validates the exact screenshot path, including macOS /private/tmp alias', () => {
  assert.ok(parseDshPixelAssessment(events({ file_path: path.join(cwd, 'anonymous.png') }), cwd))
  assert.ok(parseDshPixelAssessment(events({ file_path: '/private/tmp/diagram-dsh-visual-example/anonymous.png' }), cwd))
  for (const wrong of ['./older.png', '../anonymous.png', '/tmp/other/anonymous.png']) {
    assert.throws(() => parseDshPixelAssessment(events({ file_path: wrong }), cwd),
      /isolated current screenshot/)
  }
})

test('rejects models claiming to have seen pixels without a completed image tool result', () => {
  assert.throws(() => parseDshPixelAssessment(events({ status: 'error',
    result: 'Error: cannot read anonymous.png: not found' }), cwd), /no successful image-pixel/)
  assert.throws(() => parseDshPixelAssessment(events({ result: 'Loaded file. Looks fine.' }), cwd),
    /no successful image-pixel/)
  assert.throws(() => parseDshPixelAssessment(events({ result: '<type>image</type>' }), cwd),
    /no successful image-pixel/)
  assert.throws(() => parseDshPixelAssessment(events({ tool: 'read_text' }), cwd), /exactly one read_image/)
  assert.throws(() => parseDshPixelAssessment(events({ extra: [
    { type: 'tool_call', callId: 'x', tool: 'exec_command', input: { command: 'cat source' } },
  ] }), cwd), /exactly one read_image/)
})

test('rejects prose, missing final event and malformed event stream', () => {
  assert.throws(() => parseDshPixelAssessment(events({ final: 'I think this picture scores 95!' }), cwd),
    /valid JSON/)
  assert.throws(() => parseDshPixelAssessment(events({ final: JSON.stringify({ ratings: {} }) }), cwd),
    /rating contract/)
  assert.throws(() => parseDshPixelAssessment('{"type":"tool_call"\n', cwd), /valid JSONL/)
  assert.throws(() => parseDshPixelAssessment(events().replace('"type":"final"', '"type":"text"'), cwd),
    /one final image review/)
})
