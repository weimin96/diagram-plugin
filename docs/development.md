# 开发、质量验收与发布

本文件记录当前可执行的开发流程。长期不变量和最终架构见 [AGENTS.md](../AGENTS.md)；历史实验的具体取舍可从 Git 提交查看，不再在本文逐轮堆积算法补丁说明。

## 架构与输出

- 语义入口：`diagram.composeArchitecture` 接收实际存在的节点、关系、证据和可选经确认的主路径、功能分区；`ArchitectureIntentGraph` 是权威输入。
- 构图：`architectureComposer.ts` 协调完整候选；`architectureDesign.ts` 负责场景/节点/分区；`architectureRouting.ts` 与 `architectureOrthogonalSolver.ts` 负责端口、线段和可见通道；`architectureRouteRepair.ts` 仅提出局部几何候选。
- 质量：`canvasQuality.ts`、`architectureRouteDiagnostics.ts`、`architecturePresentationQuality.ts` 和 `architectureVisualPlan.ts` 检查**最终** Canvas。`visualPlan.review.blockers` 是机器审查阻断的唯一输出，不得以未阻断的几何指标代替交付批准。
- 编辑与持久化：Canvas 使用 `.diagram.json`，Mermaid 使用 `.mmd` / `.mermaid`；`CanvasEditor.tsx` 与 `canvas.ts` 共用节点、箭头与端口语义。保存/重开、revision 冲突、提案审批、文件原子写入和人工作图不得被自动重排破坏。
- 密集架构图的节点属性面板会按实际有向关系列出入边（谁引用当前节点）与出边（当前节点引用谁），点击单条关系进入精准高亮；所有真实关系保持不变。`arch-*` 语义边界不会把单节点选择扩展为整组选中。Chrome 真实交互回归：`pnpm benchmark:architecture:relation-lens`。
- 宿主：`src/hosts/`、`integrations/deepseek/` 与打包层隔离 Codex、DSH Desktop/Web 差异，复用同一图表领域代码和画板。

下一阶段是**统一约束下的节点/分区/端口/走廊联合布局**。任何替代方案必须与现有 Canonical Canvas 合同进行同语义、同尺寸、同渲染/导出、同完整指标 A/B；未证明改善就撤销试验代码，不继续叠加条件路由器。ELK 和 D2/TALA 保留独立实验，不因单项指标较好或 native SVG 可看就进入正式依赖；还必须检查许可证与几何回灌保真。

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

## 架构生成质量与真实性

```sh
pnpm benchmark:architecture                # 五组虚构核心案例：基础几何
pnpm benchmark:architecture:review         # 20 组参考/合成案例：自动视觉审查资格
pnpm benchmark:architecture:project        # 当前仓库真实 import 子图，输出事实和诊断
pnpm benchmark:architecture:acceptance     # 同一真实图要求通过审查资格；已知失败则退出非零
pnpm benchmark:architecture:project:visual # 真实 Chrome 截图及人工审核清单
pnpm benchmark:architecture:relation-lens  # 真实 Chrome + React 聚焦交互
```

真实项目基准通过 TypeScript AST 解析 `src` 中固定的 12 个核心模块，提取 26 条直接静态 import（包含 type-only），不猜测运行时完整调用图。整改前基线：**12 节点、26 关系、2 处交叉、16 处独立重叠、32.6/90 结构分、0 穿节点**。同日经有界的**走廊协商 → 同分区节点槽位协商 → 再次走廊协商**（复用现有正交求解器与修复候选，并在每次采纳前检查完整 Canvas）后，机器实测变为 **1 处交叉、9 处独立重叠、56.9/90、0 穿节点、12.5px 适配字号**，总路线从初始 13,581px 降到 v0.21.0 的 13,414px；后续在原有候选评估中增加**相同结构评分下的外围绕行/线长比较**，进一步降为 12,872px（交叉 1、独立重叠 9、外围绕行 10、字号 12.5px，未删除任何依赖）。Canvas 编辑器和 SVG 导出都对实际主节点采用一致的浅色强调与字重，且保留用户定义的颜色。真实图机器审查资格不再阻断，但外围长绕行仍明显；DSH read_image 单次主观评分在不同运行中为 51.5、48.5、40.5，波动显著，**尚无人工批准**，不能据此宣称已经达到专业视觉交付质量。本轮扩大密集图的确定性候选覆盖范围（最多 32 条真实关系，优先冲突与外围绕行，再检查剩余独立关系），真实 12 模块 / 26 关系基准为 **结构 61/90、外围长绕行 9、交叉 1、独立重叠 9、穿节点 0、总线长 12,898px**；相比上轮线长略增 26px，端到端耗时约 8.5→10.2 秒。真实 Chrome 截图已生成，DSH 本轮独立读图为 47.5/100（仅单次波动参考），仍无人工批准。不要删真实关系、换成虚构案例或调低门禁换取发布绿灯。

`benchmark:architecture:review` 检查合成数据的防退化，不证明真实系统质量。所有图的自动报告必须保留节点/关系数、独立线路重叠、交叉、穿节点、分区框、适配字体、绕线长度和耗时；更改布局前后比较同一实际图与扩展集。机器准入只允许进入人工视觉审查。

**后续密集图优化基线（2026-10-26）**：在原有 Composer 约束评估中，对真实交叉/重叠关系做有界的双边联合重排，并在候选评分之前重新识别由实际路线形成的共享主干，避免以过期的 bundleKey 评价非最终几何。固定真实 12 节点、26 关系的指标为 **65.7/90、交叉 1、独立重叠 7、穿节点 0、外围长绕行 9、真实共享主干 2、总线长 12,601px、适配字号 12.5px**。与此前 61/90、重叠 9、线长 12,898px 比较，整体质量有净收益，计算耗时约 10–11 秒。自动审查资格通过，但**不是人工视觉批准**；剩余拥塞与外围长绕行仍需继续治理。

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

DeepSeek Harness 需要执行真实 `read_image` 工具调用并在原始 JSONL 中验证成功的图像结果；Codex 使用隔离的只读 PNG 输入、结构化 JSON 输出及证据指纹。只传提示词或让模型声称看到图不算像素评审。默认报告路径带 `.dsh.` 或 `.codex.`，不会互相覆盖；重复评审保留各次原始记录与区间。不同 Provider/模型之间的绝对评分不能直接当作改善证据，只有同模型、同案例、同评分合同且通过证据指纹校验的重复样本才能与历史基线比较。人工批准门禁独立于模型评分。

六维评分包括主次阅读路径、依赖可追踪性、字体可读性、留白/对齐、分区边界和视觉一致性，总分 100。无人评分是 `null`，模型评级不能伪装人工 `approval=approved`；最终交付必须通过机器几何、当前像素指纹和真实人工批准。

## 宿主安装与验收

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
