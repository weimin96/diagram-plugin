# 开发与发布

面向维护者的开发、测试、构建与发布说明。用户安装和使用请看 [README](../README.md)。

## 项目结构

```text
src/                图表服务、React 编辑器与共享领域逻辑
  hosts/            Codex / DeepSeek 宿主适配层
  diagramSkills/    19 种 Mermaid 图表的生成与修改规则
  canvasPlayback.ts Canvas 绘制回放的纯计划算法
  ReviewPanels.tsx  候选修改、历史、Git 影响审查面板
  reviewTypes.ts    审查面板与主工作台共享的结果类型
integrations/deepseek/  DeepSeek 插件入口、客户端与 locale
manifest/           Codex 插件清单与 MCP 配置
scripts/            构建、安装、冒烟与视觉回归脚本
tests/              单元测试、宿主集成测试与视觉基线
docs/               维护者文档与 README 截图
```

核心约定：

- 模型与图表面板共享同一个图表服务实例，面板不复制编辑器、存储或 Proposal 实现。
- 画布回放计划独立于 React 编辑器，可单独测试；审查面板从主工作台拆分，仍共享原有状态和请求。
- 大画布的连线标签避让和节点重叠检测采用临时矩形空间索引，避免每个候选位置扫描所有图元；布局结果与原有精确矩形相交判断一致，不持久化索引。
- Canvas 语义投影以离散 LOD 等级而非连续缩放值作为重新计算条件；同一等级内的平移和缩放不会重复执行语义投影。
- 不需要视口裁剪的静态画布只在图形、语义等级或选中关系变化时更新标签布局；折叠关系和捆绑线在几何变化时更新。拖动中的临时图形和已裁剪大图仍计算实时布局。
- 大画布视口裁剪复用静态投影的节点、关系与折叠映射，超大画布（超过 6000 个可绘制节点）才使用空间索引查询，其余继续线性过滤；保留图层顺序及选中节点、连线端点。缩略图节点云路径不再随平移反复生成，拖动中的几何修改仍走实时裁剪。
- 连线视口裁剪不仅保留端点可见的连线，还保留实际路径穿过视口、但两端节点都在视口外的连线，以及独立起止点连线。先排除包围盒远离视口的关系，再检查实际路径；不因优化性能而截断跨屏关系。
- 视口裁剪只对两端都不可见的关系做路径相交检测；稳定投影中的节点查找表可复用，避免平移时对全部连线重复计算跨屏几何。选中节点不改变可见集合和选中关系时，复用已有关系标签避让布局，选择连线、编辑图形、拖动及改变视口可见集合会使其失效。
- Canvas 节点的纯 SVG 图案、图标与文字由 `React.memo` 独立复用；选中状态、播放中的文字和几何变化使其按需更新，外层拖动、锚点与缩放手柄继续实时响应。此前 360 节点的 React Profiler 比较来自**开发构建**，不能据此判断生产环境 FPS。
- 连线的可点击路径、描边和标题使用独立 `React.memo` SVG 子树；关系选中、标签拖动及端点编辑仍留在父级，避免更新视口时重新渲染不变的笔画。
- Chrome 性能排查用 `pnpm perf:canvas`：自动启动独立无头 Chrome，**使用 React 生产模式**在 360 节点 / 512 连线图上往返缩放 12 次，汇总 JavaScript FunctionCall、SVG Layout 和 Paint 耗时；需要 DevTools 原始轨迹时用 `pnpm perf:canvas -- --trace /tmp/canvas-trace.json`。不使用虚拟时间，也不以 React 开发构建的 Profiler 数字推断发布版本 FPS。
- 同一工具可用 `pnpm perf:canvas -- --nodes 3000 --drag` 验证真实浏览器指针拖动（16 次移动、最终提交）、SVG 图元规模和 JS 堆内存；也可指定 `--nodes 1200` 测量缩放。场景属于合成压力基准，绝不能把 JS 单任务耗时等同于整体 FPS。
- `pnpm perf:canvas -- --nodes 3000 --detail --drag` 先放大至完整细节视图，再真实拖动验证：对于视窗裁剪且超过 1000 条关系的详细视图，拖动期间稳定复用未变化的关系标签布局；移动节点关联的自动标签跟随位移，结束拖动后恢复精确全量避让。LOD、视窗可见关系集或场景变化时不复用过期布局。
- `pnpm perf:canvas -- --nodes 3000 --detail --select` 测量 16 次真实节点点击，验证至少 8 个不同节点被选中，且没有变化的连线标签布局未漂移；`--pan` 使用真实指针平移检查视口位置。基准使用与插件一致的 Tailwind 编译样式，否则节点选中后属性检查器可能遮挡测试画布，产生错误的性能数据。CSS 正常加载时，3000 节点详细视图的选择测试中 JavaScript 总耗时从约 906ms 降至 262ms（同机重复 A/B 测得），不等于整体帧率提升。
- ≥3000 节点的画布在默认 100% 缩放优先使用现有语义概览，临时抽样至约 640 个节点；继续放大可进入完整紧凑/详细视图，选中元素会被强制保留，不修改原始文档。此策略避免在视觉上看不清内容时挂载数万 SVG 子元素。
- SVG 连接锚点只在节点被选中、处于连接模式或被指定为连线起点时挂载；普通选择模式下未选中的节点不再生成不可见锚点。360 节点的相同测试场景中 SVG 子元素由 9913 降至 8113，保留连接模式下的悬停锚点，不以该数量下降直接推断帧率提升。
- Mermaid 使用同一个渲染队列串行完成初始化与渲染，避免模板缩略图和编辑器预览互相覆盖全局配置。新建图表的模板缩略图只在进入可见区域时渲染，已卸载的请求在入队执行前跳过。
- 面板在浏览器后台或被宿主隐藏时暂停会话跟随、图表发现和 revision 轮询；重新可见时恢复同步，正在进行的 AI 新图表监听不受影响。
- Mermaid 直接读写 `.mmd` / `.mermaid`；Canvas 保存为 `.diagram.json`，两者共用保存、revision 与导出链路。
- 服务端写入采用进程内队列、跨进程工作区锁与 revision 检查；锁位于系统临时目录，只保证同机同用户下的多宿主互斥。
- 会话选择、未确认的 Proposal 等状态只在当前服务进程保留；超过 24 小时不访问或进程内活跃会话超过 512 个时进行惰性清理，不影响已经保存的图表文件。

## 本地开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm check:hosts
```

- `pnpm build` 生成 `package/`，其中同时包含 Codex 的 `.codex-plugin/plugin.json`、`.mcp.json` 与 DeepSeek 的 npm 包入口。
- `pnpm test` 运行领域逻辑单元测试；`pnpm check:hosts` 覆盖工作区越界拒绝、内部工具过滤、会话隔离、并发 revision 冲突与 Proposal 确认流程。
- `pnpm smoke` 检查构建产物中的关键 UI 资源、MCP 标记、npm 元数据与 locale 文件。

## 视觉回归

```sh
pnpm visual:smoke       # 真实 Chrome 渲染全部 Mermaid 模板，捕获 lexer / 渲染兼容问题
pnpm visual:benchmark   # 复杂样例的尺寸、文字越界、节点重叠与拆图建议
pnpm visual:styles      # 12 套样式 × 19 种图表 × 明暗主题
pnpm visual:regression  # 固定画布像素 golden 对比
pnpm visual:verify      # 依次执行以上全部检查
```

像素基线存放在 `tests/fixtures/visual-baseline/`，只有确认视觉改动符合预期后才运行 `pnpm visual:regression:update` 重建。失败时诊断图写入 `test-results/visual-regression/`。

## 本地安装

### Codex

```sh
pnpm plugin:install
```

脚本会注册本地 marketplace 并安装 `diagram-plugin@diagram-plugin-local`。Codex Desktop 已打开时可用 `pnpm plugin:install:desktop` 顺便刷新宿主。

### DeepSeek Harness

当前目标为 Desktop `0.2.1-rc.2`，按本机安装包内的接口核对；其他版本需要重新验证。先完整退出 Desktop，再执行：

```sh
pnpm build
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "file:/绝对路径/diagram-plugin/package"
```

随后重新打开 Desktop。不要为同一个 Diagram 再配置通用 MCP 客户端，避免重复工具或模型与面板连接到不同实例。同版本的 `file:` 依赖可能继续使用已安装副本；开发中重新构建后，需要先 `plugin --profile desktop remove @weimin96/diagram-plugin`，再重新添加，并确认插件已进入 `dsh.profile.bundles`。

Web 使用同一份 DeepSeek Client 与 MCP 服务，不需要独立的 Web 编辑器。将 `--profile desktop` 换成 `--profile web` 后启动 `dsh web`；Web 侧需单独检查 Web profile 是否安装插件。客户端在同一应用实例的多个会话之间复用静态画板 HTML，但每个会话都必须重新建立独立的 MessagePort 和宿主绑定。面板的工作区由当前会话确定，不能自行切换到其他目录。

原生验收至少覆盖：

- 安装后从聊天标题区打开 Diagram，能看到当前项目的图表。
- 新建 Mermaid 与 Canvas，保存、重开并导出，操作的是同一份文件。
- 聊天调用图表工具后面板跟随；已有图修改先形成 Proposal，接受前文件不变。
- 两个项目聊天之间的图表、选区与 Proposal 不串用，主题切换同步。
- Codex 与 DeepSeek 基于旧 revision 保存同一张图时，必须有一个请求明确报告冲突。

## 宿主适配

| 位置 | 职责 |
| --- | --- |
| `src/hosts/types.ts` | 编辑器使用的宿主合同 |
| `src/hosts/codex.ts` | MCP Apps 与 OpenAI 扩展 |
| `src/hosts/deepseek.ts` | 与 DeepSeek 标签页通信的 MessagePort |
| `src/hosts/serverContext.ts` | 带宿主命名空间的会话与绝对工作区 |
| `integrations/deepseek/host.mjs` | stdio 子进程、模型工具与经过宿主认证的面板接口 |
| `integrations/deepseek/client.mjs` | 原生右侧标签页、共享编辑器与 Session Controller |

DeepSeek 模型工具注册为 `diagram_create` 等名字，内部工具只供面板调用。画板运行在不含 `allow-same-origin` 的 sandbox iframe 内，通过父窗口核验与独立 MessagePort 交换请求，不接触宿主认证凭据；面板接口挂载在 DeepSeek Connection 的 `/api` 路径下，沿用其认证、来源检查与 owner 限制。

新增宿主时实现 `DiagramHost` 所需的能力并在入口选择适配器。缺失的消息、文件打开和下载能力应显式声明；宿主必须从真实会话取得身份与工作区，不能把模型参数中的会话标识当作权威。

## 发布

正式包名为 `@weimin96/diagram-plugin`。发布流程：

1. 更新根目录 `package.json` 的版本号并提交。
2. 推送 `diagram-plugin-v<版本>` 标签，或手动触发 `publish-plugin.yml` 并填写相同版本。
3. 工作流执行类型检查、构建、冒烟、宿主集成测试与 DeepSeek、Codex 双宿主 npm tarball 验收，然后发布 tarball。

本地验包：

```sh
pnpm build
mkdir -p release
npm pack ./package --ignore-scripts --pack-destination release
# 文件名中的版本号来自根目录 package.json，例如 0.20.0
node scripts/check-deepseek-package.mjs release/weimin96-diagram-plugin-<version>.tgz
node scripts/check-codex-package.mjs release/weimin96-diagram-plugin-<version>.tgz
```

同一个包包含 DeepSeek Harness 的 `dsh` 元数据和 Codex 的 `.agents/plugins/marketplace.json`、`.codex-plugin/plugin.json`、`.mcp.json` 及 `bin/diagram-plugin.mjs`。Codex 安装器使用 `CODEX_HOME`（默认 `~/.codex`），将发布产物持久化后注册本地 marketplace；CI 在临时 `CODEX_HOME` 内真实运行 Codex CLI，验证首次安装、重复安装和插件启用状态，绝不操作维护者的正式 Codex 配置。发布后用户执行 `npx @weimin96/diagram-plugin@latest install --codex`。

发布使用 npm Trusted Publishing（OIDC），不配置长期 `NPM_TOKEN`。新包需要先通过交互式 `npm login` 完成首次建包，再执行 `npm trust github` 绑定仓库 `weimin96/diagram-plugin`、工作流 `publish-plugin.yml`，权限为 `publish`。工作流当前显式关闭 npm provenance（`--provenance=false`）。

### 插件市场发现

社区市场通过两条独立通道发现插件，发布包必须同时满足：

- **npm 关键词**：`keywords` 首个为 `dsh-plugin`，且声明 `dsh.bundle`；缺任一项不会被收录。
- **GitHub topic**：仓库需公开并设置 `dsh-plugin` topic。

兼容性由 `engines.dsh` 单独决定，当前为 `>=0.2.0-rc.1 <0.3.0-0`；比较使用 `includePrerelease: true`，且禁止 `workspace:` 前缀。展示信息来自 `package.json` 的 `icon` 与 `locale/<lang>.json` 的 `meta.title` / `meta.description`，必须通过 `exports` 暴露。`scripts/check-deepseek-package.mjs` 与 `pnpm smoke` 会断言这些字段。

## 兼容性

Canvas 文档类型与 Mermaid 样式指令保留向后兼容：读取时同时接受 `codex-diagram-canvas` 与 `%% codex-diagram:style=`，写入时统一使用新前缀，旧图可直接打开并在首次保存后迁移。最近工作区状态优先写入 `~/.diagram-plugin`，并回退读取 `~/.codex-diagram`。

改名前的 `@weimin96/diagram-deepseek` 与正式包是不同包。已安装旧插件的用户应先移除旧插件，再安装新包，否则会重复注册 Diagram 标签页和工具。

## 架构图布局实验（仅开发环境）

目前的正式生成逻辑仍使用 `architectureComposer` + 内置正交路由。ELK Layered 是隔离的开发试验，没有加入 `src/server.ts`，不会自动影响现有用户图表。

- 快速基准：`pnpm benchmark:architecture`，5 个参考架构，会在生成节点重叠/穿节点时失败；已加入 npm 发布门禁。
- 扩展基准：`pnpm benchmark:architecture --suite=extended`，20 个参考/合成场景，重点检查输入顺序、中文长标签和高扇出；合成用例并非用户生产拓扑。
- 压力样例：`pnpm benchmark:architecture --suite=stress`，30/50/80 节点，运行成本较高，不放到默认 CI。
- 对比试验：`pnpm benchmark:architecture:engines`，或 `pnpm benchmark:architecture:engines --suite=extended`。输出 `test-results/architecture-engines/index.html`、`report.json` 及各候选的可编辑 Canvas JSON 与 SVG。支持 `--case=data-platform` 只跑单例。

ELK 平铺与复合分组候选仅修改节点坐标，再使用当前 Canvas 正交路由，**尚未接入 ELK 原生端口/边线**。报告额外记录画布尺寸、宽高比、分组边界重叠、总线长和文字适配字号。时间字段口径不同：`current` 包含整套候选搜索与优化；`elk-*` 仅包含在已完成的 Canvas 图上再次布局与布线，不能当作整体生成速度 A/B 结论。

初次 20 例实验统计：原引擎累计交叉 5、重叠 44；ELK flat 累计交叉 21、重叠 75；ELK compound 累计交叉 56、重叠 52。当前不得据此替换默认布局引擎，后续应重点验证原生端口、复合分区、不穿节点与复杂图阅读顺序，并在同一准备阶段重新计时。已识别原引擎在合成的 `business-platform-fanout` 有一处穿节点，属于待修复的扩展质量缺陷，不能用放宽门禁掩盖。

ELK 0.12.0 当前只作为 devDependency 引入。其许可标识为 `EPL-2.0 OR GPL-3.0-or-later`，在考虑把 ELK 打包进发行版前，必须完成授权条件与第三方声明核查。
