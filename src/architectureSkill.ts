import type { ArchitectureTheme } from './architectureDesign.js'

export function isArchitectureIntent(value: string): boolean {
  return /(架构|拓扑|系统图|architecture|c4|topology|service map|system design)/i.test(value)
}

export function architectureDesignSkill(theme: ArchitectureTheme = 'enterprise'): string[] {
  return [
    `架构视觉主题：${theme}。`,
    architectureThemeRule(theme),
    '先选择构图原型，再放节点：端到端调用优先 backbone/linear，单源多依赖优先 fan-out，多源进入一个核心能力优先 convergence，中心平台连接多系统优先 hub-spoke，跨职责链路优先 layered/swimlane。不要默认把所有组件排成等权卡片矩阵。',
    '用户已明确要求企业系统、微服务、数据平台、AI Agent 或部署拓扑，且当前走语义自动生成流程时，传入对应 visualScenario；没有证据时省略，不得因 Kafka/Redis/对象存储等单项技术就臆测整套架构类型。visualScenario 仅表示语义表达场景，不是强制布局。参考图忠实重绘继续使用自由画布。',
    '先确定读者需要的单张视图：系统边界与入口、最多一条可追踪的主路径、必要的下游依赖。细节过多时使用总览与区域下钻，不需要为了汇报好看伪造关键组件或删除源关系。',
    'diagram.beautifyArchitecture 会根据真实节点角色与关系自动选择 layered、hub-spoke、event-driven、data-platform、agent-runtime、cloud-native 等架构骨架；不要为了迎合某个固定版式提前伪造分区或节点位置。只有用户已经手工锁定位置时才把 authored geometry 当作硬约束。',
    '把架构图当作视觉论证：首先让读者看见“系统边界 → 主业务路径 → 关键依赖/结果”，外围配置、管理面和低频依赖降到第二层级；留白用于区分职责和系统边界。',
    '先表达系统边界和职责层次，再表达细节；不要把所有节点平铺成一层。',
    '优先区分外部参与方、体验/入口、核心应用、后台处理/异步、数据/检索等局部区域；这些区域默认表现为紧贴内容的 boundary/group，不要自动拉成贯穿整张画布的泳道。只有用户明确要求 swimlane 时才使用 lane。',
    '节点必须尽量填写真实 role(icon) 和已确认的 technology stencil；不要用装饰性图标冒充未知技术。',
    '颜色只表达架构语义：入口/关键交互、处理/异步、数据/存储、外部依赖应能快速区分；避免彩虹式逐节点随机配色。',
    '图必须有视觉主次：主业务/主数据链路使用 primary，直接相关依赖使用 secondary，配置性或外围关系弱化为 muted；不要让所有线和节点具有相同视觉权重。',
    '边界只表达真实且有价值的运行/职责分组：默认使用紧贴内容的局部 boundary/group，不强制自动生成包住整张图的 Software System 外框。用户或源码已明确给出 Software System / Container / Domain 边界时原样保留其层级；外部参与方和第三方系统保持在对应内部边界之外。',
    '布局先找主调用 backbone，再把处理、异步、数据等依赖作为局部 cluster/satellite 摆放；主阅读方向优先左→右，但允许处理层和数据层自然落在主链下方或右下方，不按五个固定纵向列强行排布。',
    '依赖关系优先正交路由；并行关系错开 routing channel，异步消息链使用 dashed；减少穿过节点和多条线完全重叠。',
    '同一节点扇出到多个同层目标时允许共享一段关系 trunk 再分叉，形成 bundle/汇聚，而不是每条线从节点边缘独立炸开。',
    '关系线视觉权重应低于节点和边界：主链细而清晰，次要关系更淡，异步 dashed；关系标签只写协议、动作或关键语义，默认不使用胶囊底，不重复节点名称。',
    '图上文字保持短：节点标题表达职责，subtitle 表达技术/协议；长解释放 description，不把段落塞进节点。',
    'presentation 主题仍保持工程架构画布形态，不生成 Dashboard 式大标题带/图例。标题和分区标签保持轻量，画布尺寸由内容决定。',
    '当图超过约 20 个节点时优先使用 density=auto，让插件自动从 comfortable 切到 compact/dense；不要靠缩小字体硬塞节点。',
    '大型架构图需要先给 overview，再按需要切 detail：overview 只隐藏低优先级显示项，不删除节点数据，并保留主链路、直接依赖和每个区域的代表节点。',
    '40 个节点以上优先建立稳定的职责/部署/运行边界和分组，使 Diagram 可以按区域下钻；不要生成 100+ 个无层级平铺节点，也不要用大泳道掩盖复杂度。只有明确 C4 请求才把这些边界编码为 Software System / Container。',
    '普通 Boundary/Domain 边界必须对应真实职责、部署或运行边界；节点 Focus 由插件按 1~3 跳邻域完成，不要为了局部视图复制节点。',
    '节点使用紧凑工程图元而不是统一大卡片：Person/External、Gateway、Service/Worker、Queue、Database/Cache/Search/Vector/Storage 使用各自的 role glyph；已确认技术用 stencil 图形作为主要识别符。不要再额外显示 ACTOR/RUNTIME/DATA/Container 等模板 metadata。',
    '证据优先：sourcePaths、stencil、协议/事件标签、C4 类型只填写已经从代码、配置或用户输入确认的事实；未知技术保持中性角色，不为了“专业感”猜具体产品。',
    '完成语义内容后调用 diagram.beautifyArchitecture，让插件统一执行分区、配色、图标补全、布局和连线整理。',
    '如果节点位置和分区已经合适，只需要减少交叉/穿节点/叠线，则调用 diagram.routeArchitectureEdges，不要重新布局整张图。',
    '完成写回和美化后调用 diagram.inspectQuality 做一次质量回检；若 needsRevision=true，只修复报告出的重叠、穿节点、交叉过多、层级过平或标签过长问题，再回检一次，不做无关重写。',
    '语义自动架构生成返回 visualPlan 时，核对 scenario、primaryNodeIds、regions、recommendedView 和 review.repairTargets；按明确的 elementIds 进行最多一次定向修复与复核，不要为了消除一条穿区线而制造更多交叉。这些只是几何证据与视觉审查提示，绝不是已经通过人工审美验收。',
  ]
}

function architectureThemeRule(theme: ArchitectureTheme): string {
  if (theme === 'cloud') return 'cloud 主题强调云原生组件和技术 Logo，分组使用轻量边界与柔和蓝色材质；不要把每个服务重新包成厚重卡片。'
  if (theme === 'technical') return 'technical 主题采用单色蓝图/高密线路语言：无卡片底、细虚线边界、小号技术标识和 monospace 辅助信息，优先扫描效率，并与 enterprise 的语义色工程图明显区分。'
  if (theme === 'presentation') return 'presentation 主题用于汇报：保留真实架构关系，但降低次要依赖视觉权重，减少节点细节，让主链和关键区域先被读到。'
  if (theme === 'editorial') return 'editorial 主题强调留白、排版尺度和 Logo/名称本身，尽量取消卡片底板和重边界，用空间关系形成层级。'
  if (theme === 'sketch') return 'sketch 主题用于讨论草图：边界和关系使用轻量虚线/白板语法，但仍保持正交关系与真实节点语义，不制造手绘装饰噪声。'
  return 'enterprise 主题采用专业工程蓝图语言：Logo/role glyph 主导、局部边界紧贴内容、主链清楚、辅助关系克制。'
}
