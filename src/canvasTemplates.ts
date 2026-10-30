import {
  CANVAS_DOCUMENT_TYPE,
  serializeCanvasScene,
  type CanvasArrow,
  type CanvasIcon,
  type CanvasScene,
  type CanvasTone,
} from './canvas.js'

export type CanvasTemplateId = 'layered' | 'cards'

export interface CanvasTemplateChoice {
  id: CanvasTemplateId
  label: string
  detail: string
}

export const canvasTemplateChoices: readonly CanvasTemplateChoice[] = [
  { id: 'layered', label: '分层架构', detail: '左侧层名 · 每层独立底色 · 主流程贯穿' },
  { id: 'cards', label: '卡片架构', detail: '分区画布 · 白色卡片 · 方案总览' },
]

export interface LayeredTemplateNode {
  text: string
  subtitle?: string
  icon?: CanvasIcon
  tone?: CanvasTone
  width?: number
  height?: number
}

export interface LayeredTemplateLayer {
  label: string
  fillColor: string
  tone?: CanvasTone
  nodes: readonly LayeredTemplateNode[]
}

export interface LayeredTemplateLink {
  from: readonly [number, number]
  to: readonly [number, number]
  label?: string
}

export interface LayeredTemplateSpec {
  width?: number
  height?: number
  layers: readonly LayeredTemplateLayer[]
  links?: readonly LayeredTemplateLink[]
}

export interface CardTemplateCard {
  text: string
  subtitle?: string
  icon?: CanvasIcon
  tone?: CanvasTone
}

export interface CardTemplateGroup {
  label: string
  fillColor: string
  tone?: CanvasTone
  x: number
  y: number
  width: number
  height: number
  columns: number
  cards: readonly CardTemplateCard[]
}

export interface CardsTemplateSpec {
  width?: number
  height?: number
  groups: readonly CardTemplateGroup[]
}

const LAYER_TOP = 86
const LAYER_HEIGHT = 152
const LAYER_GAP = 38
const NODE_HEIGHT = 96
const NODE_WIDTH = 252
const NODE_GAP = 30
const CONTENT_LEFT = 210

function layeredNodeId(layerIndex: number, nodeIndex: number): string {
  return `layer-${layerIndex + 1}-${nodeIndex + 1}`
}

export function buildLayeredTemplateScene(title: string, spec: LayeredTemplateSpec): CanvasScene {
  const width = spec.width ?? 1500
  const height = spec.height ?? Math.max(720, LAYER_TOP + spec.layers.length * (LAYER_HEIGHT + LAYER_GAP))
  const elements: CanvasScene['elements'] = []
  const groups: NonNullable<CanvasScene['groups']> = []

  spec.layers.forEach((layer, layerIndex) => {
    const groupId = `layer-${layerIndex + 1}`
    const y = LAYER_TOP + layerIndex * (LAYER_HEIGHT + LAYER_GAP)
    groups.push({
      id: groupId,
      label: layer.label,
      tone: layer.tone ?? 'muted',
      fillColor: layer.fillColor,
      labelSide: 'left',
    })
    let cursorX = CONTENT_LEFT
    layer.nodes.forEach((node, nodeIndex) => {
      const nodeWidth = node.width ?? [330, 270, 240, 280][Math.min(nodeIndex, 3)]
      const nodeHeight = node.height ?? [104, 100, 96, 92][Math.min(nodeIndex, 3)]
      elements.push({
        id: layeredNodeId(layerIndex, nodeIndex),
        type: 'node',
        x: cursorX,
        y: y + (LAYER_HEIGHT - nodeHeight) / 2,
        width: nodeWidth,
        height: nodeHeight,
        text: node.text,
        ...(node.subtitle ? { subtitle: node.subtitle } : {}),
        ...(node.icon ? { icon: node.icon } : {}),
        tone: node.tone ?? 'default',
        shape: 'rounded',
        fillColor: '#ffffff',
        strokeColor: '#cfd8e3',
        groupId,
      })
      cursorX += nodeWidth + NODE_GAP
    })
  })

  const arrows: CanvasArrow[] = (spec.links ?? []).map((link, index) => ({
    id: `flow-${index + 1}`,
    type: 'arrow',
    from: layeredNodeId(link.from[0], link.from[1]),
    to: layeredNodeId(link.to[0], link.to[1]),
    ...(link.label ? { label: link.label } : {}),
    lineStyle: 'solid',
    routing: 'orthogonal',
    markerEnd: 'arrow',
    emphasis: 'primary',
  }))

  return {
    type: CANVAS_DOCUMENT_TYPE,
    version: 1,
    title: title.trim() || '分层架构',
    width,
    height,
    workbench: 'architecture',
    background: 'transparent',
    architecture: { theme: 'enterprise', view: 'detail', density: 'comfortable', scenario: 'enterprise-system' },
    groups,
    elements: [...elements, ...arrows],
  }
}

const CARD_HEIGHT = 84
const CARD_GAP_X = 16
const CARD_GAP_Y = 14
const CARD_PADDING = 20
const CARD_TITLE_HEIGHT = 34

export function buildCardsTemplateScene(title: string, spec: CardsTemplateSpec): CanvasScene {
  const width = spec.width ?? 1500
  const height = spec.height ?? 980
  const elements: CanvasScene['elements'] = []
  const groups: NonNullable<CanvasScene['groups']> = []

  spec.groups.forEach((group, groupIndex) => {
    const groupId = `card-group-${groupIndex + 1}`
    groups.push({
      id: groupId,
      label: group.label,
      tone: group.tone ?? 'muted',
      fillColor: group.fillColor,
      labelSide: 'inside',
    })
    const columns = Math.max(1, group.columns)
    const cardWidth = (group.width - CARD_PADDING * 2 - CARD_GAP_X * (columns - 1)) / columns
    group.cards.forEach((card, cardIndex) => {
      const row = Math.floor(cardIndex / columns)
      const column = cardIndex % columns
      elements.push({
        id: `${groupId}-card-${cardIndex + 1}`,
        type: 'node',
        x: group.x + CARD_PADDING + column * (cardWidth + CARD_GAP_X),
        y: group.y + CARD_TITLE_HEIGHT + CARD_PADDING + row * (CARD_HEIGHT + CARD_GAP_Y),
        width: cardWidth,
        height: CARD_HEIGHT,
        text: card.text,
        ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        ...(card.icon ? { icon: card.icon } : {}),
        tone: card.tone ?? 'default',
        shape: 'rounded',
        fillColor: '#ffffff',
        strokeColor: '#cfd8e3',
        groupId,
      })
    })
  })

  return {
    type: CANVAS_DOCUMENT_TYPE,
    version: 1,
    title: title.trim() || '卡片架构',
    width,
    height,
    workbench: 'architecture',
    background: 'transparent',
    architecture: { theme: 'enterprise', view: 'detail', density: 'comfortable', scenario: 'enterprise-system' },
    groups,
    elements,
  }
}

const genericLayers: readonly LayeredTemplateLayer[] = [
  {
    label: '接入层',
    fillColor: '#fde8ea',
    nodes: [
      { text: 'Web 入口', subtitle: '用户界面', icon: 'web' },
      { text: '开放 API', subtitle: '外部系统', icon: 'api' },
      { text: '文件接入', subtitle: '批量导入', icon: 'file' },
      { text: '消息接入', subtitle: '事件与回调', icon: 'queue' },
    ],
  },
  {
    label: '接口层',
    fillColor: '#e8f1fb',
    nodes: [
      { text: 'REST / SSE', subtitle: '同步与流式', icon: 'gateway' },
      { text: 'MCP 网关', subtitle: '工具与模型', icon: 'mcp' },
      { text: '认证与授权', subtitle: '身份与权限', icon: 'auth' },
      { text: '审计与限流', subtitle: '访问控制', icon: 'service' },
    ],
  },
  {
    label: '业务模块层',
    fillColor: '#fff5d9',
    nodes: [
      { text: '核心业务', subtitle: '领域服务', icon: 'service' },
      { text: '查询服务', subtitle: '检索与聚合', icon: 'search' },
      { text: '任务调度', subtitle: '异步编排', icon: 'scheduler' },
      { text: '内容管理', subtitle: '版本与发布', icon: 'file' },
    ],
  },
  {
    label: '运行服务层',
    fillColor: '#ede7fb',
    nodes: [
      { text: 'Agent 运行时', subtitle: '会话与工具', icon: 'ai' },
      { text: '协作服务', subtitle: '实时协同', icon: 'service' },
      { text: '文档服务', subtitle: '在线编辑', icon: 'file' },
    ],
  },
  {
    label: '数据层',
    fillColor: '#e6f5e9',
    nodes: [
      { text: '关系数据库', subtitle: '业务权威', icon: 'database' },
      { text: '缓存', subtitle: '会话与队列', icon: 'cache' },
      { text: '对象存储', subtitle: '原始文件', icon: 'file' },
      { text: '检索索引', subtitle: '全文与向量', icon: 'search' },
    ],
  },
]

const genericLayeredLinks: readonly LayeredTemplateLink[] = [
  { from: [0, 0], to: [1, 0] },
  { from: [1, 0], to: [2, 0] },
  { from: [2, 0], to: [3, 0] },
  { from: [3, 0], to: [4, 0] },
]

const genericCards: readonly CardTemplateGroup[] = [
  {
    label: '非结构化文档输入',
    fillColor: '#eaf6e9',
    x: 30,
    y: 70,
    width: 300,
    height: 330,
    columns: 1,
    cards: [
      { text: 'PDF / Word', subtitle: '制度与手册', icon: 'file' },
      { text: '扫描件', subtitle: 'OCR 识别', icon: 'file' },
      { text: '网页与 Markdown', subtitle: '知识沉淀', icon: 'web' },
    ],
  },
  {
    label: '核心系统',
    fillColor: '#e8f1fb',
    x: 360,
    y: 70,
    width: 540,
    height: 520,
    columns: 2,
    cards: [
      { text: '文档解析', subtitle: '结构化抽取', icon: 'service' },
      { text: '文本切片', subtitle: '分块策略', icon: 'service' },
      { text: '向量化', subtitle: 'Embedding', icon: 'ai' },
      { text: '检索与重排', subtitle: '召回与排序', icon: 'search' },
      { text: '知识图谱', subtitle: '实体与关系', icon: 'search' },
      { text: '权限过滤', subtitle: '按角色可见', icon: 'auth' },
    ],
  },
  {
    label: '离线大模型部署',
    fillColor: '#f0e9fb',
    x: 930,
    y: 70,
    width: 250,
    height: 330,
    columns: 1,
    cards: [
      { text: '本地模型', subtitle: '私有化推理', icon: 'ai' },
      { text: '模型路由', subtitle: '能力选择', icon: 'ai' },
      { text: 'GPU 资源', subtitle: '算力池', icon: 'cloud' },
    ],
  },
  {
    label: '知识平台',
    fillColor: '#e8f1fb',
    x: 1210,
    y: 70,
    width: 260,
    height: 520,
    columns: 1,
    cards: [
      { text: '知识库', subtitle: '分类与标签', icon: 'file' },
      { text: '工作流', subtitle: '编排与发布', icon: 'scheduler' },
      { text: 'Agent', subtitle: '工具与技能', icon: 'ai' },
      { text: '开放 API', subtitle: '系统集成', icon: 'api' },
    ],
  },
  {
    label: '核心问题：知识库碎片化',
    fillColor: '#fff4e5',
    x: 360,
    y: 620,
    width: 540,
    height: 260,
    columns: 1,
    cards: [
      { text: '数据孤岛', subtitle: '多个系统各自维护', icon: 'external' },
      { text: '口径不一', subtitle: '同一问题多个答案', icon: 'external' },
    ],
  },
  {
    label: '用户交互层',
    fillColor: '#eaf6e9',
    x: 930,
    y: 620,
    width: 540,
    height: 260,
    columns: 2,
    cards: [
      { text: 'Web 门户', subtitle: '统一入口', icon: 'web' },
      { text: '智能问答', subtitle: '有据可查', icon: 'ai' },
      { text: 'API / SDK', subtitle: '业务嵌入', icon: 'api' },
      { text: 'Agent 应用', subtitle: '任务自动化', icon: 'ai' },
    ],
  },
]

export function createCanvasTemplateScene(title: string, template: CanvasTemplateId): CanvasScene {
  if (template === 'layered') {
    return buildLayeredTemplateScene(title, { layers: genericLayers, links: genericLayeredLinks })
  }
  return buildCardsTemplateScene(title, { groups: genericCards })
}

export function createCanvasTemplateSource(title: string, template: CanvasTemplateId): string {
  return serializeCanvasScene(createCanvasTemplateScene(title, template))
}
