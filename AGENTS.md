# Diagram Plugin 工程约束

适用于 Codex、DeepSeek Harness 和其他开发 Agent。以本仓库实际源码、当前需求与 `docs/development.md` 的可复验证据为准。该文档只保留**长期不变量与交付门禁**；开发日记和失败实验不能变成永久兼容规则。

## 产品与唯一权威

- 产品是对话驱动、可编辑、可保存、可重开的图表工作台，不是 SVG 图片生成器。Mermaid 保留原始 `.mmd` / `.mermaid`；Canvas 使用现有 `.diagram.json` 文档合同。
- 架构图以 `ArchitectureIntentGraph` 为真实语义输入：节点、真实方向的关系、经验证的分区、源码证据、用户明确声明的主路径。AI 不生成节点坐标、线路折点、虚构依赖或主路径。
- 生成的 Canvas 是正式可编辑产物。Canvas 编辑器与 SVG/PNG 导出共用 `canvas.ts` 几何、端口、箭头、节点标题排版和分区可见语义；不以隐藏节点、改变字体、假共享主干或缩小画布掩盖质量问题。
- 原始节点/关系 ID、方向、数量、已锁定的人工几何、Proposal Diff、revision、原子保存、历史撤销及已存在的文件版本不得被自动优化破坏。
- Codex、DSH Desktop/Web 只在 `src/hosts/`、`integrations/` 和打包入口适配宿主；共用同一服务、领域模型与编辑器。宿主身份、工作区和权限以真实会话为权威。
- `arch-*` 自动分区仅是语义边界，不是用户手工组合：选择其中一个节点必须只选择该节点，并可逐条定位真实入边/出边；用户明确创建的普通分组继续按原分组语义处理。

## 最终架构路线

**可信语义图 → 阅读/视图规划 → 节点、分区、端口与线路走廊的联合约束 → 完整候选评估 → 可编辑 Canvas → 真实 Chrome 像素审查 → 人工批准。**

当前模块职责：

- `architectureComposer.ts`：控制候选预算、最终整图采纳，不实现端口几何与绘图。
- `architectureDesign.ts`：语义场景、节点尺寸、分区及初始节点布置。人工或锁定坐标不能擅改。
- `architectureRouting.ts` + `architecturePortPlanning.ts`：基于真实端口容量与线段占用进行连线规划，只消费布局后的几何与真实关系。
- 拥挤入边的端口容量优化仅产生保真、正交的候选终端，必须由 Composer 在同一最终场景上检验交叉、重叠、穿节点、真实共享主干与路长后采纳；不能改变人工节点位置或制造假的关系端点。
- `architectureOrthogonalSolver.ts`：独立的矩形障碍、正交搜索和线路代价，不反向引用 Composer/UI、模型语义或主题。
- `architectureRouteRepair.ts`：在有边界预算内提出局部几何候选；不负责采纳。
- `canvasQuality.ts`、`architectureRouteDiagnostics.ts`、`architecturePresentationQuality.ts`、`architectureVisualPlan.ts`：共享最终可编辑场景的结构、路线、阅读质量与审查资格事实。
- `diagramQuality.ts`：Canvas 和 19 种 Mermaid 的统一质量报告**只负责汇总现有专业检查和浏览器测量**，不取代各类型语法、布局及质量规则。必须区分源码检查、可编辑几何检查、实际浏览器测量、独立感知评审和人工批准；未做的检查不得自动标为通过。
- `diagramGeometry.ts`：Canvas 与 Mermaid Chrome 测量复用相同的纯矩形几何；保持原有可编辑 Canvas 的接触/内缩阈值与浏览器的像素重叠阈值分别受控。`diagramQuality.repairSuggestions` 只能提出具有问题证据的整改方向，不自动改写源文档或宣称人工批准。
- `CanvasEditor.tsx`、`canvas.ts`：渲染与交互消费同一文档合同；任何阅读聚焦都是非破坏式的，不自动改写、丢弃或伪造真实关系。
- 密集且具有已验证关键关系的架构图默认以关键依赖层级阅读，`全部` 仍可随时显示所有真实关系；静态 SVG 只调整非重点线的视觉权重，不删除路径或损失端点悬停来源。缺乏可靠主链时不自动判断所谓“关键”。

避免反复给特定案例追加 nudge/swap/retry/fallback。若某类失败反复出现，必须从节点层次、分区占位、端口资源与走廊约束的**联合问题**解决。一个候选必须连同最终路由、字体、分区与导出一起打分；不得仅凭某条边更短或分区不再重叠就替换整图。当前已有多种局部搜索属于应当逐步**用单一约束规划替代并删除**的技术债，不是未来需要继续扩展的接口。

只有完整 A/B 能证明整体收益，才允许切换正式布局方式：同一个语义输入、同一个 Canvas 输出合同、真实端口和折点保真、相同画布尺寸与文本可读性、相同末端几何检测、等价端到端耗时。ELK、D2/TALA 位于隔离实验，未确认许可、质量和可编辑保真前**不得打进正式 npm 包**。不要为不存在的第二套生产实现设计空 LayoutEngine SPI。

## 质量信号与发布门禁

三种状态严禁混淆：

1. **基础几何通过**：节点/线/标签等确定性检查没有硬缺陷，不表示密集图可读。
2. **可进入视觉审查**：`visualPlan.review.readyForVisualReview` 来自当前完整场景的真实几何阻断项 `blockers`；包括严重交叉、独立关系重叠密度及分区框相交，不因基础检查 PASS 就自动升级。
3. **可交付**：真实 Chrome 截图、当前 Canvas/SVG/PNG 证据指纹、独立六维感知评分、人工 `approval=approved` 全部有效。模型审美评分不是人工审批；不存在评分时必须保持 null。

当前固定真实回归来自本仓库 12 个 TS 核心模块的静态 import 子图（包含 type-only，不等于完整运行依赖）。必须保存全部实际导入关系。历史基线曾有 2 处交叉与 16 处独立重叠；经过基于真实冲突优先的有界走廊协商、完整关系搜索与残余冲突清理，当前为 0 处交叉、3 处独立重叠、8 条外围绕行，机器几何资格已通过，**但 Chrome 真实图仍有外围折返、阅读主次弱等问题，尚无人工批准**。不得为了发布篡改源码图、隐去问题或调整阈值。20 例参考/合成场景仅是防退化样本，不能代替真实图。

- 快速几何：`pnpm benchmark:architecture`；扩展审查资格：`pnpm benchmark:architecture:review`。
- 真实项目可读性验收：`pnpm benchmark:architecture:acceptance`。当前未通过时必须**如实阻断发布**，不能通过跳过脚本、减样本或放宽门禁修绿。
- Chrome 证据：`pnpm benchmark:architecture:project:visual`（几何阻断导致非零退出仍应保存截图）；编辑器交互：`pnpm benchmark:architecture:relation-lens`。
- 像素模型审查：`pnpm benchmark:architecture:visual:blind --provider=dsh|codex --manifest=... --case=...`；DSH 必须在独立沙箱中真实触发成功 `read_image`，Codex 必须通过隔离的只读 PNG 和结构化输出，不得伪称模型读图成功。`benchmark:architecture:visual:repeat --provider=dsh|codex` 对同一指纹独立采样，两个 Provider 的报告分别保存，不得用不同模型的单次分数推断优化；只与有可比模型身份的同模型重复基线比较。
- `pnpm benchmark:architecture:visual:score --require-human-approval` 才能检验真实人工批准。截图存在、几何分数、模型评分与人工签署彼此不可替代。
- Codex 视觉审查默认使用与 codex-ppt 完全一致的 `gpt-6-luna` / `max`，显式传入 `-m` 和 `model_reasoning_effort`；不可将旧 Codex default 模型评分混入 Luna Max 的趋势分析。

所有布局/路由改动必须提供修改前后同一真实与合成案例的节点/关系保真、独立重叠、交叉、穿节点、分区框、标题字号、线路长度、耗时与必要 Chrome 截图。无整体净收益的试验直接撤销并删除实验实现；不增加“仅对这个用例”的生产路径。

## 开发与交付

- 改动前读实际调用链、相关测试和 `~/.agents/skills/project-engineering-playbook/SKILL.md`；视图与交互按 `frontend-experience-design`；并行修改使用 `devspace-collab` 独立 worktree。
- 保持高内聚、低耦合；入口校验一次后内部使用可信类型；失败显式报告，不吞错、不无界重试、不用默认成功掩盖失败。新功能先查可复用依赖，禁止重复实现编辑器、存储、质量评分或路由器。
- 不为了减少行数盲拆文件，也不为单次逻辑抽象接口；真正跨职责的超大组件应按状态所有权和依赖方向逐步分离。
- Bug 先复现后修；重构必须证明原有行为及保存/重开不退化。优先专项测试，发布前按影响运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm smoke`、`pnpm check:hosts` 和上述架构/视觉门禁。
- 测试方法总数（`tests/*.test.ts` 与 `tests/integration/*.test.mjs` 合计）**不得超过 300 条**，由 `pnpm test:budget` 自动校验。围绕领域行为归并边界场景，保留断言、拒绝路径及真实输入；不得通过跳过测试或放宽真实质量门禁凑数量。昂贵的重复整图确定性检查仅保留权威入口和真实项目案例。
- 每阶段独立提交可审核改动，注明未解决案例、真实验证结果、Git 状态与是否发布。不自动推送/部署；测试通过不等于安装到 Desktop 或生产发布。
