import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { architectureCases } from '../tests/fixtures/architecture/cases.js'
import { composeArchitectureGraph } from '../src/architectureComposer.js'
import { canvasSceneToSvg, serializeCanvasScene } from '../src/canvas.js'

/** Expert review template: none of the boxes are pre-checked or AI-scored. */
const humanChecklist = [
  '架构实体、边界和依赖方向有明确事实依据',
  '五秒内能够定位入口、关键链路和下游',
  '场景专用阅读方向与系统运行逻辑一致',
  '主次层级、留白、图元及字号适合正式文档',
  '跨区连线不干扰主要业务信息',
  'Canvas 可编辑，SVG 在目标尺寸下清晰可读',
]
const ids = ['business-platform', 'microservices', 'data-platform']
const output = path.resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6)
  ?? 'test-results/architecture-design-review')
await mkdir(output, { recursive: true })
const cases = []
for (const id of ids) {
  const sample = architectureCases.find((item) => item.id === id)!
  const started = performance.now()
  const result = composeArchitectureGraph(sample.intent)
  const file = `${id}.svg`
  await writeFile(path.join(output, file), canvasSceneToSvg(result.scene))
  await writeFile(path.join(output, `${id}.diagram.json`), serializeCanvasScene(result.scene))
  cases.push({
    id,
    label: result.visualPlan.reference.label,
    scenario: result.visualPlan.scenario,
    readingPattern: result.visualPlan.reference.readingPattern,
    priorities: result.visualPlan.reference.priorities,
    antiPatterns: result.visualPlan.reference.antiPatterns,
    recommendedView: result.visualPlan.recommendedView,
    primaryNodeIds: result.visualPlan.primaryNodeIds,
    concerns: result.visualPlan.review.concerns,
    readyForVisualReview: result.visualPlan.review.readyForVisualReview,
    presentation: result.presentation,
    quality: result.quality.metrics,
    elapsedMs: Math.round(performance.now() - started),
    svg: file,
  })
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  version: 1, source: 'fictional-reference', rubric: humanChecklist,
  note: 'Human visual quality is not automatically scored. All checkboxes are intentionally empty.',
  cases,
}, null, 2) + '\n')
const markdown = ['# 专业架构图视觉验收',
  '这三类案例均为虚构系统。结构检测自动完成，以下视觉评价必须由人实际查看后勾选。',
  ...cases.flatMap((item) => [
    `## ${item.label}`,
    `阅读路径：${item.readingPattern}`,
    `![${item.label}](./${item.svg})`,
    `自动几何：交叉 ${item.quality.edgeCrossings} / 重叠 ${item.quality.edgeOverlaps} / 穿节点 ${item.quality.edgeNodeIntersections}`,
    `1200px 适配字号：${item.presentation.estimatedTitlePxAtFit}px；建议初始视图：${item.recommendedView}`,
    '专业构图重点：',
    ...item.priorities.map((s) => `- ${s}`),
    '需要避免：',
    ...item.antiPatterns.map((s) => `- ${s}`),
    '人工检查：',
    ...humanChecklist.map((s) => `- [ ] ${s}`),
    '待修正问题：',
    '',
  ]),
].join('\n\n')
await writeFile(path.join(output, 'review.md'), markdown + '\n')
console.table(cases.map((item) => ({
  scenario: item.scenario, mainNodes: item.primaryNodeIds.length,
  crossings: item.quality.edgeCrossings, overlaps: item.quality.edgeOverlaps,
  fitFont: item.presentation.estimatedTitlePxAtFit, ms: item.elapsedMs,
})))
console.log(`Review report: ${path.join(output, 'review.md')}`)
if (cases.some((item) => !item.readyForVisualReview)) {
  console.error('Hard geometry errors remain. Human visual sign-off is blocked.')
  process.exitCode = 1
}
