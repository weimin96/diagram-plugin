export type MermaidDiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'er'
  | 'state'
  | 'mindmap'
  | 'gantt'
  | 'timeline'
  | 'gitgraph'
  | 'journey'
  | 'quadrant'
  | 'kanban'
  | 'requirement'
  | 'sankey'
  | 'xychart'
  | 'pie'
  | 'radar'
  | 'treemap'
  | 'ishikawa'
export type DiagramType = MermaidDiagramType | 'canvas'
export type DiagramCanvasWorkbench = 'architecture' | 'flowchart' | 'freeform'
export type DiagramSurface = 'workspace' | 'thread'
export type DiagramCategory = 'canvas' | 'core' | 'analysis' | 'data' | 'special'

export interface DiagramTypeOption {
  type: DiagramType
  label: string
  category: DiagramCategory
}

export interface DiagramSummary {
  path: string
  name: string
  type: DiagramType | 'unknown'
  modifiedAt: string
  canvasWorkbench?: DiagramCanvasWorkbench
}

export interface DiagramDocument extends DiagramSummary {
  source: string
}

export interface DiagramRevision {
  path: string
  modifiedAt: string
}

export interface WorkspaceSnapshot {
  kind: 'workspace'
  surface?: DiagramSurface
  workspacePath?: string
  recentWorkspaces: string[]
  diagrams: DiagramSummary[]
  activeDiagramPath?: string
  threadDiagramPaths?: string[]
}

export const mermaidDiagramTypes: Array<DiagramTypeOption & { type: MermaidDiagramType }> = [
  { type: 'flowchart', label: '流程图', category: 'core' },
  { type: 'sequence', label: '时序图', category: 'core' },
  { type: 'mindmap', label: '思维脑图', category: 'core' },
  { type: 'class', label: '类图', category: 'core' },
  { type: 'er', label: 'ER 图', category: 'core' },
  { type: 'state', label: '状态图', category: 'core' },
  { type: 'gantt', label: '甘特图', category: 'core' },
  { type: 'timeline', label: '时间线', category: 'core' },
  { type: 'kanban', label: '看板', category: 'analysis' },
  { type: 'requirement', label: '需求关系图', category: 'analysis' },
  { type: 'gitgraph', label: 'Git 分支图', category: 'analysis' },
  { type: 'journey', label: '用户旅程', category: 'analysis' },
  { type: 'quadrant', label: '四象限图', category: 'analysis' },
  { type: 'sankey', label: '桑基图', category: 'data' },
  { type: 'xychart', label: 'XY 图表', category: 'data' },
  { type: 'pie', label: '饼图', category: 'data' },
  { type: 'radar', label: '雷达图', category: 'data' },
  { type: 'treemap', label: '矩形树图', category: 'data' },
  { type: 'ishikawa', label: '鱼骨图', category: 'special' },
]

export const diagramTypes: DiagramTypeOption[] = [
  { type: 'canvas', label: '自由画布', category: 'canvas' },
  ...mermaidDiagramTypes,
]

const categoryLabels: Record<DiagramCategory, string> = {
  canvas: '自由画布与架构',
  core: '核心结构图',
  analysis: '分析与规划',
  data: '数据可视化',
  special: '专业分析',
}

export const diagramTypeGroups: Array<{ category: DiagramCategory; label: string; items: DiagramTypeOption[] }> = (
  ['canvas', 'core', 'analysis', 'data', 'special'] as DiagramCategory[]
).map((category) => ({
  category,
  label: categoryLabels[category],
  items: diagramTypes.filter((item) => item.category === category),
})).filter((group) => group.items.length > 0)

const mermaidTypeSet = new Set<MermaidDiagramType>(mermaidDiagramTypes.map((item) => item.type))

export function isMermaidDiagramType(value: string): value is MermaidDiagramType {
  return mermaidTypeSet.has(value as MermaidDiagramType)
}
