# 开发、质量验收与发布

> 当前 R1—R4 开发优先级和模式合同请先阅读 [roadmap.md](./roadmap.md)。本页保留具体技术证据、历史试验与现行验收命令；隔离实验不能自动进入正式 Composer。

R1 新增显式仓库采样器 `scripts/architecture-external-source-cases.ts`，跨项目来源审计与标准 Composer 基准分别通过 `pnpm benchmark:architecture:corpus --repo=...` 和 `node --import tsx scripts/benchmark-architecture.ts --suite=external --repo=...` 运行。采样的是 Git 跟踪文件的真实 TypeScript import，不包含用户验证的分区或业务关系；审计会独立汇报 `verifiedSourceSubgraphs` 和 `verifiedRealTasks`，后者**当前为 0**，不能据前者宣称 R1 完成。实测源码密集样本 16 节点/65、63、49、43、41、15 关系，交叉分别 109、137、24、5、3、0；独立重叠 312、399、176、159、128、2，全部数据由当前 Composer 输出，无生产修复或质量阈值更改。首五个密集样本均阻断视觉审查，低密度 16/15 样本仅等待人工审查。该结果指向层级、节点尺寸、端口容量及阅读视图的先行规划，而非添加针对特定节点的线路特例。

R1 后续新增 `scripts/architecture-reviewed-tasks.ts`：与自动 AST 子图分离的业务架构任务合同，具有逐节点、逐关系和功能分区的可核对源文件 SHA-256/行号及有向主路径，必须经**独立手动审阅记录**确认才能进入严格真实任务计数。支持 `--tasks=... --review-ledger=...` 的 corpus 审计与 `--suite=reviewed` 标准 Composer 基准。隔离合成未批准案例完成审计、Canvas、SVG 与质量测试（3 节点/2 关系，零交叉/零重叠），仍计 **0** 条经审阅真实业务任务。来源证据校验和业务真实语义分别审查，审阅记录不代替人工视觉批准；详情与命令见 [roadmap.md](./roadmap.md)。

R2 约束事实前置：新增开发期 `scripts/architecture-layout-demand.ts` 作为 **只读 demand 计算器**，从真实 `ArchitectureIntentGraph` 统计度数、SCC 环、声明的跨区接口、未知分区和明确的主阅读路径是否存在。审计和基准都并列输出固定假设下的端口单侧跨度需求与最终真实路由缺陷，拒绝把未验证的分区、端口分配或单侧超额当成硬门禁。详见 [roadmap.md](./roadmap.md)。

R2 首轮容量候选 A/B 失败并撤销：对 3 个真实源码模块图的生成前容量扩容＋动态分区行高＋完整路由，即使注释真实共享干线，仍然在整图交叉/重叠/法向/路长门禁退化。实验代码不再留在生产包和适配器中，仅保存忽略目录中的输入、运行日志及可重放负面结论；后续开发优先以 `architecture-layout-demand.ts` 的 SCC 压缩逻辑跨层切面压力分析预留真实走廊。该数值**不是**可用通道数、审美分数或已验证布局。

R2 隔离的逻辑走廊优先排列实验覆盖 4 个不同真实源码子图。只有 `template-market-1` 的交叉和独立重叠明显改善，但因真实共享主干 8→5 不能采纳；其余 3 组未过几何/语义门禁。已在共用的 `scripts/architecture-layout-gate.ts` 加入**主干数量不退化**的统一检查；原本该案例会被单纯的交叉/重叠规则判为候选合格，如今明确拒绝。追加 `architecture-corridor-conflicts.ts` 只读分析：把每个真实依赖跨越的逻辑切面与完整 Canvas 的真实冲突问题关联，列出切面内两条真实边共同涉及的缺陷和受影响边 ID，为后续通道预算提供来源；长边跨多个切面会重复归因，不能把计数当成独立碰撞数。详见 [roadmap.md](./roadmap.md)。

本文件记录当前可执行的开发流程。长期不变量和最终架构见 [AGENTS.md](../AGENTS.md)；历史实验的具体取舍可从 Git 提交查看，不再在本文逐轮堆积算法补丁说明。

## 架构与输出

- 语义入口：`diagram.composeArchitecture` 接收实际存在的节点、关系、证据和可选经确认的主路径、功能分区；`ArchitectureIntentGraph` 是权威输入。
- 构图：`architectureComposer.ts` 协调完整候选；`architectureDesign.ts` 负责场景/节点/分区；`architectureRouting.ts` 与 `architectureOrthogonalSolver.ts` 负责端口、线段和可见通道；`architectureRouteRepair.ts` 仅提出局部几何候选。
- 质量：`canvasQuality.ts`、`architectureRouteDiagnostics.ts`、`architecturePresentationQuality.ts` 和 `architectureVisualPlan.ts` 检查**最终** Canvas。`visualPlan.review.blockers` 是机器审查阻断的唯一输出，不得以未阻断的几何指标代替交付批准。
- 编辑与持久化：Canvas 使用 `.diagram.json`，Mermaid 使用 `.mmd` / `.mermaid`；`CanvasEditor.tsx` 与 `canvas.ts` 共用节点、箭头与端口语义。保存/重开、revision 冲突、提案审批、文件原子写入和人工作图不得被自动重排破坏。
- 密集架构图的节点属性面板会按实际有向关系列出入边（谁引用当前节点）与出边（当前节点引用谁），点击单条关系进入精准高亮；所有真实关系保持不变。`arch-*` 语义边界不会把单节点选择扩展为整组选中。Chrome 真实交互回归：`pnpm benchmark:architecture:relation-lens`。
- **全图依赖定位**：架构工具的「定位依赖」提供按真实来源、目标、关系文字与 ID 的搜索；基于实际目标入度排列拥挤关系，平行关系按箭头 ID 分别列出。点选任何结果会聚焦准确关系并将视口移动到其真实两端节点，不重排节点或改写文档；局部视图和追踪模式下先解除临时过滤。实际 Chrome 回归验证检索、精确选中、全部箭头保留和切回完整关系。架构图的静态 PNG 几何与旧版不变，该入口改善交互可追踪性，**不代表自动布局的主观评分改善**。
- **高汇聚关系逐条阅读**：选择至少具有 2 条真实关系的架构节点后，浮层可依次检查全部真实入边与出边（例如 11 条导向 canvas 的依赖），逐条突出实际箭头、准确来源和目标，并把视口定位到当前关系的实际两端节点；支持上一条、下一条及退出。其余关系只作阅读弱化，仍可编辑和持久保存。该阅读模式不参与自动布局、不制造关系，也不覆盖显式上下游追踪，切换节点会退出；真实 Chrome 对高汇聚节点执行了逐条前进、镜头定位、保留全部箭头及退出恢复验证。之前单纯最小化节点间曼哈顿距离的全局重排虽让理论长度下降，但使真实交叉/重叠急剧上升，因此并未合入正式布局。
- 宿主：`src/hosts/`、`integrations/deepseek/` 与打包层隔离 Codex、DSH Desktop/Web 差异，复用同一图表领域代码和画板。

下一阶段是**统一约束下的节点/分区/端口/走廊联合布局**。任何替代方案必须与现有 Canonical Canvas 合同进行同语义、同尺寸、同渲染/导出、同完整指标 A/B；未证明改善就撤销试验代码，不继续叠加条件路由器。ELK 和 D2/TALA 保留独立实验，不因单项指标较好或 native SVG 可看就进入正式依赖；还必须检查许可证与几何回灌保真。

### 布局性能收敛 · 第二阶段（2026-10-26）

实际使用 Node CPU Profile 对 `pnpm benchmark:architecture:project` 的 12 节点 / 26 关系进行采样，最显著的热点是 `architectureOrthogonalSolver.scoreRoute`（一次样本约 5.5 秒 CPU）及 `canvasQuality` 内重复的整体碰撞评估。拆分 Dense Composer 的阶段耗时：首次完整布局约 3.1 秒、密集候选初始化 1.5 秒、第一次线路协商 1.7 秒、节点槽位约 0.9 秒、第二次线路协商约 3 秒、终局协商约 2.3 秒。隔离 A/B 验证直接删除其中任何一次协商都会使真实图交叉或重叠退化，不能靠跳过门禁换取速度。

因此先优化**单次正交搜索内的相同线段代价复用**和确定性不相交线段快速跳过。真实图的几何输出与改动前 Canvas JSON 的 SHA-256 **完全一致**（原始 ID、方向、端口、折点、字体均不变），单次基准在当前环境由约 13.6 秒降至约 11.2 秒；取消线段缓存但保留快速几何判断的对照约 12.9 秒。上述运行时间有系统负载波动，**不是严格的统计性能承诺**。保持评分公式和搜索轮数不变，20 个扩展场景及真实项目质量门禁继续检验回归。下一步优先降低重复全场景评估成本，而不是增加新的路由规则或布局引擎。

**同阶段进一步验证**：对最终走廊 6 轮中的约 260–280 个候选/轮先做精确增量质量筛选，确实有 1,023 个候选可提前拒绝，但交替 A/B 耗时无稳定收益，因此**已撤销该实现**；单次搜索的线路空间索引也未证实比现有方案更快，已撤销。最终只保留 `architectureOrthogonalSolver.scoreRoute` 的安全提前截断：在障碍碰撞或占用通道成本使局部累计惩罚达到当前已知上界时立即拒绝，不缓存不完整的 segment score。两轮交替 A/B：旧版 **11.418 / 11.438 秒**，新版 **10.930 / 10.877 秒**，平均约降低 **4.6%**。四轮真实源码 Canvas JSON 的 SHA-256 完全相同，保留 12/26 真实节点关系、76.4/90、1 交叉、3 独立重叠、8 外围绕行。下一阶段仍需从**重复整图搜索的结构性消除**和高汇聚节点联合布局着手，不能把约半秒收益当成视觉质量达标。

**拓扑优先协商与残余冲突清理**：对最终走廊使用三段有界预算（前 4 轮先处理现有真实冲突与外围绕行；中间 2 轮覆盖**全部**真实关系；最后最多 4 轮只处理残余冲突及实际可用端口），复用同一个 Router、Canvas 和整图验收，不增加布局引擎、删除关系或特例节点规则。标准真实源码图由 **76.4/90、1 交叉、3 重叠、12,024px** 达到 **81.4/90、0 交叉、3 重叠、12,074px**，穿节点保持 0、字号保持 12.5px、外围绕行仍为 8；单次约 10.5 秒。20 个扩展案例和真实源码图回归均通过。Luna Max 最终相同模型独立读图 **50 / 59（中位数 54.5）**，低于上版 60 / 53（中位数 56.5），而且依赖可追踪性中位仍仅 **1.75/5**。只能宣称结构性几何改善，**不能声称视觉显著提升或已获人工批准**。下一轮应从高汇聚节点层次、阅读视图和外围长回路的联合布局入手。

**终局再做一次全关系复核**：重点/全量/残余冲突的搜索预算不变，但将第 10 轮从只评估当前冲突边调整为再次评估**全部原始关系**，以便在其他冲突已修复后发现之前被占用的短走廊。相同真实 12/26 Canvas 从 **12,074px → 11,722px**（约缩短 2.9%），仍为 **81.4/90、0 交叉、3 独立重叠、8 条外围长绕行、0 穿节点、12.5px 字号**；20 个扩展场景、Chrome 真实图与原生关系交互通过，未增加轮数、删除关系或新增布局器。Luna Max 两次独立视觉分数为 **60 / 50（中位数 55）**，相对上一版本 50 / 59（中位数 54.5）不足以证明主观视觉质量改善，关系可追踪性仍为 **1.75/5**。另外验证了直接把同分区路由的首选方向改成节点几何会产生 **17 处重叠**；把高汇聚目标简单挪到右侧也会显著增加冲突，以上实验已撤销。真正的高汇聚端口/节点空间联合规划仍待解决。

**测试方法收敛（2026-10-26）**：在 Canvas 核心、Canvas Patch、交互操作、架构设计和架构基准五个模块中，将 138 条分散的单项测试整理为 64 个领域测试方法，每个原有场景、断言与拒绝路径均继续执行，仅合并相关测试的外层注册。unit 方法由 354 降为 **280**，连同 **9 个宿主集成方法**共 **289/300**。新增 `pnpm test:budget` 的 AST 门禁，`pnpm test` 和 `pnpm check:hosts` 都会先验证总数；另外删除了分散在参考基准里的重复完整 Composer 二次生成，确定性验证仍保留在基础入口与真实 12/26 输入测试中。不是跳过测试、删掉真实场景或调整质量阈值。

### 布局内核替换验证 · 第一阶段（2026-10-26）

运行 `pnpm benchmark:architecture:engines:project`，生成 `test-results/architecture-engines-project/index.html` 和 `report.json`。该基准从本仓库 TypeScript AST 提取选定 12 个模块的真实 26 条静态 import 关系；用**同一份 Canonical Canvas** 分别评估现有布局与 ELK flat / compound / native / native-compound。可用 `--direction=DOWN`、`--spacing=40` 等参数做独立布局配置实验，不改变正式引擎。输出明确标出原始节点/边 ID 和语义保真、交叉、重叠、非正交、字号、总线长、外围绕行与候选拒绝原因。`--require-eligible` 会在所有外部候选均不可用时退出非零，不能误报替换成功。

**实际 A/B 决策：暂不切换 ELK。** 当前实际图为 1 交叉、3 独立重叠、12.5px、12,024px 总线路、8 条外围绕行；4 种 ELK 接法全部保留真实语义但**均未通过**完整 Canvas 替换门禁。ELK 原生 flat 为 2 交叉、0 重叠、8.7px、16,095px；原生 compound 为 4 交叉、0 重叠、9.8px、12,509px。方向 RIGHT / DOWN 与间距 40 / 64 / 90 的 24 种隔离参数组合也没有可替换方案。ELK 原生计算仅约十几毫秒，但其计时不包含正式 Composer 的建图和后处理，**不能与现有约 14 秒端到端流程直接比较**。

下一阶段不是继续盲调 ELK 的 spacing，而是单独验证**可信语义视图 + 节点层次/端口联合约束在固定可读尺寸下的可编辑结果**。应先建立真实高汇聚、跨分区、长链的多种输入案例及可比较的 Chrome/Luna Max 基线，再决定是逐步替换自研规划器还是直接采用更合适的布局内核。旧局部搜索只在经完整 A/B 证实替换有效之后删除；失败的外部引擎仍留在开发实验区，不能打包到正式插件。elkjs 当前为开发依赖，其 EPL-2.0 / GPL-3.0-or-later 许可证须在任何生产打包决定前单独审查。

## 本地开发

Node.js 22+、pnpm 11，构建与测试：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm check:hosts
```

`pnpm build` 生成同时支持 Codex 与 DSH 的 `package/`。宿主测试基于真实 MCP stdio 子进程，覆盖身份/工作区边界、候选保存、revision 冲突和工具可见性；单元测试负责领域合同。类型检查、打包通过不是 Desktop 原生人工验收。

## 面板与编辑器门禁

`visual:smoke` / `visual:regression` 只渲染图表本身，不覆盖承载图表的面板与编辑器。面板层的行为由 `scripts/panel-baseline.mjs` 单独守住：

```sh
pnpm baseline:panel            # 9 个形态：像素 + 宿主调用预算 + 交互断言
node scripts/panel-baseline.mjs --only=thread-canvas --update
```

- 脚本用 `package/dist/app.js` 与 `app.css` 的真实产物，在 node:http 临时页里以桩宿主（`diagram.ready` / `diagram.connect` / MessagePort）驱动面板，并通过 CDP `Emulation.setDeviceMetricsOverride` 设定真实视口——Chrome 会把 `--window-size=420` 夹到约 500px 再裁剪，直接用窗口参数会得到假布局。
- 形态：workspace 1440×900、thread 1100×900、thread 420×900、thread-canvas（点击画布标签后编辑器真实渲染）、canvas-undo（重新整理后撤销，要求所有 `data-element-id` 变换逐字还原且重做可用）、canvas-layer-select（从层级面板点击节点，断言恰好一个节点被选中且属性面板出现）、thread-proposal-review，以及 proposal-reject / proposal-accept（点击 拒绝 / 全部接受，断言评审面关闭、对应工具被调用、文档回到已保存）。
- 比较用 8×8 块平均而不是 sha256：Chrome 每次重新栅格化文字会产生轻微抗锯齿差异，精确哈希会让门禁永远为红并被忽略。块平均消除亚像素文字噪声，控件移动或改色仍会命中。渲染统一加 `--disable-lcd-text` 与 `--force-color-profile=srgb` 保持字形边缘稳定。
- 每个形态记录宿主调用次数并受预算约束（默认 24）。轮询风暴在像素上不可见：跟随 effect 曾因 `callTool`/`selectDiagram` 进入依赖而每次渲染重建，3 秒发出约 500 次 `diagram.threadState`，正是这条预算抓到的。
- 基线存于 `tests/fixtures/panel-baseline/`（PNG + `manifest.json` 含 bytes、sha256、toolCalls）。`--only=<id> --update` 只更新单个形态并与已存 manifest 合并；默认不带 `--strict` 时漂移只报告，`--strict` 才非零退出。
- 这层门禁证明的是面板 chrome 与交互接线没有回归，**不是**架构图可读性评审，也不能替代真实 Chrome 截图、六维像素评分与人工批准。

## 架构生成质量与真实性

**2026-10-27 Composer 第一阶段收敛（不改变算法）**：在固定真实 12 个核心模块、26 条静态 import 上做单阶段消融，基线 **81.4/90、0 交叉、3 独立重叠**；去掉首轮走廊优化为 **66.0/90、3 交叉、3 重叠**，去掉同分区节点槽位为 **56.9/90、2 交叉、8 重叠**，去掉第二轮走廊优化为 **67.4/90、2 交叉、3 重叠**，去掉终局协商为 **65.7/90、1 交叉、7 重叠**。这些阶段在当前实现中均有独立收益，不能靠删除其中一个实现安全收敛，失败实验全部撤销。第一阶段只把隐式深层函数嵌套改为明确的四阶段顺序，同时统一四处重复的**节点遮挡、穿节点、标签碰撞**硬约束判定；各阶段特有的交叉、端口、走廊、共享主干及路长门禁保持原样。下一步应以更广的真实场景检验新的节点—端口—走廊联合候选，然后在输出与耗时均有证据时逐步替换现有阶段，不再追加独立修补环路。

**2026-10-27 Composer 第二阶段收敛（行为不变）**：在第一阶段共用的节点/标签硬约束之外，统一走廊候选的三个不变量：**分区框重叠面积不得增加、无关分区入侵长度不得增加、线路总长不得突破所属阶段原有预算**。首轮和槽位优化分别仍采用各自 1.10 倍预算，终局普通走廊保留 1.02 倍预算，终局端口分配保留原始 1.015 倍全局预算；交叉、独立重叠、真实共享主干及采纳目标仍由各阶段独立评估，不引入新 Router 或空 LayoutEngine SPI。

**真实样本扩展（观察型，不绕过主基准）**：`pnpm benchmark:architecture:project:multi` 对相同仓库源码的三组不同模块子图重新解析实际 TypeScript 静态 import（包括 type-only），每条边由 AST 生成，不手写或臆造；旧的 `project`、`project:acceptance` 仍严格仅用原有 12/26 子图。新增 **图表质量流水线 12 节点/18 关系**：结构 79.7/90，交叉 0，独立重叠 4，端口拥塞 5；**Canvas 编辑流水线 15 节点/21 关系**：结构 37/90，交叉 0，独立重叠 20，端口拥塞 10，自动视觉审查仍被阻断。三组原始与抽取公共走廊约束后的结构、路由、阅读评估及修复次数相同；不能将「全仓真实静态 import 子图」误称其他企业或真实生产部署的架构，后续仍需独立输入来源和真实用户案例。

**ELK 联合节点/原生端口走廊隔离 A/B（2026-10-27）**：实验脚本现在也接受三组真实项目源码子图。运行 `node --import tsx scripts/benchmark-architecture-engines.ts --suite=project-multi --spacing=20 --compact-bounds`；`--compact-bounds` 只在实验 Canvas 中对**节点、实际箭头路径、标签及自动分区标题/边框的联合包围盒**做统一平移，保留 30px 安全边距，不缩小卡片/文字、不更改端口比例或任何真实关系；原有默认 ELK 对照行为不变。首次仅按节点和关系路径裁剪曾造成自动分区标题 **顶部超出画布 12px**，经检查后已废弃该候选及其视觉评分；新的外部 A/B 门禁显式拒绝分区越界。修正后相同三组真实子图的四种 ELK 候选共有 **1/12 个通过当前外部几何门禁**，仅 Canvas 编辑流水线的 ELK Native 符合：节点 15、真实关系 21、交叉 **0→0**、独立重叠 **20→0**、端点法向缺陷 **29→0**、转折 **47→36**、总线长 **12,930→6,674px**，适配字号 **12.5→12.5px**、分区越界 0；候选最终画布为 **1198×920**，原图 **960×1206**，故仍不符合「同尺寸」的直接生产替换要求。其余 11 个实验候选有交叉、字体或其他门禁回退，已拒绝。以上 ELK 候选复用 Canvas 编辑格式但仅证明**候选阶段几何**，不代表整个生产 Composer 已换算并验证端到端耗时，且尚未完成 ELK 打包/许可与带锁定节点场景的上线评估。

修复分区越界后的 Canvas 编辑流水线重新生成相同 1280×960 Chrome 截图及 Canvas/SVG/PNG SHA-256 指纹，证据保存在忽略目录 `test-results/architecture-convergence/elk-canvas-framed-20/`。原布局同画面同指纹的 Codex GPT-6 Luna Max 两次独立评分为 **57.5、52（均值 54.8/100）**；修正版 ELK 候选 **62、61（均值 61.5/100）**，关系可追踪性中位 **1.75/5→2/5**、构图中位 **2.5/5→3/5**。报告对每组仅两次样本的比较结论仍是 **`inconclusive`**；曾经越界候选的评分已经作废，**人工批准仍待进行**。本轮未将 ELK 带入正式 npm 包、未修改生产 Router 和 Composer；下一步先处理同尺寸/锁定节点/更广语义类别和可维护性，再考虑替换现有局部优化链。

**ELK 严格画布尺寸与锁定节点试验（2026-10-27）**：`node --import tsx scripts/benchmark-architecture-engines.ts --suite=project-multi --spacing=20 --compact-bounds --wrapping=MULTI_EDGE --aspect-ratio=0.8 --same-canvas` 基于 ELK 官方 Layered wrapping 选项对三组真实子图进行完整 Canvas A/B；`--same-canvas` 只允许节点、端口、实际折点和分区包围盒通过**同一平移**放回原画布，无法容纳时明确给出拒绝理由，不缩放标题或放大 Canvas。此次三组真实图的 12 个实验候选 **0/12 达到全部门禁**：Canvas 编辑流水线虽仍可保持交叉 0、重叠 0、端点法向 0，但 MULTI_EDGE 缩到 **1062×1275**（原图 **960×1206**），8px 最小间距探针仍为 **1038×1191**，宽度至少多 78px；图表质量流水线的原尺寸可容纳候选则交叉、绕行和线长退化，故拒绝。已有局部视觉收益不能冒充「同尺寸可直接替换生产」。

**ELK 横向空走廊压缩试验（2026-10-27，仍为隔离实验）**：新增 `--same-canvas --fit-corridors` A/B。只在 ELK 已生成**完整原生正交边线**后，对全部节点 X 投影占用区间求并集；压缩区间之间尚未被节点占用的横向间隔，保留 `CANVAS_PORT_MIN_SEPARATION_PX` 余量。节点宽高、字号不缩放，路由折点与真实端口统一施加同一单调 X 变换；之后用原有 `placeElkWithinOriginalCanvas` 放回**完全相同**的原画布，锁定节点若无法按刚性平移恢复就显式拒绝。所有语义保真、正交性、分区边框越界、交叉、独立重叠、线长、字号及转折的完整 A/B 门禁仍然有效，不自动改写正式 Canvas。

运行：

```sh
node --import tsx scripts/benchmark-architecture-engines.ts \
  --suite=project-multi --spacing=8 --wrapping=MULTI_EDGE --aspect-ratio=0.8 \
  --compact-bounds --same-canvas --fit-corridors \
  --out=test-results/architecture-convergence/elk-elastic-multi
```

三组真实静态 import 子图共 **12 个 ELK 候选，1 个通过完整几何与语义门禁**：Canvas 编辑流水线的 `elk-native` 从原来的 **20 处独立线路重叠 → 0**、交叉 **0→0**、端点法向缺陷 **29→0**，原生几何压缩后在 **960×1206** 的原画布上保持 15 个节点 / 21 条真实关系及原字号。另两组真实图的 ELK 试验因交叉、尺寸或其他指标退化而拒绝，故没有通用替换依据。原布局与同画布候选 Chrome 截图在该目录的 `diagram-plugin-canvas-imports--{current,elk-native}.png`；截图存在不等于独立视觉评分或人工批准。`elkjs` 仍仅为开发依赖，不修改生产 Composer/Router、已保存 Canvas 和 npm 正式产物；后续必须继续验证更多拓扑、真实像素评价、锁定节点以及等价端到端耗时，才允许讨论生产切换。

同一 Chrome 截图采集协议下，Codex `gpt-6-luna/max` 两次独立读图：原布局 **51.5 / 50（中位 50.8）**，空走廊压缩后的 ELK 布局 **58.5 / 57（中位 57.8）**。评分确有观测提升，但比较器仍输出 **`inconclusive`**，不能把两个样本的分数直接当成可靠审美提升；特别是**真实关系追踪性中位均为 1.75/5**，远未解决高汇聚线路的可读性。相同指纹的原始评审与报告保存在 `elk-elastic-multi/*.codex.visual-repeat.json` 及其 `.visual-repeat-samples/`；独立模型评价仍不是人工 `approval=approved`。

**ELK 联合端口二次布局（2026-10-27，仍为隔离实验）**：使用 `--joint-ports`（要求同时提供 `--same-canvas --fit-corridors`）时，只为原生 `elk-native` 追加第二个完整布局候选。首次 ELK 生成真实节点位置；第二次以实际相对位置确定独立关系的进出边方向，使用 ELK `FIXED_SIDE` 的逐关系端口而非给模型造共享总线；全部候选仍接受现有的语义、边界、同画布、折点、字体、路长、交叉和重叠门禁。该实验不修改生产 Composer，也不因为有单个合格案例就自动切换引擎。

```sh
node --import tsx scripts/benchmark-architecture-engines.ts \
  --suite=project-multi --spacing=8 --wrapping=MULTI_EDGE --aspect-ratio=0.8 \
  --compact-bounds --same-canvas --fit-corridors --joint-ports \
  --out=test-results/architecture-convergence/elk-joint-ports
```

三组真实源码子图共 15 个 ELK 候选，有 2 个通过外部几何与保真门禁，均来自 Canvas 编辑流水线（单遍原生布局与双遍联合布局）；另外两组继续拒绝。目标 15 节点 / 21 关系的双遍版本维持 **0 交叉、0 独立重叠、0 端点法向缺陷、960×1206 画布、12.5px 字体**，相较单遍版本的线路 **10,804→6,510px**、转折 **48→40**、外围绕行 **5→2**。同协议真实 Chrome 截图的两次独立 Luna Max 得分，单遍 **58.5 / 57（平均 57.8）**，双遍 **63.5 / 61.5（平均 62.5）**，双遍的关系可追踪性中位数 **1.75→2/5**；比较器仍为 `inconclusive`，也没有人工批准。此结果不等于普适视觉收益或端到端耗时改善。

另行验证将同一节点的 11 条真实入边强行分散至多边端口，会导致 **7～10 处新交叉**，因此未合入该策略；目前双遍候选依旧存在 **9 处独立入边端口间距冲突**，真实的 80px 侧边装不下 11 个按 14px 间隔排列的端口。下一阶段需把**边界容量、侧边选择、节点尺寸与层级**作为同一完整布局问题检验，而非针对 `canvas` 节点添加特例或通过隐藏关系伪造可读性。原始证据与可编辑场景保存在忽略目录 `test-results/architecture-convergence/elk-joint-ports/`。

**端口容量与新生成节点高度实验（2026-10-27）**：隔离 A/B 增加 `--auto-size-ports`（依赖 `--joint-ports --fit-corridors --same-canvas`），只为新生成图的第二遍 ELK 候选，按同侧实际关系端点数与统一 `CANVAS_PORT_MIN_SEPARATION_PX=14` 计算节点最小高度。现有可编辑 Canvas 的 strict fidelity **始终拒绝高度变化**，锁定节点直接拒绝；`geometryGatePassed` 只表示其他几何门禁通过，不等于替换资格。生产的 `architectureRouteDiagnostics.sidePortCapacityDeficits` 新增**只读诊断**，按各节点/侧边的真实进出关系端点数（相同 bundleKey 的端点复用）、侧边当前容量和带端角余量的所需长度报告不可满足的容量，**不自动更改节点尺寸或评分门禁**。

```sh
node --import tsx scripts/benchmark-architecture-engines.ts \
  --suite=project-multi --spacing=8 --wrapping=MULTI_EDGE --aspect-ratio=0.8 \
  --compact-bounds --same-canvas --fit-corridors --joint-ports --auto-size-ports \
  --out=test-results/architecture-convergence/elk-port-capacity/benchmark
```

目标真实 15/21 Canvas 编辑流水线：唯一容量超限节点 `canvas` 左侧 **15 个不同连接端点，80px 仅容纳 4 个保留端角余量的端口，所需高度 224px**。新生成尺寸实验将其自动增高为 224px，原画布仍为 960×1206、正交无交叉/重叠、端点法向缺陷 0、入边端口冲突 **9→0**，线路长度 **6510→6006px**、外围绕行 **2→1**；严格原 Canvas 几何尺寸合同拒绝，这是**预期保护**。同截图协议的 Luna Max 两次评分 **64 / 64.5（中位 64.3，关系可追踪性 2.5/5）**，上一版双遍端口候选 **63.5 / 61.5（中位 62.5，可追踪性 2/5）**；比较器仍返回 `inconclusive`，未获人工批准。三组真实图中另外两组因交叉/线长/尺寸退化拒绝；20 组参考与压力图的 120 个 ELK 候选**0 通过完整门禁**，其中六个双遍实验发生 ELK 内部错误，已保留原始报告，不掩盖失败。故这一自动尺寸策略目前**没有跨拓扑泛化证据，不进入生产 Composer**，只作为可复现研究候选。

**ELK 双遍计算稳定性收敛（2026-10-27）**：已定位 `elkjs@0.12.0` 在合法扇出图上的固定侧端口 `FIXED_SIDE` 与第二遍 `MULTI_EDGE` wrapping 组合会抛出内部 `TypeError: Cannot read properties of undefined (reading 'c')`。隔离实验的固定方案是**第一遍保留 MULTI_EDGE 规划节点层级，第二遍统一使用 `wrapping=OFF` 规划真实端口**，并在适配器入口显式拒绝不安全组合，而不是捕获异常并暗中重试。23 个拓扑对照（3 个实际 import 子图 + 20 个参考/压力图）中，原组合异常 **3/23→0/23**；正式扩展 A/B 的 **120 个候选错误 6→0**，但严格合格数量仍为 **0/120**；3 组实际子图的 18 个候选仍为 **2 个合格**，只来自同一个单分区 Canvas 流水线。该流水线 5 种输入排列（原始、逆序、升/降序、轮转）均保持零交叉、零独立重叠；自动增高仍违反原 Canvas 的尺寸保真，不能代替旧图。另做的 ELK 层级分区实验虽降低部分分区相交面积，却增加线长、交叉或溢出，未形成可采纳候选，相关未纳入正式代码。**结论：消除 ELK 崩溃不等于解决分区约束。**分区明确的多组架构图仍应保持当前引擎，下一步需要联合求解分区包围盒、节点容量与走廊，而不是反复调 ELK 参数。

**完整分区包围盒刚性候选（2026-10-27，隔离实验）**：在仓库已有 `partitionFirst`（碰撞后主要向下移动）基础上，新增开发态 `scripts/partition-envelope-candidate.ts`，对新生成架构的真实兄弟分区框提出横向、纵向及最小画布增长三种有界刚性位移，不改变分区内节点相对位置；**仅在真的存在同级分区相交时**生成候选。位移完成后使用项目既有正交路由器重算**全部真实关系**，而不是平移旧折线假装已重新连通。拒绝混合用户手工分组、锁定节点、注释及泳道的输入，不允许隐藏/删减节点、关系或共享主干。使用现有权威基准的显式 `--partition-envelopes` 选项执行全场景 A/B：

```sh
node --import tsx scripts/benchmark-architecture.ts --suite=extended --partition-envelopes \
  --out test-results/architecture-convergence/partition-joint/official-extended
node --import tsx scripts/benchmark-architecture.ts --suite=project-multi --partition-envelopes \
  --out test-results/architecture-convergence/partition-joint/official-project
```

基准要求语义/节点尺寸保真、原 Canvas **宽高均不变**、全部交叉/重叠/字号/端口容量与法向/真实共享主干/路长完整门禁均不退化。20 个虚构参考及压力场景中 45 个实际生成的候选，**4 个通过几何与同尺寸门禁，仅来自 `agent-runtime` 和其长标题变体**；3 组真实 TypeScript import 子图没有符合此实验触发条件的候选。`agent-runtime` 的水平候选把同级分区相交 **1→0、9912→0px²**，交叉 0、独立重叠 0、端口冲突/正交转折不变，画布继续是 **1726×1008**，线长 **5376→5834px（+8.5%）**。相同 Chrome 截图协议的 Codex `gpt-6-luna/max` 两次独立读图，原布局 **56.5/61.5（均值 59）**、候选 **56.5/63.5（均值 60）**，仅有微弱分区与一致性评价改善，真实关系可追踪性中位数都为 **2.25/5**。**不能以 1 分差异宣称视觉质量提高，人工审核仍未批准。**当前尚无跨不同拓扑的质量净收益证据，不接入正式 Composer。下一轮不再对分区做无界事后位移，而是设计分区占位、端口容量及跨区走廊的统一前置可行域与后续求解。

隔离适配器的 `rigidLockedPlacement` 仅在**完整 ELK 原生端口几何 + 单一刚性平移**能够恢复所有锁定节点原坐标且不超出原画布时成功；多个锁定节点要求不一致的位移时明确失败，绝不强行改写人工位置。语义保真门禁同时检查 `locked` 属性本身未被候选丢弃。该能力还不是通用固定节点的布局求解器，若新图包含不可整体平移保持的人工编辑位置，应保留当前引擎。实际安装的 `elkjs@0.12.0` 声明双许可 `EPL-2.0 OR GPL-3.0-or-later`，发布前还需对依赖许可与 npm 分发方式完成合规核对。本轮不修改正式 Composer，也不增加生产 ELK 依赖。

**2026-10-27 P0 端口容量第一阶段**：沿用现有 Canvas/Composer/Router，针对同一节点同侧的 3–6 条真实入边新增联合端口分配候选，只有物理边界间隔足够、末端仍严格正交时才提出。原有逐条候选继续存在，Composer 仍用完整场景的交叉、独立重叠、穿节点、真实共享主干、分区侵入、路长和字号决定是否采纳；没有引入新布局器或修改 Canvas 文件格式。路由诊断增加 `ingressPortConflicts`，只统计不同真实关系在同一节点同侧的不足 14px 端口间隔，排除已验证同一共享主干；该指标**只提供证据，不单独进入候选收益函数**，防止压过真实结构质量。基准 HTML 与 JSON 保留该数字。

**端口联合收敛第二阶段**：普通走廊搜索结束后，在同一 Composer 中对真实端口进行最多 4 轮的完整侧边分配检查；支持同侧 2–6 条入边，不能跳过小幅度但必要的端口移动。候选必须严格减少独立端口拥塞，同时不增加交叉、独立重叠、穿节点、标签碰撞、分区侵入或外围绕行，不减少已验证共享主干，不降低适配字号及整图结构原始评分；整段路由预算最多增加 1.5%，并由完整场景重新计算质量、候选和审查资格。该门禁**仅在普通结构优化结束后执行**，不会为了抢占端口容量破坏前面的交叉消除。

相同真实 12/26 静态 import 子图，端口拥塞 **5 → 1**，几何评分 **81.4/90**、交叉 **0**、独立重叠 **3**、穿节点 **0**、外围绕行 **8**，仍保持 12.5px 字号和所有 26 条真实关系；总线路由 **11,722 → 11,777px**（增加约 0.47%）。有一次针对沿节点边界贴入的错误法向线路的额外候选实验将整图结构分降至 81.3，已撤销，剩余 1 处端口拥塞与该类终端几何需要下一轮联合布局实验，而非通过放松门禁直接采纳。

真实项目机器审查、20 个扩展场景、286 个单测、9 个宿主集成测试、构建/Smoke 和 Chrome 截图均通过。当前画面经相同 Codex `gpt-6-luna/max` 两次独立读图得到 **63.5/55（中位 59.3）**，旧版可比基线为 **60/50（中位 55）**；报告判定比较 **inconclusive**，不能宣称独立审美质量可靠提高。当前关系可追踪性中位仍为 **2/5**，人工批准仍待完成。下一阶段应在统一约束下解决残余的错误终端法向、3 处独立重叠和 8 条外围折返，而非继续靠端口评分调参。

**2026-10-27 端点法向审计**：沿现有 Canvas 正交折线实际首末段检测端口声明与物理出入方向是否一致。当前真实 12/26 子图检测出 **26 处终端法向缺陷，涉及 21 条真实关系**；这与 1 处入边端口容量冲突是两个不同指标。机器结构评分 **81.4/90、0 交叉、3 独立重叠** 保持不变，但不能据此宣称路由方向正确或专业视觉交付完成。诊断证据通过 `architectureRouteDiagnostics`、架构 Benchmark、Chrome 审查 manifest 和 `visualPlan.review` 的真实关系修复目标向上暴露；自动几何审查资格是**进入人工视觉审查的资格**，而非端口几何正确或人工批准。外部引擎 A/B 不得通过增加端点法向缺陷换取局部美观，修正端点法向可以作为独立的质量收益，但仍需满足完整节点、关系、字号、碰撞和路长门禁。94 个节点交换候选、228 个节点平移候选及 4 种替代拓扑顺序都未改善整图；仅在正交求解器全局强制严格端点法向的实验导致 **7 交叉、83 独立重叠**，已撤销。ELK Native 虽然使端口法向缺陷降至 0，但出现 **2 交叉**且字号不达标，同样不能进入生产布局。

**终端法向渐进修复 A/B 的否决**：以原有 Composer 的最终端口协商取代额外修补环路，针对不属于已验证共享主干的独立关系，用同一个障碍感知正交求解器生成两端真实法向的走廊候选。隔离实验一度把真实图缺陷 **26→23**，但线长 **11,777→11,801px**，突破现有真实基准 11,800px 门禁；只接受线长不增的候选时缺陷 **26→25**，结构分、交叉与重叠保持不变。这个版本经过真实 Chrome + 两次独立 Luna Max 评估为 **53 / 52（中位 52.5/100）**，对照相同模型旧基线 **63.5 / 55（中位 59.3/100）**；小样本比较为 `inconclusive`，不能认定统计意义上的视觉退化，但没有证据支持整体改善。几何复核进一步发现该候选使正交转折总数 **49→50**，阅读可追踪性评分中位从 **2→1.5/5**。因此**撤销生产修复路径**，不为一处端点修正引入更复杂的线路或额外 Composer 循环。

**转折复杂度审计**：保留纯诊断性 `totalRouteBends`、`worstRouteBends`（直接使用最终可编辑 Canvas 的实际正交路线，重复点不算转折，最多列出前 5 条有真实 ID 的关系）；架构 Benchmark、真实 Chrome manifest 和外部布局 A/B 同步显示。外部引擎若不减少真实交叉/独立重叠，就不能仅为端点或展示效果增加线路转折；若确实消除交叉或重叠，仍可在全量几何、字号、路长等门禁下进行 A/B。**转折数量不是主观质量分**。下阶段需要先解决节点层次与共享走廊的联合规划，而不是继续增加单根线局部补丁。

```sh
pnpm benchmark:architecture                # 五组虚构核心案例：基础几何
pnpm benchmark:architecture:review         # 20 组参考/合成案例：自动视觉审查资格
pnpm benchmark:architecture:project        # 当前仓库真实 import 子图，输出事实和诊断
pnpm benchmark:architecture:acceptance     # 同一真实图要求通过审查资格；已知失败则退出非零
pnpm benchmark:architecture:project:multi   # 三组真实源码模块子图；输出详细报告，允许记录待整改阻断
pnpm benchmark:architecture:project:visual # 真实 Chrome 截图及人工审核清单
pnpm benchmark:architecture:relation-lens  # 真实 Chrome + React 聚焦交互
```

真实项目基准通过 TypeScript AST 解析 `src` 中固定的 12 个核心模块，提取 26 条直接静态 import（包含 type-only），不猜测运行时完整调用图。整改前基线：**12 节点、26 关系、2 处交叉、16 处独立重叠、32.6/90 结构分、0 穿节点**。同日经有界的**走廊协商 → 同分区节点槽位协商 → 再次走廊协商**（复用现有正交求解器与修复候选，并在每次采纳前检查完整 Canvas）后，机器实测变为 **1 处交叉、9 处独立重叠、56.9/90、0 穿节点、12.5px 适配字号**，总路线从初始 13,581px 降到 v0.21.0 的 13,414px；后续在原有候选评估中增加**相同结构评分下的外围绕行/线长比较**，进一步降为 12,872px（交叉 1、独立重叠 9、外围绕行 10、字号 12.5px，未删除任何依赖）。Canvas 编辑器和 SVG 导出都对实际主节点采用一致的浅色强调与字重，且保留用户定义的颜色。真实图机器审查资格不再阻断，但外围长绕行仍明显；DSH read_image 单次主观评分在不同运行中为 51.5、48.5、40.5，波动显著，**尚无人工批准**，不能据此宣称已经达到专业视觉交付质量。本轮扩大密集图的确定性候选覆盖范围（最多 32 条真实关系，优先冲突与外围绕行，再检查剩余独立关系），真实 12 模块 / 26 关系基准为 **结构 61/90、外围长绕行 9、交叉 1、独立重叠 9、穿节点 0、总线长 12,898px**；相比上轮线长略增 26px，端到端耗时约 8.5→10.2 秒。真实 Chrome 截图已生成，DSH 本轮独立读图为 47.5/100（仅单次波动参考），仍无人工批准。不要删真实关系、换成虚构案例或调低门禁换取发布绿灯。

`benchmark:architecture:review` 检查合成数据的防退化，不证明真实系统质量。所有图的自动报告必须保留节点/关系数、独立线路重叠、交叉、穿节点、分区框、适配字体、绕线长度和耗时；更改布局前后比较同一实际图与扩展集。机器准入只允许进入人工视觉审查。

**后续密集图优化基线（2026-10-26）**：在原有 Composer 约束评估中，对真实交叉/重叠关系做有界的双边联合重排，并在候选评分之前重新识别由实际路线形成的共享主干，避免以过期的 bundleKey 评价非最终几何。固定真实 12 节点、26 关系的指标为 **65.7/90、交叉 1、独立重叠 7、穿节点 0、外围长绕行 9、真实共享主干 2、总线长 12,601px、适配字号 12.5px**。与此前 61/90、重叠 9、线长 12,898px 比较，整体质量有净收益，计算耗时约 10–11 秒。自动审查资格通过，但**不是人工视觉批准**；剩余拥塞与外围长绕行仍需继续治理。

**P0 / P1 持续整改**：在 `architecturePortPlanning.ts` 内统一产生**真实入边终端端口**的有界空间分配提案（不改变源节点和其他边、无对角线、仅调整已存在的最终正交折段），`architectureComposer.ts` 仍用全场景几何、主干、路长与字号决定是否采纳。固定真实 12/26 源码图的基线改为 **71.4/90、交叉 1、独立重叠 5、穿节点 0、外围长绕行 9、总线路 12,414px**，对比旧版 65.7/90、重叠 7、线路 12,601px。密集且实际存在可验证主链的架构图在编辑器中首次打开默认**突出「关键」关系**，一键切回「全部」；非重点边仅视觉弱化，所有关系仍然可选、可导出、可保存，非密集或缺少可信主链的图仍默认全部。实际浏览器回归覆盖了这两种阅读状态和无数据损失。

静态 SVG 导出也依据同一已验证的关键关系设置主次线条的视觉权重；非重点关系仍保留真实的完整线路及悬停来源提示，不通过删线获得“简洁”。该变化需用同一张真实 Chrome 图和 Luna Max 做前后证据对比，不能把编辑器的阅读模式自动当成静态可视化质量提升。

**P0 联合走廊收敛（同日后续）**：将末端独立端口分流合并为 Composer 的**单一有界终局走廊协商**，同时比较原有正交路由器产生的真实单关系候选、原有走廊微调候选与真实入边端口候选，按整图交叉、独立重叠、外围绕行、线路总长、可读字体及共享主干采纳。实际图首轮达到 **76.4/90、1 处交叉、3 处独立重叠、8 条外围长绕行、0 穿节点、12,024px 线路总长**；前版为 71.4/90、5 处重叠、9 条绕行、12,414px。候选采用有界 6 轮，不把单一路径成本作为决定因素，也不制造新依赖、第二套布局引擎或改变原有文件协议。发布前需同样复核 20 例扩展场景、完整单测、实际 Chrome 和同模型 Luna Max。

**最终实际验收**：349/349 单元测试、9/9 宿主集成、20/20 扩展架构、24/24 固定像素回归、真实 Chromium 截图与交互、项目 `--require-review-ready` 均通过。Luna Max 在**这一版**的独立读图为 **60 / 53（中位数 56.5）**，比前一版 59.5 / 62（中位数 60.8）低；两组小样本评分区间重叠，**无法确认主观视觉质量的真实方向**。可确定的是全部真实依赖不变、结构交叉/重叠/路长减少。关键关系的静态可追踪性仍 **1.75/5**，分区虚线框与外围折返路线也仍不协调；这批 P1 问题继续待处理，不能以几何门禁冒充最终视觉批准。

**同模型最终截图复评**：同一真实场景的 Luna Max 两次独立评分，在全线路展示的上一稿为 56 / 52（中位 54），修正精确端口并调整静态主次线权重后为 **59.5 / 62（中位 60.8）**；依赖可追踪性中位 **1.5 → 1.75/5**，构图 **2.5 → 3/5**。这是每版只有两次主观评价的小样本，虽本轮分数区间未与旧版重叠，**仍不得宣称统计上可靠或等同人工批准**。9 条外围长回环仍存在，`canvas` 11 条实际入边的结构性拥塞没有完全解决。后续仍应优化全局布局，而不是通过进一步降低线条透明度刷视觉评分。

浏览器可视化与 Mermaid 图表检查：

```sh
pnpm benchmark:architecture:design --screenshots --extended
pnpm visual:verify
pnpm perf:canvas -- --nodes 3000 --detail --drag
```

Chrome 截图、SVG、Canvas JSON 共同生成 SHA-256 指纹，图片或源码改变后旧评分立即失效。`test-results/` 的 HTML、PNG、`manifest.json`、`review-draft.json` 和 `review.md` 是验收证据，截图本身不自动批准。`visual:verify` 覆盖 Mermaid 兼容渲染、压力场景、12 套样式和固定像素回归；只有人工确认视觉升级正确后才可执行 `pnpm visual:regression:update`。

## 像素审查与人类批准

```sh
pnpm benchmark:architecture:visual:blind --provider=dsh --manifest=test-results/architecture-design-project/manifest.json --case=diagram-plugin-source-imports
pnpm benchmark:architecture:visual:blind --provider=codex --manifest=test-results/architecture-design-project/manifest.json --case=diagram-plugin-source-imports
pnpm benchmark:architecture:visual:repeat --provider=codex --manifest=test-results/architecture-design-project/manifest.json --case=diagram-plugin-source-imports --samples=3
pnpm benchmark:architecture:visual:repeat --provider=dsh --manifest=test-results/architecture-design-project/manifest.json --case=diagram-plugin-source-imports --samples=3
pnpm benchmark:architecture:visual:score --manifest=test-results/architecture-design-project/manifest.json --review=<人工填写的review.json> --require-human-approval
```

**Codex 视觉验收模型**：与 `codex-ppt/scripts/visual-review-model.ts` 一致，默认显式执行 `gpt-6-luna` / `model_reasoning_effort="max"`；不采用 Codex CLI 的默认模型。模型 ID 和推理强度写入每次独立评价，旧 Codex default 报告不可作为 Luna Max 的同模型历史基线。

DeepSeek Harness 需要执行真实 `read_image` 工具调用并在原始 JSONL 中验证成功的图像结果；Codex 使用隔离的只读 PNG 输入、结构化 JSON 输出及证据指纹。只传提示词或让模型声称看到图不算像素评审。默认报告路径带 `.dsh.` 或 `.codex.`，不会互相覆盖；重复评审保留各次原始记录与区间。不同 Provider/模型之间的绝对评分不能直接当作改善证据，只有同模型、同案例、同评分合同且通过证据指纹校验的重复样本才能与历史基线比较。人工批准门禁独立于模型评分。

### 2026-10-26 GPT Luna 6 Max 当前质量审查

首次执行同一份真实 Chrome PNG 的两次**隔离 `gpt-6-luna/max`**评审，分数分别为 **56、52/100**（中位数 **54**，波动 4）；`traceability` **1.5/5**、`composition` **2.5/5**、`hierarchy` **3/5**、`legibility` **3.25/5**、`boundaries` **3/5**、`consistency` **4/5**。首次及后续原始样本均保留在 `test-results/architecture-design-project/.visual-repeat-samples/` 内；默认的 `diagram-plugin-source-imports.codex.visual-repeat.json` 指向**最近一次**同模型报告，其 `reviewFiles` 可定位对应样本。首次 54 分才是 **Luna Max 旧版基线**，不能与先前 Codex default 的 44/100 直接比较。

与确定性基准核对：同一实际 12 节点 / 26 静态 import 关系，**65.7/90 结构分、1 处交叉、7 对独立重叠、9 条外围绕行、12.5px 适配字号**。当前余留问题按顺序：

1. **P0 · 高汇聚节点端口/通道资源**：`canvas` 有 **11 条实际入边**，集中到画布底部一个狭小节点，箭头难以区分；应在**同一个联合布局约束**中规划端口容量、节点尺度、进入走廊与终端分布，不能继续向现有单边路由追加 case-specific nudge。
2. **P0 · 真实可追踪性**：`architectureComposer → canvas` 的实际线路长 1084px，比直接路径多约 504px，在语义分区外绕行 252px；`architectureVisualPlan → architectureDesign` 多约 460px，且与两条去往 `canvas` 的真实关系重叠。需让全局候选优化直接惩罚**同分区外围折返、末端入边贴合和无法循线追踪的交叉**，同时保留节点/边 ID 与真实箭头方向。
3. **P1 · 主阅读路径与分区边界**：真实 `Composer → VisualPlan → canvas` 重点链路虽有粗边框，但 26 条同色连线的视觉强度相近；单个「核心应用」虚线框外多条线折返，分区语义不清。可基于真实关系提供**默认可读重点视图 + 完整关系视图**（不丢失任何关系），以及只针对证实语义的分区层次，不可编造组件分组或业务路径。
4. **P1 · 缩放后可读性**：节点正文基本可认，但箭头、关系端口和分区标题小；在 Chrome 的实际展示尺寸下分别验收 100% / fit、移动端适配和 SVG 导出。不得通过缩字、隐藏真实边或绘制不真实的共享总线换取质量分。
5. **P2 · 计算效率和跨图泛化**：上述 12/26 例端到端约 10–11 秒，继续扩大 brute-force 候选不可接受。全局优化应有有界复杂度、同义场景不回退，并同时过 20 例扩展集、实际 Chromium、两次同模型独立像素复评。

下一阶段首先做 P0 的**端口容量与节点/走廊联合约束原型**，只在完整真实 Canvas 的交叉、重叠、穿节点、字体、路长和耗时综合净收益明确时替换旧搜索；旧试验路径随替换删除，不能维持双轨生产路由。主观像素评审达标前仍保持 `approval=pending`。

六维评分包括主次阅读路径、依赖可追踪性、字体可读性、留白/对齐、分区边界和视觉一致性，总分 100。无人评分是 `null`，模型评级不能伪装人工 `approval=approved`；最终交付必须通过机器几何、当前像素指纹和真实人工批准。

## 宿主安装与验收

### 跨图表复用的质量闭环（2026-10-26）

- `src/diagramQuality.ts` 为 **Canvas + 19 类 Mermaid** 提供一个统一的、可序列化的 `DiagramQualityReport`：引擎与类型、是否需要修订、源/实际几何证据、问题代码/严重性/定位、原始数值指标、独立视觉审查状态和人工批准状态。它**适配**已经存在的 `canvasQuality` 与 `mermaidQuality`，不重复解析语义，也不引入第二个渲染/路由引擎。
- MCP `diagram.inspectQuality` 在保留旧 `issues/metrics/needsRevision` 字段的同时增加 `summary`。Mermaid 的源码级检查只能回报 `geometry=not-measured`、`visualReview=not-assessed`、`humanApproval=not-approved`，不得用“源码检查没有警告”冒充浏览器测量和质量交付。Canvas 原有架构审查阻断项保持权威。
- Mermaid 编辑器的“建议拆图”消费同一质量报告；`pnpm visual:smoke` 浏览器实际渲染会给出含宽高、文字溢出、节点/标签重叠的 `qualityReport`，并检查它没有伪造人工批准。浏览器几何检测仍有 Mermaid 类型差异和选择器覆盖限制，不能代替真实像素审美评价。
- 复杂场景夹具从 12 个扩展到 **20 个**，覆盖所有 **19 种 Mermaid 类型**。Chrome 实测：默认模板 19×2=38 次渲染；复杂场景 20×2=40 次渲染；固定像素黄金图从 24 张扩展到 **40 张**（旧 24 张原封不动）。`tests/diagramSkills.test.ts` 以数据驱动方式阻止未来添加图表类型却缺少场景或黄金图；新增质量映射单测覆盖 19 种引擎、真实 Canvas 报告及失败证据，测试方法合计保持在 **300 条以内**。
- **下一步**：用统一报告定位每种图表真实失败点，再优先抽取流程、状态、类、ER 与 Canvas 共用的纯测量/几何能力；仍由专业图表保留各自合法语法和渲染布局。不要把架构图整套正交路由搬进桑基图、时间线或数据图，也不要将所有 Mermaid 强制迁移为 Canvas。

**共享几何与可执行整改依据（第二阶段）**：`diagramGeometry.ts` 的纯矩形检测同时用于 Canvas 节点相交与 Mermaid Chrome 证据，不改变原来的 2px 内缩、浏览器重叠阈值和内容容差。`DiagramQualityReport.repairSuggestions` 针对不同图表与具体已观测问题给出 `source/layout/presentation` 目标和约束，全部标记 `automatic=false`；它不是已经自动完成修复，更不能擅自删减源数据/关系。通过 `pnpm visual:quality:report` 将 19 类专业图表、20 个场景 × 明暗主题的实际 Chrome 观测写入忽略目录 `test-results/diagram-quality/mermaid-types.json`。发现雷达标题/轴标签 1 处警告；桑基文本增强描绘造成的 22 对重复 SVG Text 已按相同文本与几何去重，证实为 0 个独立碰撞；保留图片样式与原文数据不变。下一步针对有真实证据的文字排版与标签问题做保真 A/B 修复，仍需独立视觉评审与人工批准。

**首个问题驱动修复案例**：Chrome 真实雷达图顶部轴标签与标题相交 1 处。对渲染配置的 `marginTop` 进行 56/72/88px A/B（旧值 44px）：三者均清除文字冲突，仅 56px 额外增加 12px 高度，故采用 56px 并更新对应明/暗像素基准。该修改保持 Mermaid 源文件、维度与数值不变；完整图表 Chrome 几何和像素门禁仍执行。这是手工经 A/B 证明的修复，尚非自动修改管线或 Luna Max 人工批准。

**展示参数自动 A/B 选择（第三阶段）**：`pnpm visual:quality:ab` 在同一套 Chrome/真实 SVG 测量链路中，针对有证据的雷达图文字碰撞、流程图关系标签重叠分别生成至多两个局部展示参数候选；候选仍使用相同 Mermaid 源码、真实数据、主题、语义和渲染器。两个主题同时比较文字溢出、节点/标签/文本重叠，要求各项不退化、总改善严格大于零、画布宽高最多增加 15%，并优先选择等效收益下的较小面积。推荐仅写入忽略目录 `test-results/diagram-quality/presentation-ab.json`，`applied=false`，**不自动覆盖图表、不改生产配置、不宣称视觉审批**。在当前全部 20 个复杂案例上没有额外几何候选，0 项改动是正确结果。为证明流程确实能选出方案，通过明确实验旗标 `node scripts/visual-smoke.mjs --source-dir tests/fixtures/visual-stress --quality-benchmark --presentation-ab --ab-radar-margin=44 --report-file=test-results/diagram-quality/reproduced-radar-ab.json` 复现旧雷达图 44px 布局，两主题各有 1 处碰撞，Chrome 自动从 56/72px 方案中选择 56px，冲突均归零，并拒绝改变 Mermaid 源码。禁止将实验旗标产生的质量信号混称为当前生产质量。

**更多语义图复用与真实 SVG 证据修复**：A/B 增加状态图、类图、ER 图的节点拥挤与关系标签拥挤的有界间距候选，仍仅由**实际浏览器已报告的重叠**触发，不改变源图。原候选检查错误地把 Mermaid `width="100%"` 的合法 SVG 误判为 100×0；已将标准 `viewBox` 解析集中到 `diagramGeometry.readSvgDimensions`，加入百分比根尺寸和空白字符回归。根据本机 Mermaid 11 类图 v3 的真实代码，节点/层次间距从 `state` 配置读取而非 `class` 配置（安装依赖 `chunk-TICWLB2K.mjs` 的 `draw`），修正候选实际写入路径。通过**临时注入探针信号且立即还原代码**的 Chrome 验证：状态图原尺寸 900×874，节点间距候选变为 912×874/924×874；ER 原尺寸 1478×916，候选变为 1550×916/1622×916；类图原尺寸 2665×541，候选变为 2665×571/2665×601。全部有效 SVG，但由于原场景没有真实碰撞，这些候选**均未采纳**。探针文件仅存于忽略的测试结果，不得将模拟问题信号视作产品真实质量问题。

**关系标签与实际路径遮挡（第四阶段）**：`diagramBrowserGeometry.measureMermaidRelationOcclusion` 通过真实 Mermaid `data-id` 关联边标签与曲线，用 SVG 路径弧长采样投影到浏览器坐标，对严格内缩的矩形进行线段交集判定，**排除标签自己的真实关系**；同时检查关系标签覆盖其他节点。Chrome 自检 fixture 证明自己的边穿过标签不计错、外来关系才计错、移出后两项归零。路径预先采样并按屏幕坐标包围范围剪枝，避免对无关标签反复作线段判定。现有 20 个复杂场景中的 **ER 图首次发现两处其他线路穿过实际关系标签**，明暗主题一致，报告保留真实关系 ID；以前仅检查标签对标签、节点对节点而漏掉此问题。原 `rankSpacing+12/+24` 均未减少 2 处冲突，改为以实际问题驱动优先搜索节点间距：`nodeSpacing+12` 两主题各剩 1 处，`nodeSpacing+24` 两主题各剩 **0 处**，宽约 **1478→1622px（+9.7%）**，高仍 916px，其他基础冲突保持为零。正式 `pnpm visual:quality:ab` 推荐 `er-nodeSpacing+24`，报告 `applied=false`；**仅属机器几何改进，不等于独立 Luna Max 评分或人工批准**，未擅改项目 Mermaid 源图或全局渲染参数。浅色主题的真实前后像素对照已存放在忽略目录 `test-results/diagram-quality/review/er-15-entities-{original-light,node-spacing-plus24-light}.png`，便于后续人工审查。

**Codex：** `pnpm plugin:install` 安装源码版本；Desktop 已开启时使用 `pnpm plugin:install:desktop` 刷新。公开 npm 版通过 `npx -y @weimin96/diagram-plugin@latest install --codex` 安装。注意不要同时开启 `diagram-plugin-local` 与 `diagram-plugin-npm`。

**DSH Desktop：** 退出 Desktop、运行 `pnpm build`，再执行：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "file:/绝对路径/diagram-plugin/package"
```

如果同版本缓存未刷新，先用 `dsh plugin --profile desktop remove @weimin96/diagram-plugin` 移除旧的本地安装，再重新安装。DSH Web 使用独立的 `--profile web` 安装配置，不能视为自动继承 Desktop。宿主窗口使用独立会话的 MessagePort 与后端协作，不能把模型传来的任意路径作为工作区授权。

双宿主真实交互验收至少包含：图表打开、新建、保存重开、SVG/PNG 导出；AI 会话跟随；修改前 Proposal、接受/拒绝；项目会话互不串数据；两个实例基于旧 revision 保存时报告冲突；历史文件可读取。`check:hosts` 不能替代以上原生桌面操作。

## 发布

CI 配置为 `.github/workflows/publish-plugin.yml`，正式包 `@weimin96/diagram-plugin`，使用 npm Trusted Publishing OIDC。发布前必须保证版本号与 Git tag `diagram-plugin-v<version>` 一致，并实际通过：

- TypeScript、全量单元与宿主集成测试；
- 核心、扩展与真实项目架构审查资格；
- 构建、冒烟与双宿主 npm tarball 验证。

当前真实项目已通过机器几何审查资格，**但独立像素评价仍低、人工尚未批准**；CI 的 acceptance 是自动几何门禁，不是人工签署，触发发布前必须完成真实 Chrome/DSH/人工复核。不要把自动门禁通过冒充专业视觉交付。正式安装及发布确认不等同于 Git commit 或本地构建。新包需要预先配置 npm Trusted Publishing 与 GitHub Actions OIDC。

本地校验发布包：

```sh
pnpm build
mkdir -p release
npm pack ./package --ignore-scripts --pack-destination release
node scripts/check-deepseek-package.mjs release/*.tgz
node scripts/check-codex-package.mjs release/*.tgz
```

DeepSeek 插件市场发现需要 npm `dsh-plugin` 关键词、`dsh.bundle` 元数据以及公开 GitHub 仓库 `dsh-plugin` topic；具体字段以构建与检查脚本为准。**不要**为了移除兼容代码而使旧 `.diagram.json` 丢失可读性；涉及真实已发布格式时采用经过验证的显式迁移，不增加永久双轨接口。
