# Diagram Plugin · 收敛后的开发路线（R1—R4）

本文是**当前执行路线**，历史实验和详细测试命令见 [development.md](./development.md)，长期不可破坏的产品约束见 [AGENTS.md](../AGENTS.md)。不要把已通过机器几何门禁的实验候选写成已获人工视觉批准。

## R1 · 布局操作合同与真实评测集（当前执行）

**约束语义**（`src/architectureLayoutContract.ts`）：

| 操作 | 真实入口 | 允许改变哪些布局几何 | 必须保持什么 |
| --- | --- | --- | --- |
| `generate` | `diagram.composeArchitecture` | 新建节点的大小/坐标、画布大小由布局决定 | 可信语义关系和合法的可编辑 Canvas 文档 |
| `reflow` | `diagram.beautifyArchitecture` 且 `relayout=true` | **用户显式请求后**，未锁定节点、分区及画布可重新规划 | 已有节点/关系 ID、方向、人工锁定节点几何、revision/保存合同 |
| `edit` | `diagram.routeArchitectureEdges`；美化时 `relayout=false` | 连线端口、折点以及明确选择的展示属性 | **所有现有节点位置/大小、画布大小**，真实关系、锁定节点和原始文件版本 |

该模块现在在三个真实 MCP 写入入口**保存前执行不变量校验**；它没有启用自动扩容/ELK 等新布局算法。生成/整体重排可以有不同候选搜索空间，但共享语义保真、最终可编辑场景质量与真实像素审查，不对已保存文档默认触发重排。局部点选拖动、创建和用户自主改变尺寸由 Canvas 编辑器与其已有 Patch/历史/revision 合同管理，不能错误套用“只改线”的 `edit` 门禁。

**真实评测审计**：

```sh
pnpm benchmark:architecture:corpus
# 仅在至少 3 个相互独立的真实来源且 >=20 条经验证任务时，才允许通过跨项目证据门禁：
pnpm benchmark:architecture:corpus:gate
```

`test-results/architecture-corpus/audit.json` 明确记录输入来源、图指纹、圈/汇聚结构与独立仓库数量。默认 23 组：**同一真实仓库的 3 组 AST 静态 import 子图、5 个虚构参考、15 个合成变化**；默认独立仓库只有 1 个，显式标注分区的输入 0 个。后两类只作为防退化。`corpus:gate` 当前失败是预期、诚实的阻断，不代表已有测试失败。

跨项目代码依赖子图通过**显式指定本机已存在的 Git 仓库**获取，工具只读取 Git 跟踪的 TS/TSX，核对真实相对 import、源码路径/行号、当前文件 SHA-256、Git HEAD 与脏工作树状态；不收集源码全文、不开启全盘自动扫描、不根据命名推测关系。例如：

```sh
pnpm benchmark:architecture:corpus \
  --repo=ppt-plugin:/absolute/path/ppt-plugin \
  --repo=ai-drama-studio:/absolute/path/ai-drama-studio \
  --repo=template-market:/absolute/path/template-market
node --import tsx scripts/benchmark-architecture.ts --suite=external \
  --repo=ppt-plugin:/absolute/path/ppt-plugin \
  --out test-results/architecture-corpus/external-benchmark
```

本机实测 3 个独立其他仓库增加了 **6 组**有源码指纹的静态导入子图，总计 **4 仓库 / 9 组源码子图**；`ppt-plugin` 工作树有未提交改动，报告已单独标记，不能声称与 Git HEAD 完全相同。新增 16 节点、41–65 条关系的高密度案例揭示显著交叉和重叠退化，详情保存在忽略的 `test-results/architecture-corpus/`。这些**只证明真实静态源码依赖**，绝不是 9 个经用户认可的业务架构设计任务，也没有可证明的功能分区或主阅读路径。严格 `corpus:gate` 仍要求另外取得 20 个**来源和语义均可核对的实际架构任务**，不允许用代码 import 子图凑数。下一阶段应补充用户提供/授权的微服务、数据流水线、Agent/MCP、部署、业务链路任务描述，独立记录关系、分区与阅读意图；绝不生成虚假“真实样本”。

**业务架构任务单独验收（R1 已实现入口，尚无真实任务通过）**：`scripts/architecture-reviewed-tasks.ts` 从用户显式指定的 JSON 清单读取任务；每条包括 `id / repository / purpose / readingGoal / intent / evidence`。`intent.nodes[]` 必须有真实 `partition` 与 `evidenceIds[]`；`intent.relations[]` 必须声明 `from/to/evidenceIds[]`；`intent.primaryPath[]` 必须是这些真实边组成的有向路径。每条 `evidence` 使用仓库根目录下的 `relativePath`、**完整文件 SHA-256**、`startLine/endLine` 作为来源。解析器拒绝相对路径越界、重复 ID、未知证据、来源内容过期、行号无效和不连通主阅读路径。**文件哈希只证明字节，不证明代码支持这条业务语义；必须由审核人独立阅读后另行签署。** 审核记录是分开的 `version=1 / manifestSha256 / reviews[{taskId,reviewer,reviewedAt,decision}]` JSON 文件；变更任务原文后旧签署即过期，不自动生成、签名不可冒充身份验证或视觉批准。

```sh
# 所有路径均为显式给出的绝对路径，仓库标签对应 --repo
pnpm benchmark:architecture:corpus \
  --repo=myapp:/absolute/project-root --tasks=/absolute/tasks.json \
  --review-ledger=/absolute/reviews.json
pnpm benchmark:architecture:corpus:gate \
  --repo=myapp:/absolute/project-root --tasks=/absolute/tasks.json \
  --review-ledger=/absolute/reviews.json
node --import tsx scripts/benchmark-architecture.ts --suite=reviewed \
  --repo=myapp:/absolute/project-root --tasks=/absolute/tasks.json \
  --out test-results/architecture-corpus/reviewed
```

清单**即使源码验证通过，只要没有分离的批准审阅记录，就仍是 `pendingTaskReview`**；真实任务门禁需要至少 20 条审阅过且可复核来源的任务，且来自 3 个不同项目（源码 import 子图绝不计数）。审阅记录只用于业务语义核验，机器生成的 Canvas 仍需单独的 Chrome 像素质量和人工视觉签署。隔离测试已用非真实合成任务跑通审计与成图，输出在忽略目录 `test-results/architecture-corpus/pending-*`，没有误计入真实任务。

**R1 退出条件**：三个入口约束的正常/拒绝/锁定节点场景均验证；固定跨项目评测来源和用例清单、保留原有真实项目基准作为防退化；引入 20+ 经验证任务和至少 3 个独立来源之前，不能声称具有跨项目布局泛化证据。

## R2 · 以完整 A/B 取代局部补丁堆叠

只开发**一个有明确前置约束的联合候选**，同时考虑分区占位、层级顺序、节点端口容量及跨区线路走廊。先以 `generate` 模式验证，禁止为用户已有文件放宽 `reflow/edit` 的保真约束；ELK、D2 和 `partition-envelope-candidate` 仅为独立试验。输入相同的真实关系，比较最终 Canonical Canvas、SVG、截图、字号、分区、端点方向、线路追踪、稳定性及**完整生成耗时**。任一候选在多拓扑基准未显示整体净收益就停止，不再添加补丁轮次。

**R2 退出条件**：至少两个独立来源的不同拓扑有可重复、非偶然的可读性收益且不破坏原合同，再逐阶段删除被替换的旧优化循环。不要提前创建 LayoutEngine SPI，也不将开发期 `elkjs` 打入发布包。

## R3 · 优先解决图表可读性和编辑体验

让真实用户在不遗漏任何关系的前提下快速识别依赖方向、分区与主阅读路径，重点关注真实 Chrome 图中关系追踪性长期偏低的问题。Mermaid 的 19 个专业类型继续采用各自的渲染语义，通过现有 `diagramQuality` 与双主题 A/B 修复已有证据的文字/路径遮挡；例如 ER 图关系标签被其他连线遮挡，不应要求架构图路由器处理。

**R3 退出条件**：编辑/撤销/保存/重开/导出由真实 Codex 与 DSH Desktop/Web 验证；同模型独立图像评分只是证据，真正交付必须有人工批准。

## R4 · 性能与发布工程

对 Composer 阶段级 Profile，优先消除重复全图测量而不是叠加搜索；逐步按状态所有权分离超大的编辑器/应用组件，不因行数拆出空接口。版本发布需要类型、全量单元与宿主集成、实际用户流程、Chrome 证据、人工批准以及产物一致性。遵守 **300 条测试方法上限**，使用已有数据驱动测试扩展案例。

## 停止规则与协作

- 没有前后同源的完整 A/B、实际画面与可核对净收益，就不进入生产布局；失败候选撤销或保留在独立实验，而非追加默认路由分支。
- **不能**以结构分 90、零交叉、Luna Max 单次打分或 CI 通过代替视觉交付。
- 每阶段独立提交、输出输入来源与验收结果；不自动 Push/npm 发布。当前本地 `main` 大量提交未同步远程，需在后续集成节点经过人工许可后分阶段同步，不在 R1 工作中顺手发布。
