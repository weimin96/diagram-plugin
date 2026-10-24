import { diagramVisualStyleGuide } from './diagramVisualStyles.js'
import { isMermaidDiagramType, type DiagramDocument, type DiagramType } from './types.js'
import type { CanvasWorkbenchMode } from './canvas.js'
import { architectureDesignSkill, isArchitectureIntent } from './architectureSkill.js'
import { diagramIntentRoutingGuide, diagramSkill } from './diagramSkills/registry.js'
import { skillPromptLines } from './diagramSkills/types.js'

export interface DiagramGenerationRequest {
  type: DiagramType
  canvasWorkbench?: CanvasWorkbenchMode
  title: string
  scope: string
  instructions: string
}

export function buildGenerationPrompt(workspacePath: string, request: DiagramGenerationRequest): string {
  const scope = request.scope.trim()
  const instructions = request.instructions.trim()
  if (request.type === 'canvas') {
    const architecture = request.canvasWorkbench === 'architecture' || (!request.canvasWorkbench && isArchitectureIntent(`${request.title} ${instructions}`))
    const workbench = request.canvasWorkbench ?? (architecture ? 'architecture' : 'freeform')
    const faithfulReference = /(参考(?:图片|图)|根据(?:图片|原图)|按原图|照原图|忠实复刻|还原原图|一比一|保持.{0,8}布局)/.test(`${request.title} ${instructions}`)
    if (architecture && !faithfulReference) {
      return [
        '为当前项目绘制一张专业且可编辑的系统架构图。先确定语义，再由 Diagram 引擎自动布局。',
        `工作空间：${workspacePath}`,
        `标题：${request.title.trim()}`,
        scope ? `优先分析范围：${scope}` : '优先分析对话中指定的模块/源码，未指定时定位最相关实现。',
        instructions ? `额外要求：${instructions}` : '',
        '',
        '执行要求：',
        '1. 阅读真实代码、配置或用户提供的资料，整理节点 id/text/职责/角色、sourcePaths 与已确认的依赖关系。仅在事实明确时填写 partition（功能区）；未知依赖和分区不要猜测。',
        '2. 调用 diagram.designGuide（type=canvas，intent=系统架构）选择构图方式；优先主业务路径、系统边界、关键依赖，避免等权矩阵和装饰性泳道。',
        '3. 只调用一次 diagram.composeArchitecture：传入 title、nodes、relations 和必要 theme；如果可以从真实有向依赖确认主要业务链路，按入口到结果填写 primaryPath，必须逐段对应已有关系，不要为凑主链造边。无需再额外创建文件或整图更新，也不要手动编写 x/y/width/height、line routing、重复颜色或整份 Canvas JSON。',
        '4. 由插件自动处理 layered、hub-spoke、event-driven 等架构布局、语义分区与正交连线，提供设计质量检查。节点标签使用短标题，技术栈只有确认后才使用 stencil。',
        '5. 读取返回的 quality（已经执行 diagram.inspectQuality 同级质量检查）。若存在问题，诚实说明缺少的事实或设计缺陷；不要为了过关发明跨域边或反复全量重画。',
        '6. 给用户图表路径和极简结果摘要，不输出冗长 JSON。',
      ].filter(Boolean).join('\n')
    }
    const workbenchRule = workbench === 'architecture'
      ? '画布默认 1600x1000。按从左到右或从上到下的主要阅读方向布置，节点不要明显重叠。普通系统架构默认用紧贴内容的 kind=boundary 命名容器，不主动添加 software-system/container C4 元数据；只有用户明确要求 C4，或源码/已有图明确存在 C4 层级时才使用 C4。技术组件只在事实明确时填写 stencil 和真实 sourcePaths。已确认的云组件应保持角色语义与云图标一致，例如 Lambda/Functions/Cloud Functions 使用 worker 角色、RDS/SQL Database/Cloud SQL 使用 database 角色。'
      : workbench === 'flowchart'
        ? '画布默认 1600x1000。按明确阅读方向组织流程；使用 flowchart:terminator 表示开始/结束、flowchart:process 表示处理、flowchart:decision 表示判断，并按真实语义使用 data/document/database/subprocess 等流程图元。开始/处理/决策/结束保持同一抽象粒度，跨角色流程可使用 lanes。不要主动添加 C4、架构 Boundary、技术 stencil 或云产品图标，除非它们本身就是流程语义的一部分。'
        : '画布默认 1600x1000。按用户意图组织空间关系和说明，可用 basic:rectangle/basic:rounded/basic:ellipse/basic:diamond/basic:triangle/basic:hexagon/basic:cloud 等基础图形；不强制套用架构分区、C4 或流程泳道，只有事实和任务需要时才添加技术语义。'
    return [
      '基于当前 项目工作空间生成一张 Diagram 自由画布，并写回 Diagram 插件。',
      `工作空间：${workspacePath}`,
      `标题：${request.title.trim()}`,
      scope
        ? `优先分析范围：${scope}`
        : '分析范围：优先使用当前对话里已经明确指向的代码或功能；如果没有明确对象，再从工作空间定位最相关实现。',
      instructions ? `额外要求：${instructions}` : '',
      '',
      '执行要求：',
      '1. 先阅读真正相关的代码、配置或数据结构，不要凭文件名臆测。',
      `2. 调用 diagram.create，type 使用 canvas，canvasWorkbench 使用 ${workbench}，创建 .diagram.json；再调用 diagram.get 获取模板并在其结构上修改。`,
      '3. 保持 type=diagram-plugin-canvas、version=1。elements 只使用 node、note、arrow。',
      '4. node/note 使用 id,type,x,y,width,height,text；可选 tone(default/accent/success/warning/danger/muted)、shape(rounded/square/pill，旧兼容)、shapeRef(basic:rectangle/basic:rounded/basic:ellipse/basic:diamond/basic:triangle/basic:hexagon/basic:cloud/flowchart:process/flowchart:decision/flowchart:terminator/flowchart:data/flowchart:document/flowchart:database/flowchart:subprocess/flowchart:manual-input/flowchart:preparation/flowchart:delay)、fillColor/strokeColor(#RRGGBB)、strokeWidth、opacity(0-1)、cornerRadius、rotation(-180~180 度)；note 需要作为独立文字时可设 textOnly=true，并可配 fontSize(8-96)、fontWeight(400/500/600/700)、textColor(#RRGGBB)。可选 icon(user/web/api/gateway/service/worker/database/cache/queue/search/vector/cloud/file/auth/ai/mcp/scheduler/external)、stencil(spring/react/vue/postgres/mysql/redis/kafka/rabbitmq/docker/kubernetes/qdrant/opensearch/elasticsearch/mongodb/minio/nginx/grpc/oidc/openai/mcp)、iconRef(role:... / simple:... / lucide:... / aws:... / azure:... / gcp:...)、c4Type(person/software-system/container/component)、subtitle、description、tags、locked、groupId、laneId、sourcePaths、emphasis(primary/secondary/muted)。shapeRef 是绘图几何语义；iconRef 只是视觉覆盖，不改变 icon/stencil 的语义。rotation 只在用户明确要求旋转或已有元素已经旋转时使用，不要为了装饰主动旋转架构节点。fill/stroke 等覆盖样式只在用户明确要求视觉样式或已有图需要保持时使用，不要默认给每个节点写死颜色。云厂商图标只有在代码、配置或用户输入已经确认对应云产品时才使用，不能用图标猜技术栈。除非用户明确指定视觉图标或当前图已经存在 iconRef，否则优先让插件按 icon/stencil 自动选图标。scene.groups 可配置 id,label,tone,kind(group/boundary),collapsed,parentId,c4Type(software-system/container),description，以 parentId 表达系统→容器的嵌套边界；scene.lanes 可配置 id,label,axis(horizontal/vertical),start,size,tone。arrow 使用 id,type=arrow,from,to，可选 label、lineStyle(solid/dashed/dotted)、routing(straight/orthogonal)、fromAnchor/toAnchor(auto/top/right/bottom/left)、points、labelPosition({x,y})、emphasis、markerEnd(none/arrow)、strokeColor、strokeWidth、opacity；from/to 必须引用现有 node/note id。手绘 freehand 是用户交互产物，AI 默认不要生成。labelPosition 属于用户手调标签位置，已有值应尽量保留；bundleKey 由插件理线器生成，不要手工编造。',
      '5. 只在视觉语义明确时使用 tone：主路径可 accent，成功/完成可 success，风险可 warning/danger，次要信息可 muted；不要把每个节点都染色。架构/流程图优先用 orthogonal 路由，简单关系可以 straight。',
      ...(!architecture ? diagramVisualStyleGuide() : []),
      `6. ${workbenchRule}`,
      '7. 初次新建图使用 diagram.update 写回完整 JSON；不要写 Mermaid 语法。完成后简要说明分析范围和图表路径。',
      ...(architecture ? ['', '内置 Architecture Diagram Skill：', ...architectureDesignSkill('enterprise'), ...diagramVisualStyleGuide()] : []),
    ].filter(Boolean).join('\n')
  }
  const skill = diagramSkill(request.type)
  return [
    '基于当前 项目工作空间生成一张 Mermaid 图表，并写回 Diagram 插件。',
    `工作空间：${workspacePath}`,
    `目标类型：${request.type}`,
    `标题：${request.title.trim()}`,
    scope
      ? `优先分析范围：${scope}`
      : '分析范围：优先使用当前对话里已经明确指向的代码或功能；如果没有明确对象，再从工作空间定位最相关实现。',
    instructions ? `额外要求：${instructions}` : '',
    '',
    '执行要求：',
    '1. 先阅读真正相关的代码、配置或数据结构，不要凭文件名臆测。',
    '2. 调用 diagram.create 创建目标图，再调用 diagram.update 写入完整 Mermaid 源码。',
    '3. 图表类型已经明确，不要擅自换成另一种 Mermaid 类型；如果发现用户目标明显更适合 Architecture Canvas，应在结果说明中指出，但仍完成当前请求。',
    '4. Mermaid 必须可渲染；完成后简要说明分析范围和生成的图表路径。',
    '',
    ...diagramIntentRoutingGuide(),
    '',
    ...skillPromptLines(skill, 'generation'),
  ].filter(Boolean).join('\n')
}

export function buildModificationPrompt(workspacePath: string, diagram: DiagramDocument, instruction: string): string {
  if (diagram.type === 'canvas') {
    return [
      '修改 Diagram 插件中当前选中的自由画布。',
      `工作空间：${workspacePath}`,
      `图表路径：${diagram.path}`,
      `修改要求：${instruction.trim()}`,
      '',
      '执行要求：',
      '1. 如果当前对话/选区已经给出稳定 element ids，先调用 diagram.getSubgraph 读取这些元素和直接邻域，不要为了局部修改加载整张大图；只有还不知道目标 ids 或任务确实涉及整图状态时才调用 diagram.get。需要代码事实时再阅读相关实现。',
      '2. 保留 diagram-plugin-canvas version 1 JSON 结构与现有 workbench（freeform/architecture/flowchart）；只操作 node、note、arrow 元素，除非用户明确要求切换画布类型。',
      '3. 保留现有节点的 tone/shape/shapeRef/fillColor/strokeColor/strokeWidth/opacity/cornerRadius/rotation/textOnly/fontSize/fontWeight/textColor/imagePath/imageFit/locked/groupId/laneId/icon/stencil/iconRef/subtitle/description/tags/sourcePaths/emphasis、scene.style、scene.groups/scene.lanes 以及连线 lineStyle/routing/anchors/points/labelPosition/emphasis/bundleKey/markerEnd/strokeColor/strokeWidth/opacity/freehand，除非修改要求明确涉及这些属性；不要重排 locked 元素。imagePath 是由插件导入图片后生成的稳定资源引用，AI 不得凭空构造、替换或指向工作区任意文件。',
      '4. 如果本次只涉及有限节点/关系，优先调用 diagram.proposeSubgraphPatch：elementIds 只放允许修改的已有 id，updates 只发送真正变化的字段，adds 只发送新增元素，removeIds 只发送删除项。不要把未变化的 x/y/width/height、arrow.points、labelPosition 重复发送。只有修改标题/画布尺寸/scene.style/Group/Lane 元数据或确实需要整图重构时才调用 diagram.proposeUpdate。',
      '5. shapeRef 用于绘图几何语义；icon 用于标明运行角色、stencil 用于标明真实技术栈、iconRef 只用于覆盖显示图标。修改 shapeRef 不应改写业务语义，修改 iconRef 时不要同步篡改 icon/stencil。普通架构图不要为了显得专业主动补 software-system/container/component C4 元数据；只有用户明确要求 C4，或当前图/源码已经明确存在 C4 层级时才保留或调整 C4。不要为了装饰给所有节点重复相同图标或技术标签。',
      '6. diagram.proposeSubgraphPatch 的 layout 默认 preserve；只有用户明确要求整理/重排当前局部结构时才用 local。服务端会保留未声明的人工布局和 Label，并自动计算受影响关系。不要把 Mermaid 语法写进自由画布文件。Proposal 不会直接覆盖文件，等待用户在右侧 Diagram 接受或拒绝。',
      '7. 默认只提交一个候选。只有用户明确要求多个方案、A/B 对比或备选实现时，才对同一 base revision 分别调用 diagram.proposeSubgraphPatch，并为每个候选设置不同 branchLabel（例如“保守方案”“重构方案”）；不要为了显得丰富自动制造分支。',
      '8. 如果用户随后明确要求把多个兼容候选合并，优先使用 diagram.composeProposalBranches 和 branchSet 中的 branch id，让服务端检查字段写冲突并生成新的组合候选；不要把互斥 A/B 方案自动合并，也不要自行用 last-write-wins 拼 Patch。',
    ].join('\n')
  }
  const skill = isMermaidDiagramType(diagram.type) ? diagramSkill(diagram.type) : undefined
  return [
    '修改 Diagram 插件中当前选中的 Mermaid 图表。',
    `工作空间：${workspacePath}`,
    `图表路径：${diagram.path}`,
    `当前类型：${diagram.type}`,
    `修改要求：${instruction.trim()}`,
    '',
    '执行要求：',
    '1. 先调用 diagram.get 读取最新内容；如修改依赖代码事实，再读取工作空间中的相关实现。',
    '2. 只更新这张图，除非用户明确要求新建另一张图。',
    '3. 生成完整 Mermaid 候选源码后调用 diagram.proposeUpdate，不要直接 diagram.update；保证候选语法可渲染。',
    '4. 不要为了显得完整增加与当前问题无关的节点或说明。diagram.proposeUpdate 不会写盘，等待用户在 Diagram 面板接受或拒绝。',
    ...(skill ? ['', ...skillPromptLines(skill, 'modification')] : []),
  ].join('\n')
}

export function buildSubgraphModificationPrompt(workspacePath: string, diagram: DiagramDocument, elementIds: string[], instruction: string): string {
  return [
    '只修改 Diagram 当前 Canvas 的指定子图，并提交可审查的增量 Patch Proposal。',
    `工作空间：${workspacePath}`,
    `图表路径：${diagram.path}`,
    `允许修改的现有元素：${JSON.stringify([...new Set(elementIds)])}`,
    `修改要求：${instruction.trim()}`,
    '',
    '执行要求：',
    '1. 先调用 diagram.getSubgraph，path 使用当前图表路径、elementIds 使用上面的稳定 id、depth 默认 0；只有明确需要更远依赖时才提高到 1～2。不要先读取完整 Canvas。返回值会区分 scopeNodeIds、directRelationshipIds、contextElementIds；contextElementIds 默认只读。需要代码事实时再读取相关源码。',
    '2. 调用 diagram.proposeSubgraphPatch，不要生成或传回完整 Canvas JSON。elementIds 默认使用上面的稳定 id；如果用户要求明确涉及这些节点的直接关系，可把 getSubgraph 返回的 directRelationshipIds 中相关关系一并加入 elementIds。不要仅因为看到了 contextElementIds 就扩大修改范围。',
    '3. updates 只写真正发生变化的字段；没有要移动节点时，不要写 x/y/width/height。没有要人工改线路时，不要写 arrow.points/labelPosition/bundleKey。null 只用于明确清除可选字段。',
    '4. 新增元素放在 adds 中并使用新的稳定 id。新增 node/note 可以省略 x/y，由服务端在当前子图附近寻找位置；当当前 scope 的 group/lane 唯一且明确时，服务端也会继承该上下文。新增 arrow 必须提供 from/to。删除已有元素放在 removeIds。',
    '5. layout 默认 preserve；只有用户明确要求当前子图重新布局/整理时才使用 local。服务端会计算关系重路由、删除节点的连带关系等自动影响，并在 Proposal 中单独显示。',
    '6. 不要直接调用 diagram.update，也不要优先使用旧的 diagram.proposeSubgraphUpdate。等待用户在右侧 Diagram 审查并接受/拒绝。',
    '7. 默认只提交一个候选。只有用户明确要求多个方案、A/B 对比或备选实现时，才在相同 base revision 上分别提交带不同 branchLabel 的 diagram.proposeSubgraphPatch，让右侧进行候选对比；不要自动生成无意义分支。',
    '8. 用户明确要求组合多个兼容候选时，使用 diagram.composeProposalBranches；冲突字段交给服务端拒绝，不要自行选择某个候选值覆盖另一个。',
  ].join('\n')
}
