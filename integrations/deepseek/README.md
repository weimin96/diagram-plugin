# Diagram Plugin

在 Codex 与 DeepSeek Harness 的聊天右侧创建、查看和编辑 Mermaid 图表与 Canvas 画板。图表以纯文本保存在项目的 `docs/diagrams/` 中，可读、可 diff、可版本控制。

## 安装

### Codex Desktop / CLI

安装 Codex CLI 与 Node.js 22+ 后运行（npm 包 `0.20.1` 及以上）：

```sh
npx @weimin96/diagram-plugin@latest install --codex
```

安装器自动注册 Codex marketplace 和 MCP 服务，无需拉取源码或安装 pnpm。完成后重新打开 Codex Desktop。

### DeepSeek Harness

在 DeepSeek Desktop 的「插件 → 添加插件」中输入：

```text
@weimin96/diagram-plugin
```

也可以完全退出 Desktop 后，使用自带的 `dsh` 命令安装：

```sh
dsh plugin --profile desktop add @weimin96/diagram-plugin
```

重新打开 Desktop，在项目聊天标题栏点击 **Diagram**，或让助手调用图表工具打开画板。此包已包含编译产物，不需要克隆仓库、构建或单独配置 MCP 服务。

> 不要为同一个 Diagram 再配置通用 MCP 客户端，以免创建重复实例。

## 功能

- 19 种 Mermaid 图表：流程图、时序图、思维导图（脑图）、类图、ER 图、状态图、甘特图、时间线、Git 分支图、用户旅程、四象限、看板、需求图、桑基图、XY 图、饼图、雷达图、矩形树图、鱼骨图。
- Canvas 画板：架构、流程和自由画布三种工作台，支持节点、连线、分组、泳道、对齐与导出。
- 对话联动：助手读取、创建或修改图表后，右侧面板自动跟随。
- 可审查修改：AI 对已有图的修改先生成 Proposal，确认后才写入磁盘。
- 安全写入：会话与项目状态隔离，保存时检查版本冲突。
- 源码绑定：Canvas 节点可关联真实源码文件，并分析 Git 改动的影响范围。
- 专业架构生成：模型提供节点角色与真实关系，通过 `diagram.composeArchitecture` 一次完成专业风格选择、自动布局、正交连线、质量检查和保存，不需要模型逐个计算节点坐标。默认采用克制的低饱和色彩；忠实重绘参考图片仍使用原有 Canvas 路径。
- 设计质量检查：除了重叠和交叉，还会提示重复产品卡片矩阵、互不连通的高扇出中心和只有分层背景却没有跨层关系的图表。不会为了通过检查自动虚构调用关系。
- 多候选布局：专业架构会对自动推断的结构和紧凑程度尝试有限个确定性候选，按碰撞、边线交叉、外围绕线和画布可读性选择；返回的 `architectureEvaluation.structuralScore` 最高只有 90，是程序结构启发式分数，**不是视觉审美的百分制评分**。新架构使用浅色语义节点，避免大面积高饱和度色块。
- 局部线路收敛：候选布局选定后，最多执行三轮有界 reroute，只针对交叉、重叠、穿节点或超长绕线涉及的关系边；质量没有严格提升则不保存候选，节点位置和原始语义关系始终不变。
- 架构质量基准：运行 `pnpm benchmark:architecture`，对五类虚构参考拓扑生成可编辑 `.diagram.json`、独立 `.svg`、`report.json` 与 `index.html` 视觉对比页，默认输出在被 Git 忽略的 `test-results/architecture-benchmark/`。数值只代表几何/结构启发式，视觉仍需人工检查。
- 生成布局对比：对于事件驱动、数据平台和云部署类拓扑，会额外比较中心辐射构图；先评估每种构图的最优密度，再分别执行有界连线路由修正，最终根据**修正后的**结构评分选图，避免增加新候选使已通过的旧案例退化。

## 兼容性

本版本面向 DeepSeek Harness Desktop `0.2.1-rc.2`，已在 macOS 原生应用中验证模型工具、面板、Mermaid、Canvas、Proposal 和重启后的文件读取。Windows、Linux 及其他宿主版本尚未完成原生验收。

使用 Desktop 自带的运行时；独立 Node.js 运行环境需为 Node.js 22 或更高版本。

已保存文件可以在重启后重新打开，当前图选择和未确认 Proposal 为进程内状态。

## 开发与许可

源码、开发说明与问题反馈：<https://github.com/weimin96/diagram-plugin>

基于 MIT License 开源。第三方资源声明见包内 `THIRD_PARTY_NOTICES.md`，依赖的许可注释保留在构建产物中。
