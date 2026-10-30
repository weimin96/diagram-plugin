import type { MermaidDiagramType } from '../types.js'
import type { DiagramSkill } from './types.js'
import { flowchartSkill } from './flowchart.js'
import { sequenceSkill } from './sequence.js'
import { erSkill } from './er.js'
import { stateSkill } from './state.js'
import { mindmapSkill } from './mindmap.js'
import { supplementalSkills } from './supplemental.js'
import { extendedSkills } from './extended.js'

const skills = new Map<MermaidDiagramType, DiagramSkill>([
  flowchartSkill,
  sequenceSkill,
  erSkill,
  stateSkill,
  mindmapSkill,
  ...supplementalSkills,
  ...extendedSkills,
].map((item) => [item.type, item]))

export function diagramSkill(type: MermaidDiagramType): DiagramSkill {
  const skill = skills.get(type)
  if (!skill) throw new Error(`Missing Diagram Skill for ${type}`)
  return skill
}

export function allDiagramSkills(): DiagramSkill[] {
  return [...skills.values()]
}

export function diagramIntentRoutingGuide(): string[] {
  return [
    '类型路由：流程/审批/决策链 → flowchart；调用顺序/API/MQ 交互 → sequence；数据实体/表关系 → er；生命周期 → state；知识拆解 → mindmap。',
    '静态软件系统/模块/服务边界不要退化成 flowchart，应使用 Canvas Architecture/C4。',
    '用户只说画架构图但没有指定视觉表达方式时，必须先询问：国内企业方案风格（分层分区、功能模块）还是国际工程架构风格（C4/真实依赖）？不要默认为任意一种，也不要根据项目是政企或使用何种技术推断用户偏好。明确选择后再调用生成工具。',
    '计划排期 → gantt；历史里程碑 → timeline；代码分支合并 → gitgraph；用户触点体验 → journey；二维优先级/定位 → quadrant。',
    '任务状态看板 → kanban；需求到实现/验证追踪 → requirement；可加总流量去向 → sankey；趋势/柱线指标 → xychart；单一总体占比 → pie；同尺度多维评分 → radar；层级面积构成 → treemap；根因分析 → ishikawa。',
    '数据可视化类型必须建立在真实数据或用户明确给出的示意数据上；没有数量依据时不要为了图形丰富度编造数值。',
  ]
}
