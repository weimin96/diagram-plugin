import { diagramSessionContext } from './hosts/serverContext.js'
import { diagramVisualStyleGuide, diagramVisualStyles } from './diagramVisualStyles.js'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server'
import { z } from 'zod/v4'
import { beautifyArchitectureScene, routeArchitectureEdges } from './architectureDesign.js'
import { composeArchitectureGraph } from './architectureComposer.js'
import { architectureDesignSkill, isArchitectureIntent } from './architectureSkill.js'
import { searchArchitectureNodeTemplates } from './architectureNodeTemplates.js'
import { assessCanvasVisualQuality } from './canvasQuality.js'
import { buildCanvasSubgraphContext, buildCanvasSubgraphPatch, canvasPatchRebaseReviewIds, mergeCanvasProposalSelection, rebaseCanvasSubgraphPatch, type CanvasSubgraphPatchInput } from './canvasPatch.js'
import { buildCanvasPatchHistoryEntry, CanvasPatchHistoryStore, redoCanvasPatchHistory, undoCanvasPatchHistory, type CanvasPatchHistorySummary } from './canvasHistory.js'
import { loadDiagramIcons, diagramGlobalEntrypoint } from './icons.js'
import { CANVAS_ROLE_ICON_IDS, CANVAS_STENCIL_IDS } from './iconRegistry.js'
import { parseCanvasScene, serializeCanvasScene, type CanvasArrow, type CanvasC4Type, type CanvasElement, type CanvasIcon, type CanvasIconRef, type CanvasNode, type CanvasNote, type CanvasScene, type CanvasStencil } from './canvas.js'
import { nextCanvasElementId, traceCanvasGraph } from './canvasOperations.js'
import { isCanvasIconRef } from './iconRegistry.js'
import { DiagramStore } from './store.js'
import { readGitChanges } from './gitChanges.js'
import { encodeToolResultFallback } from './toolResult.js'
import { addProposalBranch, selectProposalBranch, type ProposalBranchSet } from './proposalBranches.js'
import { buildCanvasPatchGraph, canvasPatchDependentClosure, composeCanvasSubgraphPatches, inferCanvasPatchDependencies } from './patchGraph.js'
import { diagramIntentRoutingGuide, diagramSkill } from './diagramSkills/registry.js'
import { skillPromptLines } from './diagramSkills/types.js'
import { assessMermaidVisualQuality } from './mermaidQuality.js'
import { diagramTypes, isMermaidDiagramType, type DiagramSurface, type DiagramType, type WorkspaceSnapshot } from './types.js'

declare const __DIAGRAM_PLUGIN_VERSION__: string

const version = __DIAGRAM_PLUGIN_VERSION__
const uiTemplate = 'ui://diagram-plugin/workspace-v{version}'
const here = path.dirname(fileURLToPath(import.meta.url))
const [appJs, appCss] = await Promise.all([
  readFile(path.join(here, 'app.js'), 'utf8'),
  readFile(path.join(here, 'app.css'), 'utf8'),
])
const uiRevision = createHash('sha256').update(appJs).update('\0').update(appCss).digest('hex').slice(0, 12)
const legacyUiUri = 'ui://diagram-plugin/workspace-v1'
const workspaceUiUri = `ui://diagram-plugin/workspace-v${version}-${uiRevision}`
const hostWorkspaces = new Map<string, string>()
const threadUiUri = `ui://diagram-plugin/thread-v${version}-${uiRevision}`
const icons = await loadDiagramIcons(path.join(here, '..', 'assets'))

const html = (surface: DiagramSurface) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${appCss}</style>
</head>
<body>
  <div id="root" data-diagram-surface="${surface}"></div>
  <script>${appJs}</script>
</body>
</html>`

const server = new McpServer(
  { name: 'diagram-plugin', title: 'Diagram Plugin', version, icons },
  {
    instructions: [
      'Diagram Plugin reads and writes Mermaid diagrams and Canvas documents in the workspace bound to the current conversation.',
      'diagram.thread is only the UI-open action. Call it when the user explicitly asks to open/show the right-side Diagram panel, or once before the first diagram operation in a conversation when no prior diagram.thread call exists.',
      'If diagram.thread has already been called in this conversation, NEVER call it again for later create/get/update/proposal/beautify requests. The existing panel follows thread state automatically; use data tools directly.',
      'A software/system/module/service architecture request is NOT a flowchart request. For architecture, system architecture, module architecture, service topology, dependency architecture, deployment-style views, or C4 views, create type=canvas with canvasWorkbench=architecture. Use canvasWorkbench=flowchart for manually editable process/decision boards and canvasWorkbench=freeform for general drawing. Ordinary architecture diagrams should use tight named boundaries and role/technology semantics without automatically adding C4 metadata. Use C4 person/software-system/container/component only when the user explicitly asks for C4 or the source/current diagram already establishes that hierarchy.',
      'Use type=flowchart only for an explicit process/workflow/control-flow/decision-flow request, or when the user explicitly asks for Mermaid/flowchart. Do not represent a software architecture as a Mermaid flowchart merely because it has arrows.',
      ...diagramIntentRoutingGuide(),
      'Before a non-trivial diagram creation or whole-diagram redesign, call diagram.designGuide once for the chosen type. It returns only that type’s composition archetypes, evidence rules, visual grammar and quality loop so the model does not need every diagram skill in context.',
      'For a NEW professional system architecture, prefer diagram.composeArchitecture: provide only evidence-backed semantic nodes and actual relationships; the plugin owns coordinates, grouping, orthogonal routing and quality checks. Do NOT hand-author a grid of repeated cards or x/y positions. For faithful visual tracing of a supplied picture, explicitly use the normal Canvas editing path and preserve the reference layout rather than forcing a redesign.',
      'When a confirmed technology or cloud service needs a concrete architecture node, use diagram.searchArchitectureTemplates to look up the built-in semantic role, iconRef and recommended boundary instead of guessing provider icon ids. Do not call it for unknown or generic components.',
      'All exposed Mermaid diagram types have a type-specific Diagram Skill. Preserve each type’s semantic grammar, density policy and anti-pattern rules instead of treating every diagram as generic nodes and arrows.',
      'For conversational edits to an existing diagram, prefer a reviewable proposal before writing. For Canvas changes that touch a finite set of elements, prefer diagram.proposeSubgraphPatch so only deltas are sent and authored geometry outside the impact scope is preserved. Use diagram.proposeUpdate for Mermaid, title/size/container metadata changes, or true whole-diagram rewrites. Use diagram.update directly only when the user explicitly asks to apply immediately.',
      'For edits constrained to selected Canvas nodes, use diagram.proposeSubgraphPatch. Put selected existing ids in elementIds; when the user intent explicitly changes a direct relationship, you may also include the relevant id returned in getSubgraph.directRelationshipIds. Treat getSubgraph.contextElementIds as read-only context unless the user clearly asks to expand the edit scope. Send only changed fields in updates, only new elements in adds, and removals in removeIds. Do not send unchanged x/y/width/height, arrow points or labelPosition. The legacy diagram.proposeSubgraphUpdate remains available for compatibility but should not be preferred.',
      'Create multiple Canvas proposal branches only when the user explicitly asks for alternatives or A/B comparison. In that case call diagram.proposeSubgraphPatch multiple times against the same base revision with distinct branchLabel values. Otherwise omit branchLabel so normal proposal behavior remains single-candidate.',
      'When the user explicitly asks to combine compatible proposal branches or independent parallel subgraph patches, use diagram.composeProposalBranches. It rejects conflicting writes instead of silently choosing one value; do not use it to merge mutually exclusive A/B alternatives unless the user requests that composition.',
      'Before a finite Canvas patch, prefer diagram.getSubgraph over diagram.get. getSubgraph separates scopeNodeIds, directRelationshipIds and contextElementIds, bounds node/relation counts, and returns only relevant Group/Lane metadata so large-diagram edits do not load the whole document. Use diagram.get only when the task genuinely needs whole-diagram state.',
      'Use diagram.trace for upstream/downstream graph exploration. When the user asks what current code changes affect, use diagram.impactFromGit so real staged/unstaged/untracked Git files are mapped through Canvas sourcePaths instead of guessed.',
      'Use diagram.upsertSourceNode after reading one real source file, or diagram.upsertSourceNodes after analyzing a set of files, when architecture nodes should be refreshed without rewriting the whole Canvas.',
      'When an architecture Canvas is visually flat, crowded, weakly grouped, or has crossing/overlapping relationships, use diagram.beautifyArchitecture. It deterministically adds architecture partitions, semantic tones, role/technology badges and orthogonal routing; do not try to solve those presentation problems only with prose prompting.',
      'If the node placement is already acceptable and only relationship lines need cleanup, use diagram.routeArchitectureEdges instead of beautifyArchitecture so node positions and partitions stay unchanged.',
      'After creating or materially redesigning a diagram, call diagram.inspectQuality once. If it reports needsRevision=true, fix only the reported structural or visual issues and inspect once more; do not enter an open-ended beautification loop.',
      'When creating a diagram for the current conversation, omit workspacePath unless the user explicitly names another workspace. diagram.create will then use the current thread workspace and save under docs/diagrams/.',
      'Use type=canvas for freeform drawing boards and architecture diagrams. Read an existing diagram before updating it.',
    ].join(' '),
  },
)

const appOnly = { ui: { visibility: ['app'] as const } }
const readonly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const canvasIconRefSchema = z.string().refine(isCanvasIconRef, '不支持的 iconRef')
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const sourceIndexCache = new Map<string, { expiresAt: number; files: string[] }>()
type ThreadTraceState = { seedElementIds: string[]; direction: 'upstream' | 'downstream' | 'both'; depth: number }
type ThreadDrawActivity = { kind: 'create' | 'update' | 'proposal' | 'source-sync' | 'history-undo' | 'history-redo'; path: string; key: string; modifiedAt?: string }
type ThreadSelectionState = {
  path?: string
  diagramPaths?: string[]
  focusElementIds?: string[]
  trace?: ThreadTraceState
  activity?: ThreadDrawActivity
  updatedAt: string
}
const threadSelection = new Map<string, ThreadSelectionState>()
interface ThreadDiagramProposal {
  workspacePath: string
  path: string
  source: string
  baseSource: string
  reason?: string
  baseModifiedAt: string
  updatedAt: string
  scopeElementIds?: string[]
  newElementIds?: string[]
  impactElementIds?: string[]
  automaticElementIds?: string[]
  branchId?: string
  branchLabel?: string
  branchGroupId?: string
  canvasPatch?: CanvasSubgraphPatchInput
  rebased?: boolean
  patchSummary?: {
    updated: number
    added: number
    removed: number
    layout: 'preserve' | 'local'
  }
}
const threadProposals = new Map<string, ThreadDiagramProposal>()
type ThreadProposalBranchSet = ProposalBranchSet<ThreadDiagramProposal>
const threadProposalBranches = new Map<string, ThreadProposalBranchSet>()
interface ThreadGitImpact {
  workspacePath: string
  path: string
  updatedAt: string
  report: Record<string, unknown>
}
const threadGitImpacts = new Map<string, ThreadGitImpact>()
const sessionLastAccess = new Map<string, number>()
const sessionIdleLimitMs = 24 * 60 * 60 * 1_000
const maxSessionStates = 512
let sessionSweepCalls = 0
const ui = (
  resourceUri: string,
  entrypoints: OpenAIUiToolMetadata['entrypoints'] = [],
  visibility: readonly ('model' | 'app')[] = ['app'],
) => ({
  ui: { resourceUri, visibility },
  'openai/ui': { entrypoints } satisfies OpenAIUiToolMetadata,
  'openai/iconStyle': 'monochrome',
})

registerWorkspaceResource('diagram-plugin-workspace-current', workspaceUiUri, 'workspace')
registerWorkspaceResource('diagram-plugin-thread-current', threadUiUri, 'thread')
registerWorkspaceResource('diagram-plugin-workspace-legacy', legacyUiUri)

server.registerTool('diagram.designGuide', {
  title: 'Read diagram design guide',
  description: 'Return the built-in progressive design guidance for one diagram type before a non-trivial creation or whole-diagram redesign. The guide includes composition archetypes, visual hierarchy, evidence rules, density limits, anti-patterns and the bounded quality loop. Do not call for small local edits.',
  inputSchema: z.object({
    type: z.enum(diagramTypes.map((item) => item.type) as [DiagramType, ...DiagramType[]]),
    intent: z.string().max(1_000).optional().describe('Short user intent. For canvas this is used to distinguish architecture/C4 from a generic freeform board.'),
    architectureTheme: z.enum(['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch']).default('enterprise'),
  }),
  annotations: readonly,
}, async ({ type, intent, architectureTheme }) => {
  const routing = diagramIntentRoutingGuide()
  const rules = type === 'canvas'
    ? (isArchitectureIntent(intent ?? '')
        ? ['内置 Architecture Diagram Skill：', ...architectureDesignSkill(architectureTheme), ...diagramVisualStyleGuide()]
        : [
            '内置 Canvas Design Guide：',
            ...diagramVisualStyleGuide(),
            '先根据关系选择 linear / fan-out / convergence / hierarchy / swimlane 等构图原型，不要默认生成等权卡片墙。',
            '主对象与主关系形成第一视觉层级；辅助说明、次要依赖和装饰退到第二层级，并用留白表达分组。',
            '只把已确认的事实写入节点、关系、sourcePaths、stencil 和 C4 元数据；未知内容保持中性表达。',
            '完成后调用 diagram.inspectQuality；若 needsRevision=true，只修复报告问题并最多再回检一次。',
          ])
    : skillPromptLines(diagramSkill(type), 'generation')
  return {
    content: [{ type: 'text', text: [...routing, '', ...rules].join('\n') }],
    structuredContent: { kind: 'diagram-design-guide', type, architectureTheme: type === 'canvas' ? architectureTheme : undefined, routing, rules },
  }
})

server.registerTool('diagram.searchArchitectureTemplates', {
  title: 'Search architecture component templates',
  description: 'Search the built-in architecture node templates by product, role or capability before adding a confirmed technology component. Returns semantic role, optional stencil/iconRef, subtitle and recommended boundary without changing the diagram. Use this instead of guessing cloud icon ids.',
  inputSchema: z.object({
    query: z.string().max(120).default('').describe('Product, role or capability such as lambda, database, kubernetes, queue, vertex ai.'),
    provider: z.enum(['all', 'builtin', 'aws', 'azure', 'gcp']).default('all'),
    limit: z.number().int().min(1).max(30).default(12),
  }),
  annotations: readonly,
}, async ({ query, provider, limit }) => {
  const templates = searchArchitectureNodeTemplates(query, provider, limit).map((item) => ({
    id: item.id,
    provider: item.provider,
    category: item.category,
    label: item.label,
    subtitle: item.subtitle,
    icon: item.icon,
    stencil: item.stencil,
    iconRef: item.iconRef,
    groupId: item.groupId,
    tone: item.tone,
  }))
  return {
    content: [{ type: 'text', text: templates.length
      ? `Found ${templates.length} architecture component template(s). Preserve their role/icon semantics when the matching technology is confirmed.`
      : 'No matching architecture component template found. Keep the node semantically neutral instead of guessing a cloud product.' }],
    structuredContent: { kind: 'architecture-node-templates', query, provider, templates },
  }
})
server.registerResource(
  'diagram-plugin-workspace-versioned-history',
  new ResourceTemplate(uiTemplate, { list: undefined }),
  { title: 'Diagram 工作台（历史版本兼容）', mimeType: 'text/html;profile=mcp-app' },
  async (uri) => workspaceResource(uri.toString(), 'workspace'),
)

server.registerTool('diagram.workspace', {
  title: 'Diagram 图表库',
  description: 'Open the full-screen Diagram library for browsing, managing, exporting and editing workspace diagrams.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: ui(workspaceUiUri, [diagramGlobalEntrypoint(icons)]),
}, async (_args, extra) => ({
  content: [],
  structuredContent: workspaceContent(await bootstrapWorkspace(toolThreadId(extra._meta)), 'workspace'),
}))

server.registerTool('diagram.thread', {
  title: 'Open Diagram',
  description: 'Open the Diagram companion panel beside the current Codex conversation. This is a UI-open action, not a prerequisite for every diagram tool call. If diagram.thread was already called earlier in this conversation, do not call it again; use diagram.get/create/update/proposal directly because the existing panel follows thread state automatically.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: ui(threadUiUri, [{ type: 'thread' }], ['model', 'app']),
}, async (_args, extra) => {
  const threadId = toolThreadId(extra._meta)
  const payload = workspaceContent(await bootstrapWorkspace(threadId), 'thread', threadId)
  const workspacePath = typeof payload.workspacePath === 'string' ? payload.workspacePath : undefined
  return {
    content: [{
      type: 'text',
      text: workspacePath
        ? `Opened Diagram beside this conversation. Current conversation workspace: ${workspacePath}`
        : 'Opened Diagram beside this conversation. No writable workspace is currently bound to this thread.',
    }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.openWorkspace', {
  title: 'Open diagram workspace',
  description: 'Open a local directory in the Diagram sidebar app.',
  inputSchema: z.object({ workspacePath: z.string().min(1) }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ workspacePath }, extra) => {
  if (process.env.DIAGRAM_PLUGIN_HOST === 'deepseek') throw new Error('DeepSeek 图表工作区由当前会话确定，不能手动切换。')
  const payload = workspaceContent(await openWorkspace(workspacePath), undefined, toolThreadId(extra._meta))
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.threadState', {
  title: 'Read active diagram for this conversation',
  description: 'Internal app bridge for keeping the thread sidebar synchronized with diagram tool usage in the same Codex conversation.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: appOnly,
}, async (_args, extra) => {
  const threadId = toolThreadId(extra._meta)
  const state = threadId ? threadSelection.get(threadId) : undefined
  const payload = {
    kind: 'diagram-thread-state',
    activeDiagramPath: state?.path,
    diagramPaths: state?.diagramPaths,
    focusElementIds: state?.focusElementIds,
    trace: state?.trace,
    activity: state?.activity,
    proposal: threadId ? proposalSummary(threadProposals.get(threadId)) : undefined,
    gitImpact: threadId && threadGitImpacts.get(threadId)?.path === state?.path ? gitImpactSummary(threadGitImpacts.get(threadId)) : undefined,
    updatedAt: state?.updatedAt,
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.closeThreadDiagram', {
  title: 'Close active diagram for this conversation',
  description: 'Internal app bridge for closing the active Diagram view in this conversation without deleting the diagram file.',
  inputSchema: z.object({ path: z.string().min(1).optional() }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ path: diagramPath }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (threadId) {
    const current = threadSelection.get(threadId)
    const closingPath = diagramPath ?? current?.path
    if (current?.path === closingPath) {
      threadSelection.set(threadId, {
        diagramPaths: current?.diagramPaths?.filter((path) => path !== closingPath),
        updatedAt: new Date().toISOString(),
      })
    } else if (current && closingPath) {
      threadSelection.set(threadId, {
        ...current,
        diagramPaths: current.diagramPaths?.filter((path) => path !== closingPath),
        updatedAt: new Date().toISOString(),
      })
    }
  }
  const payload = { kind: 'diagram-thread-closed', path: diagramPath }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.list', {
  title: 'List diagrams',
  description: 'List Mermaid and Canvas diagram files in the current workspace.',
  inputSchema: z.object({ workspacePath: z.string().optional() }),
  annotations: readonly,
}, async ({ workspacePath }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagrams = await store.list()
  return {
    content: [{ type: 'text', text: diagrams.length ? diagrams.map((diagram) => `${diagram.path} (${diagram.type})`).join('\n') : 'No diagrams found.' }],
    structuredContent: { kind: 'diagram-list', workspacePath: store.workspacePath, diagrams },
  }
})

server.registerTool('diagram.get', {
  title: 'Read diagram',
  description: 'Read one Mermaid or Canvas diagram from the current workspace before explaining or modifying it.',
  inputSchema: z.object({ workspacePath: z.string().optional(), path: z.string().min(1) }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.get(diagramPath)
  markThreadDiagram(extra._meta, diagram.path)
  return {
    content: [{ type: 'text', text: `Path: ${diagram.path}\nType: ${diagram.type}\n\n${diagram.source}` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.getSubgraph', {
  title: 'Read Canvas subgraph',
  description: 'Read a bounded Canvas neighborhood around selected element ids without loading the whole diagram. The result separates original scope nodes, directly connected relationships that may be edited when intent requires, and read-only context elements. Prefer this before an incremental Canvas patch, especially for large diagrams.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    elementIds: z.array(z.string().min(1)).min(1).max(120),
    depth: z.number().int().min(0).max(2).default(0),
    maxNodes: z.number().int().min(12).max(240).default(160),
  }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath, elementIds, depth, maxNodes }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.get(diagramPath)
  if (diagram.type !== 'canvas') throw new Error('Canvas subgraph 仅支持自由 Canvas 图。')
  const scene = parseCanvasScene(diagram.source)
  const subgraph = buildCanvasSubgraphContext(scene, elementIds, depth, maxNodes)
  const payload = {
    kind: 'diagram-canvas-subgraph',
    workspacePath: store.workspacePath,
    path: diagram.path,
    modifiedAt: diagram.modifiedAt,
    title: scene.title,
    width: scene.width,
    height: scene.height,
    depth,
    ...subgraph,
  }
  const boxIds = new Set(scene.elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
  const arrowById = new Map(scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow').map((item) => [item.id, item]))
  const scopeFocusIds = [...new Set(elementIds.flatMap((id) => {
    if (boxIds.has(id)) return [id]
    const arrow = arrowById.get(id)
    return arrow ? [arrow.from, arrow.to] : []
  }))]
  markThreadDiagram(extra._meta, diagram.path, scopeFocusIds)
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.revision', {
  title: 'Read diagram revision',
  description: 'Internal app bridge for checking whether an open diagram changed on disk.',
  inputSchema: z.object({ workspacePath: z.string().optional(), path: z.string().min(1) }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ workspacePath, path: diagramPath }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const revision = await store.revision(diagramPath)
  const payload = { kind: 'diagram-revision', workspacePath: store.workspacePath, revision }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.sources', {
  title: 'Search workspace source files',
  description: 'Internal app bridge for choosing real source files when generating a diagram.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    query: z.string().max(240).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ workspacePath, query = '', limit = 40 }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const now = Date.now()
  let cached = sourceIndexCache.get(store.workspacePath)
  if (!cached || cached.expiresAt <= now) {
    cached = { files: await store.listSourceFiles(), expiresAt: now + 15_000 }
    sourceIndexCache.set(store.workspacePath, cached)
  }
  const needle = query.trim().toLocaleLowerCase()
  const files = (needle
    ? cached.files.filter((file) => fuzzyPathMatch(file.toLocaleLowerCase(), needle))
    : cached.files
  ).slice(0, limit)
  const payload = { kind: 'source-files', workspacePath: store.workspacePath, files }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.findBySource', {
  title: 'Find diagram nodes by source file',
  description: 'Find Canvas nodes linked to a workspace source file. Use this to locate the visual node for code the user is discussing.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    sourcePath: z.string().min(1).max(600),
  }),
  annotations: readonly,
}, async ({ workspacePath, sourcePath }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const normalized = normalizeSourcePath(sourcePath)
  const summaries = await store.list()
  const matches: Array<{ diagramPath: string; diagramName: string; nodes: Array<{ id: string; text: string; sourcePaths: string[] }> }> = []
  for (const summary of summaries) {
    if (summary.type !== 'canvas') continue
    const diagram = await store.get(summary.path)
    try {
      const scene = parseCanvasScene(diagram.source)
      const nodes = scene.elements.flatMap((element) => {
        if (element.type === 'arrow' || !element.sourcePaths?.some((path) => sourcePathMatches(normalizeSourcePath(path), normalized))) return []
        return [{ id: element.id, text: element.text, sourcePaths: element.sourcePaths }]
      })
      if (nodes.length) matches.push({ diagramPath: summary.path, diagramName: summary.name, nodes })
    } catch {
      // Ignore malformed Canvas files here; diagram.get remains the source of truth for repair flows.
    }
  }
  if (matches.length === 1) markThreadDiagram(extra._meta, matches[0].diagramPath, matches[0].nodes.map((node) => node.id))
  return {
    content: [{
      type: 'text',
      text: matches.length
        ? matches.map((match) => `${match.diagramPath}: ${match.nodes.map((node) => `${node.id} (${node.text})`).join(', ')}`).join('\n')
        : `No Canvas nodes are linked to ${sourcePath}.`,
    }],
    structuredContent: { kind: 'diagram-source-matches', workspacePath: store.workspacePath, sourcePath, matches },
  }
})

server.registerTool('diagram.trace', {
  title: 'Trace diagram relationships',
  description: 'Trace upstream, downstream or bidirectional Canvas relationships from one or more node ids. The matching nodes are focused in the current Diagram panel.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    elementIds: z.array(z.string().min(1)).min(1).max(40),
    direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
    depth: z.number().int().min(1).max(8).default(2),
  }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath, elementIds, direction, depth }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动图表，请先指定 Canvas 图表路径。')
  const diagram = await store.get(targetPath)
  if (diagram.type !== 'canvas') throw new Error('关系追踪仅支持自由 Canvas 图。')
  const scene = parseCanvasScene(diagram.source)
  const trace = traceCanvasGraph(scene, elementIds, direction, depth)
  const nodeMap = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow' && trace.arrowIds.includes(item.id))
  markThreadDiagram(extra._meta, diagram.path, trace.nodeIds, { seedElementIds: elementIds, direction, depth })
  return {
    content: [{
      type: 'text',
      text: trace.nodeIds.length
        ? trace.nodeIds.map((id) => `${id}: ${nodeMap.get(id)?.text ?? id} (distance ${trace.distanceById[id] ?? 0})`).join('\n')
        : 'No related Canvas nodes found.',
    }],
    structuredContent: {
      kind: 'diagram-trace',
      workspacePath: store.workspacePath,
      path: diagram.path,
      direction,
      depth,
      nodes: trace.nodeIds.map((id) => ({ id, text: nodeMap.get(id)?.text ?? id, distance: trace.distanceById[id] ?? 0 })),
      arrows: arrows.map((arrow) => ({ id: arrow.id, from: arrow.from, to: arrow.to, label: arrow.label })),
    },
  }
})

server.registerTool('diagram.gitChanges', {
  title: 'Read workspace Git changes',
  description: 'Read the real staged, unstaged and untracked files in the current Git workspace. Optionally include committed branch changes since a base ref.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    baseRef: z.string().min(1).max(200).optional(),
    includeUntracked: z.boolean().default(true),
  }),
  annotations: readonly,
}, async ({ workspacePath, baseRef, includeUntracked }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const git = await readGitChanges(store.workspacePath, { baseRef, includeUntracked })
  return {
    content: [{
      type: 'text',
      text: git.files.length
        ? git.files.map((file) => `${file.path} [${file.kinds.join(', ')}]`).join('\n')
        : 'No Git changes found in the current workspace.',
    }],
    structuredContent: { kind: 'diagram-git-changes', workspacePath: store.workspacePath, ...git },
  }
})

server.registerTool('diagram.impactFromGit', {
  title: 'Map Git changes to diagram impact',
  description: 'Map real Git-changed files to Canvas nodes through sourcePaths, then trace direct and indirect graph impact. The right-side Diagram panel switches to the matching impact view.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    baseRef: z.string().min(1).max(200).optional(),
    includeUntracked: z.boolean().default(true),
    direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
    depth: z.number().int().min(1).max(5).default(2),
  }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath, baseRef, includeUntracked, direction, depth }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动 Canvas，请先打开或指定目标画板。')
  const diagram = await store.get(targetPath)
  if (diagram.type !== 'canvas') throw new Error('Git 影响分析仅支持自由 Canvas 图。')
  const git = await readGitChanges(store.workspacePath, { baseRef, includeUntracked })
  const scene = parseCanvasScene(diagram.source)
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const matchedFiles: Array<{ path: string; kinds: string[]; elementIds: string[] }> = []
  const unmatchedFiles: Array<{ path: string; kinds: string[] }> = []
  const direct = new Set<string>()
  for (const file of git.files) {
    const normalized = normalizeSourcePath(file.path)
    const elementIds = boxes
      .filter((item) => item.sourcePaths?.some((sourcePath) => sourcePathMatches(normalizeSourcePath(sourcePath), normalized)))
      .map((item) => item.id)
    if (elementIds.length) {
      elementIds.forEach((id) => direct.add(id))
      matchedFiles.push({ path: file.path, kinds: file.kinds, elementIds })
    } else {
      unmatchedFiles.push({ path: file.path, kinds: file.kinds })
    }
  }
  const directElementIds = [...direct]
  const trace = directElementIds.length
    ? traceCanvasGraph(scene, directElementIds, direction, depth)
    : { nodeIds: [] as string[], arrowIds: [] as string[], distanceById: {} as Record<string, number> }
  const buckets = Array.from({ length: depth + 1 }, (_, distance) => ({
    distance,
    elementIds: trace.nodeIds.filter((id) => (trace.distanceById[id] ?? 0) === distance),
  })).filter((bucket) => bucket.elementIds.length)
  if (directElementIds.length) {
    markThreadDiagram(extra._meta, diagram.path, trace.nodeIds, { seedElementIds: directElementIds, direction, depth })
  } else {
    markThreadDiagram(extra._meta, diagram.path)
  }
  const nodeMap = new Map(boxes.map((item) => [item.id, item]))
  const impactUpdatedAt = new Date().toISOString()
  const report = {
    kind: 'diagram-git-impact',
    updatedAt: impactUpdatedAt,
    workspacePath: store.workspacePath,
    path: diagram.path,
    direction,
    depth,
    git,
    matchedFiles,
    unmatchedFiles,
    directElementIds,
    buckets,
    trace: {
      nodeIds: trace.nodeIds,
      arrowIds: trace.arrowIds,
      distanceById: trace.distanceById,
      nodes: trace.nodeIds.map((id) => ({ id, text: nodeMap.get(id)?.text ?? id, distance: trace.distanceById[id] ?? 0 })),
    },
  }
  if (threadId) {
    threadGitImpacts.set(threadId, {
      workspacePath: store.workspacePath,
      path: diagram.path,
      updatedAt: impactUpdatedAt,
      report,
    })
  }
  return {
    content: [{
      type: 'text',
      text: [
        `Git changed files: ${git.files.length}`,
        `Mapped files: ${matchedFiles.length}`,
        `Direct diagram nodes: ${directElementIds.length}`,
        `Impacted diagram nodes: ${trace.nodeIds.length}`,
        `Unmapped files: ${unmatchedFiles.length}`,
      ].join('\n'),
    }],
    structuredContent: report,
  }
})

server.registerTool('diagram.gitImpact', {
  title: 'Read Git impact report for this conversation',
  description: 'Internal app bridge for loading the latest Git-to-Canvas impact report produced in the current conversation.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: appOnly,
}, async (_args, extra) => {
  const threadId = toolThreadId(extra._meta)
  const current = threadId ? threadGitImpacts.get(threadId) : undefined
  if (!current) throw new Error('当前聊天没有 Git 影响报告。')
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(current.report) }],
    structuredContent: current.report,
  }
})

server.registerTool('diagram.dismissGitImpact', {
  title: 'Dismiss Git impact report for this conversation',
  description: 'Internal app bridge for clearing the current conversation Git impact report without changing any diagram file.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: appOnly,
}, async (_args, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (threadId) {
    threadGitImpacts.delete(threadId)
    const current = threadSelection.get(threadId)
    threadSelection.set(threadId, { ...current, updatedAt: new Date().toISOString() })
  }
  const payload = { kind: 'diagram-git-impact-dismissed' }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.upsertSourceNode', {
  title: 'Sync source file to diagram node',
  description: 'Create or update one Canvas node linked to a real source file in the current workspace. Use after reading code when the user wants the architecture diagram to reflect that file without rewriting the whole Canvas.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    sourcePath: z.string().min(1).max(600),
    elementId: z.string().min(1).optional(),
    text: z.string().min(1).max(160).optional(),
    subtitle: z.string().max(160).optional(),
    description: z.string().max(2_000).optional(),
    tags: z.array(z.string().min(1).max(80)).max(12).optional(),
    icon: z.enum(['user', 'web', 'api', 'gateway', 'service', 'worker', 'database', 'cache', 'queue', 'search', 'vector', 'cloud', 'file', 'auth', 'ai', 'mcp', 'scheduler', 'external']).optional(),
    stencil: z.enum(['spring', 'react', 'vue', 'postgres', 'mysql', 'redis', 'kafka', 'rabbitmq', 'docker', 'kubernetes', 'qdrant', 'opensearch', 'elasticsearch', 'mongodb', 'minio', 'nginx', 'grpc', 'oidc', 'openai', 'mcp']).optional(),
    iconRef: canvasIconRefSchema.optional(),
    c4Type: z.enum(['person', 'software-system', 'container', 'component']).optional(),
    groupId: z.string().min(1).optional(),
    laneId: z.string().min(1).optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, sourcePath, elementId, text, subtitle, description, tags, icon, stencil, iconRef, c4Type, groupId, laneId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动 Canvas，请先打开或指定目标画板。')
  const diagram = await store.get(targetPath)
  if (diagram.type !== 'canvas') throw new Error('源码节点同步仅支持自由 Canvas 图。')

  const now = Date.now()
  let cached = sourceIndexCache.get(store.workspacePath)
  if (!cached || cached.expiresAt <= now) {
    cached = { files: await store.listSourceFiles(), expiresAt: now + 15_000 }
    sourceIndexCache.set(store.workspacePath, cached)
  }
  const realSourcePath = await resolveSourceFile(cached.files, sourcePath, store.workspacePath)
  if (!realSourcePath) throw new Error(`工作区中不存在源码文件：${sourcePath}`)

  const scene = parseCanvasScene(diagram.source)
  if (groupId && !scene.groups?.some((group) => group.id === groupId)) throw new Error(`Canvas 中不存在容器：${groupId}`)
  if (laneId && !scene.lanes?.some((lane) => lane.id === laneId)) throw new Error(`Canvas 中不存在泳道：${laneId}`)
  const boxes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const linked = await linkedSourceNodes(boxes, store.workspacePath, realSourcePath)
  let target = elementId ? boxes.find((item) => item.id === elementId) : undefined
  if (elementId && !target) throw new Error(`Canvas 中不存在节点：${elementId}`)
  if (!target && linked.length > 1) throw new Error(`该源码已关联多个 Canvas 节点，请传 elementId：${linked.map((item) => item.id).join(', ')}`)
  if (!target) target = linked[0]

  const cleanTags = tags?.map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
  let nodeId: string
  let created = false
  if (target) {
    nodeId = target.id
    scene.elements = scene.elements.map((item) => {
      if (item.id !== target!.id || item.type === 'arrow') return item
      return {
        ...item,
        ...(text ? { text } : {}),
        ...(subtitle !== undefined ? { subtitle: subtitle || undefined } : {}),
        ...(description !== undefined ? { description: description || undefined } : {}),
        ...(cleanTags ? { tags: cleanTags.length ? cleanTags : undefined } : {}),
        ...(icon ? { icon: icon as CanvasIcon } : {}),
        ...(stencil ? { stencil: stencil as CanvasStencil } : {}),
        ...(iconRef ? { iconRef: iconRef as CanvasIconRef } : {}),
        ...(c4Type ? { c4Type: c4Type as CanvasC4Type } : {}),
        ...(groupId ? { groupId } : {}),
        ...(laneId ? { laneId } : {}),
        sourcePaths: [...new Set([...(item.sourcePaths ?? []), realSourcePath])],
      }
    })
  } else {
    created = true
    nodeId = nextCanvasElementId('node', scene.elements)
    const index = boxes.length
    const columns = 4
    const fileName = path.basename(realSourcePath).replace(/\.[^.]+$/, '')
    const x = 120 + (index % columns) * 280
    const y = 120 + Math.floor(index / columns) * 160
    scene.height = Math.max(scene.height, y + 180)
    scene.elements.push({
      id: nodeId,
      type: 'node',
      x,
      y,
      width: 220,
      height: 96,
      text: text ?? fileName,
      ...(subtitle ? { subtitle } : {}),
      ...(description ? { description } : {}),
      ...(cleanTags?.length ? { tags: cleanTags } : {}),
      ...(icon ? { icon: icon as CanvasIcon } : {}),
      ...(stencil ? { stencil: stencil as CanvasStencil } : {}),
      ...(iconRef ? { iconRef: iconRef as CanvasIconRef } : {}),
      ...(c4Type ? { c4Type: c4Type as CanvasC4Type } : {}),
      ...(groupId ? { groupId } : {}),
      ...(laneId ? { laneId } : {}),
      sourcePaths: [realSourcePath],
    })
  }
  const updated = await store.update(diagram.path, serializeCanvasScene(scene), diagram.modifiedAt)
  markThreadDiagram(extra._meta, updated.path, [nodeId], undefined, 'source-sync', updated.modifiedAt)
  return {
    content: [{ type: 'text', text: `${created ? 'Created' : 'Updated'} Canvas node ${nodeId} for ${realSourcePath} in ${updated.path}` }],
    structuredContent: { kind: 'diagram-source-node', workspacePath: store.workspacePath, diagram: updated, nodeId, sourcePath: realSourcePath, created },
  }
})

server.registerTool('diagram.upsertSourceNodes', {
  title: 'Batch sync source files to diagram nodes',
  description: 'Create or refresh multiple Canvas nodes from real workspace source files in one revision. Use after analyzing a module or changed file set; ambiguous existing links fail instead of guessing.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    nodes: z.array(z.object({
      sourcePath: z.string().min(1).max(600),
      elementId: z.string().min(1).optional(),
      text: z.string().min(1).max(160).optional(),
      subtitle: z.string().max(160).optional(),
      description: z.string().max(2_000).optional(),
      tags: z.array(z.string().min(1).max(80)).max(12).optional(),
      icon: z.enum(['user', 'web', 'api', 'gateway', 'service', 'worker', 'database', 'cache', 'queue', 'search', 'vector', 'cloud', 'file', 'auth', 'ai', 'mcp', 'scheduler', 'external']).optional(),
      stencil: z.enum(['spring', 'react', 'vue', 'postgres', 'mysql', 'redis', 'kafka', 'rabbitmq', 'docker', 'kubernetes', 'qdrant', 'opensearch', 'elasticsearch', 'mongodb', 'minio', 'nginx', 'grpc', 'oidc', 'openai', 'mcp']).optional(),
      iconRef: canvasIconRefSchema.optional(),
      c4Type: z.enum(['person', 'software-system', 'container', 'component']).optional(),
      groupId: z.string().min(1).optional(),
      laneId: z.string().min(1).optional(),
    })).min(1).max(80),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, nodes }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动 Canvas，请先打开或指定目标画板。')
  const diagram = await store.get(targetPath)
  if (diagram.type !== 'canvas') throw new Error('批量源码节点同步仅支持自由 Canvas 图。')

  const now = Date.now()
  let cached = sourceIndexCache.get(store.workspacePath)
  if (!cached || cached.expiresAt <= now) {
    cached = { files: await store.listSourceFiles(), expiresAt: now + 15_000 }
    sourceIndexCache.set(store.workspacePath, cached)
  }
  const scene = parseCanvasScene(diagram.source)
  const results: Array<{ sourcePath: string; nodeId: string; created: boolean }> = []
  for (const spec of nodes) {
    const realSourcePath = await resolveSourceFile(cached.files, spec.sourcePath, store.workspacePath)
    if (!realSourcePath) throw new Error(`工作区中不存在源码文件：${spec.sourcePath}`)
    const result = await upsertSourceNodeInScene(scene, realSourcePath, spec as SourceNodeSpec, store.workspacePath)
    results.push({ sourcePath: realSourcePath, ...result })
  }
  const updated = await store.update(diagram.path, serializeCanvasScene(scene), diagram.modifiedAt)
  const nodeIds = [...new Set(results.map((item) => item.nodeId))]
  markThreadDiagram(extra._meta, updated.path, nodeIds, undefined, 'source-sync', updated.modifiedAt)
  return {
    content: [{
      type: 'text',
      text: `Synced ${results.length} source file(s) to ${nodeIds.length} Canvas node(s) in one revision. Created ${results.filter((item) => item.created).length}, updated ${results.filter((item) => !item.created).length}.`,
    }],
    structuredContent: {
      kind: 'diagram-source-nodes',
      workspacePath: store.workspacePath,
      diagram: updated,
      nodes: results,
    },
  }
})

server.registerTool('diagram.create', {
  title: 'Create diagram',
  description: 'Create a Mermaid or Canvas diagram under docs/diagrams in the current conversation workspace. For Canvas choose canvasWorkbench=architecture for software architecture/C4/topology, flowchart for manually editable process diagrams, or freeform for a general drawing board. For new Canvas boards including architecture, call diagram.designGuide and choose an appropriate built-in scene.style before writing the source. Mermaid flowchart remains available when automatic Mermaid layout is preferred. Use the dedicated analysis/data types (kanban/requirement/sankey/xychart/pie/radar/treemap/ishikawa) only when their semantic and data requirements are actually satisfied.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    type: z.enum(diagramTypes.map((item) => item.type) as [DiagramType, ...DiagramType[]]).describe('Diagram kind. Choose canvas for architecture/system/module/service/C4/topology diagrams; otherwise choose the dedicated semantic or data visualization type rather than forcing the request into flowchart.'),
    canvasWorkbench: z.enum(['freeform', 'architecture', 'flowchart']).optional().describe('Canvas-only workbench profile. architecture exposes architecture/component tools, flowchart exposes process drawing/layout tools, freeform exposes general drawing tools.'),
    title: z.string().min(1).max(120),
    animate: z.boolean().optional(),
  }),
  annotations: write,
}, async ({ workspacePath, type, canvasWorkbench, title, animate }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.create(type, title, type === 'canvas' ? canvasWorkbench : undefined)
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, animate === false ? undefined : 'create', diagram.modifiedAt)
  return {
    content: [{ type: 'text', text: `Created ${diagram.path}\n\n${diagram.source}` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.composeArchitecture', {
  title: 'Compose system architecture from semantic graph',
  description: 'Preferred one-call NEW professional architecture generation: supply verified semantic nodes and relationships, never pixel coordinates. Deterministically chooses an architecture composition and creates a Canvas with semantic groups, layout, routing and structural quality results. No invented dependencies. Use diagram.create + diagram.update instead for faithful reference-image tracing or preserving manually specified geometry.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    title: z.string().trim().min(1).max(120),
    theme: z.enum(['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch']).default('enterprise'),
    density: z.enum(['auto', 'comfortable', 'compact', 'dense']).default('auto'),
    style: z.enum(diagramVisualStyles.map((style) => style.id) as [string, ...string[]]).optional().describe('Optional one unified visual theme. Defaults to a restrained, low-saturation professional preset rather than bright card walls.'),
    nodes: z.array(z.object({
      id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).describe('Stable unique node ID, not a coordinate.'),
      text: z.string().trim().min(1).max(100),
      icon: z.enum(CANVAS_ROLE_ICON_IDS).optional().describe('Actual semantic role, not a decorative icon.'),
      stencil: z.enum(CANVAS_STENCIL_IDS).optional().describe('Only if confirmed by actual project code or user input.'),
      subtitle: z.string().max(80).optional(),
      description: z.string().max(500).optional(),
    })).min(2).max(80),
    relations: z.array(z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      label: z.string().max(64).optional().describe('Meaningful verified relationship/protocol, not a repeated node name.'),
      asynchronous: z.boolean().optional(),
    })).min(1).max(160).describe('Real dependencies between nodes. Do not invent edges merely to make a picture connected.'),
  }),
  annotations: write,
}, async ({ workspacePath, title, theme, density, style, nodes, relations }, extra) => {
  const composed = composeArchitectureGraph({ title, theme, density, style: style as typeof diagramVisualStyles[number]['id'] | undefined, nodes, relations })
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.createComposedArchitecture(title, serializeCanvasScene(composed.scene))
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, 'create', diagram.modifiedAt)
  return {
    content: [{ type: 'text', text: `Created architecture ${diagram.path} with ${nodes.length} semantic nodes, ${relations.length} evidence-backed relations and ${composed.summary.composition} composition. Quality: ${composed.quality.needsRevision ? `${composed.quality.issues.length} issue(s) to inspect` : 'passed'}.` }],
    structuredContent: {
      kind: 'diagram', workspacePath: store.workspacePath, diagram,
      architectureDesign: composed.summary,
      quality: composed.quality,
      architectureEvaluation: { semanticComposition: composed.semanticComposition, selected: composed.evaluation, routeDiagnostics: composed.routeDiagnostics, candidates: composed.candidates, reroutedEdges: composed.reroutedEdges, reorderedPairs: composed.reorderedPairs, note: 'Structural/layout heuristic only, not a visual aesthetic score. The selected layout can differ from the semantic composition when geometry improves.' },
      presentationQuality: composed.presentation,
    },
  }
})

server.registerTool('diagram.update', {
  title: 'Update diagram',
  description: 'Replace the source of an existing Mermaid or Canvas diagram. Pass expectedModifiedAt from diagram.get when available to avoid overwriting concurrent edits.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    source: z.string().min(1),
    expectedModifiedAt: z.string().optional(),
    animate: z.boolean().optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, source, expectedModifiedAt, animate }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.update(diagramPath, source, expectedModifiedAt)
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, animate === false ? undefined : 'update', diagram.modifiedAt)
  return {
    content: [{ type: 'text', text: `Updated ${diagram.path}` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.restore', {
  title: 'Restore deleted diagram draft',
  description: 'Internal app bridge for restoring a retained draft at its deleted path. Refuses to overwrite any existing file.',
  inputSchema: z.object({ workspacePath: z.string().optional(), path: z.string().min(1), source: z.string().min(1) }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, path: diagramPath, source }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.restore(diagramPath, source)
  markThreadDiagram(extra._meta, diagram.path)
  return {
    content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram', workspacePath: store.workspacePath, diagram }) }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.beautifyArchitecture', {
  title: 'Beautify architecture diagram',
  description: 'Apply the built-in architecture design system to a Canvas diagram: infer roles/technology badges, create semantic architecture partitions, apply a theme, re-layout nodes and spread orthogonal relationship routes. Use this when the user asks to beautify, reorganize or make a system architecture diagram presentation-ready.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    theme: z.enum(['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch']).default('enterprise'),
    view: z.enum(['overview', 'detail']).optional(),
    density: z.enum(['auto', 'comfortable', 'compact', 'dense']).optional(),
    repartition: z.boolean().default(true),
    relayout: z.boolean().default(true),
    reroute: z.boolean().default(true),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, theme, view, density, repartition, relayout, reroute }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动架构图，请先指定 Canvas 图表路径。')
  const current = await store.get(targetPath)
  if (current.type !== 'canvas') throw new Error('架构美化仅支持 Canvas 图；Mermaid 图请先转换或新建架构 Canvas。')
  const result = beautifyArchitectureScene(parseCanvasScene(current.source), { theme, view, density, repartition, relayout, reroute })
  const diagram = await store.update(current.path, serializeCanvasScene(result.scene), current.modifiedAt)
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, 'update', diagram.modifiedAt)
  return {
    content: [{
      type: 'text',
      text: `Beautified ${diagram.path}: ${result.summary.partitions} architecture partition(s), ${result.summary.enrichedNodes} enriched node(s), ${result.summary.primaryNodes} primary node(s), ${result.summary.bundledEdges} bundled relation(s), ${result.summary.routedEdges} routed relation(s), theme=${theme}, view=${result.summary.view}, density=${result.summary.density}(${result.summary.resolvedDensity}).`,
    }],
    structuredContent: {
      kind: 'diagram',
      workspacePath: store.workspacePath,
      diagram,
      architectureDesign: result.summary,
    },
  }
})

server.registerTool('diagram.routeArchitectureEdges', {
  title: 'Route architecture relationships',
  description: 'Recompute only Canvas relationship routes using obstacle-aware orthogonal routing. Keeps every node, lane, group and node coordinate unchanged. Use when the user asks to reduce crossing/overlapping lines without changing the layout.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动架构图，请先指定 Canvas 图表路径。')
  const current = await store.get(targetPath)
  if (current.type !== 'canvas') throw new Error('架构连线整理仅支持 Canvas 图。')
  const scene = routeArchitectureEdges(parseCanvasScene(current.source))
  const diagram = await store.update(current.path, serializeCanvasScene(scene), current.modifiedAt)
  const routedEdges = scene.elements.filter((item) => item.type === 'arrow').length
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, 'update', diagram.modifiedAt)
  return {
    content: [{ type: 'text', text: `Routed ${routedEdges} architecture relationship(s) in ${diagram.path} without moving nodes.` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram, routedEdges },
  }
})

server.registerTool('diagram.inspectQuality', {
  title: 'Inspect diagram quality',
  description: 'Run the built-in visual/structural quality gate on the current Mermaid or Canvas diagram, or on an unsaved candidate passed in source. Canvas checks node overlap, crossed/overlapping edges, label collisions, flat hierarchy, disconnected architecture hubs, repetitive card walls and decorative lanes without real cross-layer edges. Warnings do not authorize inventing missing dependencies. Mermaid checks type-specific density and split thresholds.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().optional(),
    source: z.string().min(1).optional().describe('Optional unsaved candidate source. Use this before proposing an update so quality checks run against the candidate instead of the current file.'),
  }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath, source }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动图表，请先指定图表路径。')
  const diagram = await store.get(targetPath)
  markThreadDiagram(extra._meta, diagram.path)
  const inspectedSource = source ?? diagram.source

  if (diagram.type === 'canvas') {
    const quality = assessCanvasVisualQuality(parseCanvasScene(inspectedSource))
    return {
      content: [{ type: 'text', text: quality.needsRevision
        ? `Quality review found ${quality.issues.length} Canvas issue(s) in ${diagram.path}. Fix only the reported issues, then inspect once more.`
        : `Quality review passed for ${diagram.path}.` }],
      structuredContent: { kind: 'diagram-quality', workspacePath: store.workspacePath, path: diagram.path, type: diagram.type, candidate: Boolean(source), ...quality },
    }
  }

  if (!isMermaidDiagramType(diagram.type)) throw new Error(`不支持检查未知图表类型：${diagram.type}`)
  const quality = assessMermaidVisualQuality(diagram.type, inspectedSource)
  return {
    content: [{ type: 'text', text: quality.splitRecommended
      ? `Quality review recommends revising ${diagram.path}: ${quality.reasons.join('; ')}`
      : `Quality review passed for ${diagram.path}.` }],
    structuredContent: {
      kind: 'diagram-quality',
      workspacePath: store.workspacePath,
      path: diagram.path,
      type: diagram.type,
      candidate: Boolean(source),
      needsRevision: quality.splitRecommended,
      issues: quality.reasons,
      density: quality.density,
      metrics: quality.metrics,
    },
  }
})

server.registerTool('diagram.proposeUpdate', {
  title: 'Propose diagram update',
  description: 'Prepare a candidate full-source update for an existing Mermaid or Canvas diagram without writing it to disk. Prefer this for conversational edits so the user can review the diff in Diagram first.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    source: z.string().min(1),
    reason: z.string().max(2_000).optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, source, reason }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文，无法创建可审查的 Diagram Proposal。')
  const store = await resolveStore(workspacePath, threadId)
  const current = await store.get(diagramPath)
  const proposal = setThreadProposal(threadId, { workspacePath: store.workspacePath, path: current.path, source, baseSource: current.source, reason, baseModifiedAt: current.modifiedAt, updatedAt: new Date().toISOString() })
  markThreadDiagram(extra._meta, current.path)
  return {
    content: [{ type: 'text', text: `Prepared a Diagram proposal for ${current.path}. The file was not modified; wait for the user to accept or reject it in the Diagram panel.` }],
    structuredContent: { kind: 'diagram-proposal', workspacePath: store.workspacePath, proposal: proposalSummary(proposal) },
  }
})

server.registerTool('diagram.proposeSubgraphUpdate', {
  title: 'Propose Canvas subgraph update',
  description: 'Prepare a reviewable Canvas proposal constrained to specific existing element ids plus explicitly declared new element ids. Existing elements outside the subgraph must remain unchanged.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    source: z.string().min(1),
    elementIds: z.array(z.string().min(1)).min(1).max(120),
    newElementIds: z.array(z.string().min(1)).max(120).optional(),
    reason: z.string().max(2_000).optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, source, elementIds, newElementIds = [], reason }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文，无法创建 Subgraph Proposal。')
  const store = await resolveStore(workspacePath, threadId)
  const current = await store.get(diagramPath)
  if (current.type !== 'canvas') throw new Error('Subgraph Proposal 仅支持自由 Canvas 图。')
  validateCanvasSubgraphProposal(current.source, source, elementIds, newElementIds)
  const scopeElementIds = [...new Set(elementIds)]
  const declaredNewElementIds = [...new Set(newElementIds)]
  const proposal = setThreadProposal(threadId, {
    workspacePath: store.workspacePath,
    path: current.path,
    source,
    baseSource: current.source,
    reason,
    baseModifiedAt: current.modifiedAt,
    updatedAt: new Date().toISOString(),
    scopeElementIds,
    newElementIds: declaredNewElementIds,
  })
  markThreadDiagram(extra._meta, current.path, scopeElementIds)
  return {
    content: [{
      type: 'text',
      text: `Prepared a scoped Diagram proposal for ${current.path}. ${scopeElementIds.length} existing element(s) are in scope${declaredNewElementIds.length ? ` with ${declaredNewElementIds.length} declared new element(s)` : ''}; elements outside that subgraph were verified unchanged.`,
    }],
    structuredContent: { kind: 'diagram-proposal', workspacePath: store.workspacePath, proposal: proposalSummary(proposal) },
  }
})

const canvasPatchPropertiesSchema = z.record(z.string(), z.unknown())

server.registerTool('diagram.proposeSubgraphPatch', {
  title: 'Propose Canvas subgraph patch',
  description: 'Prepare a reviewable incremental Canvas patch. Send only changed existing elements, new elements and removals; the server preserves unspecified authored geometry, computes automatic relationship impact, and builds the candidate source.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    elementIds: z.array(z.string().min(1)).max(120).default([]).describe('Existing Canvas element ids that this patch is allowed to modify or remove.'),
    updates: z.array(z.object({
      id: z.string().min(1),
      changes: canvasPatchPropertiesSchema.describe('Only fields that actually change. node/note: x,y,width,height,text,tone,shape,shapeRef,fillColor,strokeColor,strokeWidth,opacity,cornerRadius,rotation,textOnly,fontSize,fontWeight,textColor,locked,groupId,sourcePaths,icon,stencil,iconRef,subtitle,description,tags,laneId,c4Type,emphasis. rotation is degrees in [-180,180]. textOnly/font* fields apply only to note elements used as standalone text. shapeRef is drawing geometry; iconRef is visual-only and must not replace icon/stencil semantics. arrow: from,to,label,lineStyle,routing,fromAnchor,toAnchor,points,labelPosition,emphasis,bundleKey,start,end,markerEnd,strokeColor,strokeWidth,opacity. Use null only to clear optional fields.'),
    })).max(120).optional(),
    adds: z.array(z.object({
      id: z.string().min(1),
      type: z.enum(['node', 'note', 'arrow']),
      properties: canvasPatchPropertiesSchema.describe('Properties for the new element. New node/note text is recommended; x/y may both be omitted for server placement. New arrows require from/to. Do not invent Group/Lane ids.'),
    })).max(120).optional(),
    removeIds: z.array(z.string().min(1)).max(120).optional(),
    layout: z.enum(['preserve', 'local']).default('preserve').describe('preserve keeps authored node geometry; local performs bounded one-hop layout around changed nodes and reports those moves as automatic impact.'),
    branchLabel: z.string().min(1).max(80).optional().describe('Only set when intentionally offering alternative A/B candidates for the same request. Candidates with branchLabel and the same base revision are kept together for user comparison.'),
    reason: z.string().max(2_000).optional(),
  }).refine((value) => Boolean(value.updates?.length || value.adds?.length || value.removeIds?.length), {
    message: 'Canvas patch 至少需要一个 update、add 或 remove。',
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, elementIds, updates = [], adds = [], removeIds = [], layout, branchLabel, reason }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文，无法创建 Canvas Patch Proposal。')
  const store = await resolveStore(workspacePath, threadId)
  const current = await store.get(diagramPath)
  if (current.type !== 'canvas') throw new Error('Canvas Patch Proposal 仅支持自由 Canvas 图。')
  const base = parseCanvasScene(current.source)
  const result = buildCanvasSubgraphPatch(base, {
    scopeElementIds: [...new Set(elementIds)],
    updates,
    adds,
    removeIds,
    layout,
  })
  const source = serializeCanvasScene(result.scene)
  const proposalInput: ThreadDiagramProposal = {
    workspacePath: store.workspacePath,
    path: current.path,
    source,
    baseSource: current.source,
    reason,
    baseModifiedAt: current.modifiedAt,
    updatedAt: new Date().toISOString(),
    scopeElementIds: [...new Set(elementIds)],
    newElementIds: result.addedElementIds,
    impactElementIds: result.impactElementIds,
    automaticElementIds: result.automaticElementIds,
    canvasPatch: {
      scopeElementIds: [...new Set(elementIds)],
      updates,
      adds,
      removeIds,
      layout,
    },
    patchSummary: {
      updated: result.changedElementIds.length,
      added: result.addedElementIds.length,
      removed: result.removedElementIds.length,
      layout,
    },
  }
  const proposal = branchLabel
    ? setThreadProposalBranch(threadId, proposalInput, branchLabel)
    : setThreadProposal(threadId, proposalInput)
  const branchSet = branchLabel ? proposalBranchSummaries(threadId) : undefined
  const candidateById = new Map(result.scene.elements.map((item) => [item.id, item]))
  const baseById = new Map(base.elements.map((item) => [item.id, item]))
  const focusNodeIds = result.impactElementIds.filter((id) => {
    const item = candidateById.get(id) ?? baseById.get(id)
    return item?.type !== 'arrow'
  })
  markThreadDiagram(extra._meta, current.path, focusNodeIds)
  return {
    content: [{
      type: 'text',
      text: `Prepared an incremental Canvas patch for ${current.path}: ${result.changedElementIds.length} updated, ${result.addedElementIds.length} added, ${result.removedElementIds.length} removed${result.automaticElementIds.length ? `, ${result.automaticElementIds.length} automatic impact element(s)` : ''}${proposal.branchLabel ? `. Candidate branch "${proposal.branchLabel}" is active in a ${branchSet?.branches.length ?? 1}-branch comparison set` : ''}. The file was not modified.`,
    }],
    structuredContent: { kind: 'diagram-proposal', workspacePath: store.workspacePath, proposal: proposalSummary(proposal), branchSet },
  }
})

server.registerTool('diagram.proposal', {
  title: 'Read diagram proposal',
  description: 'Internal app bridge for loading the pending candidate source for the current conversation.',
  inputSchema: z.object({}),
  annotations: readonly,
  _meta: appOnly,
}, async (_args, extra) => {
  const threadId = toolThreadId(extra._meta)
  const proposal = threadId ? threadProposals.get(threadId) : undefined
  if (!proposal) throw new Error('当前聊天没有待审查的 Diagram Proposal。')
  const store = await DiagramStore.open(proposal.workspacePath)
  const current = await store.get(proposal.path)
  const before = { ...current, source: proposal.baseSource, modifiedAt: proposal.baseModifiedAt }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram-proposal-source', path: proposal.path, source: proposal.source }) }],
    structuredContent: {
      kind: 'diagram-proposal-source',
      workspacePath: store.workspacePath,
      proposal: proposalSummary(proposal),
      before,
      candidateSource: proposal.source,
      branchSet: threadId ? proposalBranchSummaries(threadId) : undefined,
    },
  }
})

server.registerTool('diagram.selectProposalBranch', {
  title: 'Select AI proposal branch',
  description: 'Internal app bridge for switching the active candidate inside an A/B Canvas proposal branch set without writing the diagram.',
  inputSchema: z.object({ branchId: z.string().min(1) }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ branchId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文。')
  const branches = threadProposalBranches.get(threadId)
  if (!branches) throw new Error('当前聊天没有可切换的 AI 候选分支。')
  const selectedBranch = selectProposalBranch(branches, branchId)
  threadProposalBranches.set(threadId, selectedBranch.set)
  const proposal = selectedBranch.proposal
  threadProposals.set(threadId, proposal)
  const store = await DiagramStore.open(proposal.workspacePath)
  const current = await store.get(proposal.path)
  const before = { ...current, source: proposal.baseSource, modifiedAt: proposal.baseModifiedAt }
  const baseById = proposal.canvasPatch ? new Map(parseCanvasScene(proposal.baseSource).elements.map((item) => [item.id, item])) : new Map()
  const candidateById = proposal.canvasPatch ? new Map(parseCanvasScene(proposal.source).elements.map((item) => [item.id, item])) : new Map()
  const focusNodeIds = (proposal.impactElementIds ?? []).filter((id) => (candidateById.get(id) ?? baseById.get(id))?.type !== 'arrow')
  markThreadDiagram(extra._meta, proposal.path, focusNodeIds)
  return {
    content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram-proposal-source', path: proposal.path, source: proposal.source }) }],
    structuredContent: {
      kind: 'diagram-proposal-source',
      workspacePath: store.workspacePath,
      proposal: proposalSummary(proposal),
      before,
      candidateSource: proposal.source,
      branchSet: proposalBranchSummaries(threadId),
    },
  }
})

server.registerTool('diagram.composeProposalBranches', {
  title: 'Compose AI proposal branches',
  description: 'Compose multiple compatible Canvas proposal branches that share the same base revision into a new reviewable candidate. Conflicting writes are rejected instead of using last-write-wins.',
  inputSchema: z.object({
    branchIds: z.array(z.string().min(1)).min(2).max(6),
    branchLabel: z.string().min(1).max(80).default('组合方案'),
  }),
  annotations: write,
}, async ({ branchIds, branchLabel }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文。')
  const branches = threadProposalBranches.get(threadId)
  if (!branches) throw new Error('当前聊天没有可组合的 AI 候选分支。')
  const selected = [...new Set(branchIds)].map((id) => branches.proposals.find((item) => item.branchId === id))
  if (selected.some((item) => !item?.canvasPatch)) throw new Error('只能组合同一组中的增量 Canvas Patch 候选。')
  const proposals = selected as ThreadDiagramProposal[]
  const composed = composeCanvasSubgraphPatches(proposals.map((item) => item.canvasPatch!))
  if (composed.conflicts.length) {
    throw new Error(`这些候选不能安全组合：${composed.conflicts.slice(0, 12).join('、')}${composed.conflicts.length > 12 ? '…' : ''}`)
  }
  const base = parseCanvasScene(proposals[0].baseSource)
  const result = buildCanvasSubgraphPatch(base, composed.patch)
  const source = serializeCanvasScene(result.scene)
  const proposalInput: ThreadDiagramProposal = {
    workspacePath: branches.workspacePath,
    path: branches.path,
    source,
    baseSource: proposals[0].baseSource,
    reason: `组合：${proposals.map((item) => item.branchLabel ?? item.reason ?? '候选').join(' + ')}`,
    baseModifiedAt: branches.baseModifiedAt,
    updatedAt: new Date().toISOString(),
    scopeElementIds: composed.patch.scopeElementIds,
    newElementIds: result.addedElementIds,
    impactElementIds: result.impactElementIds,
    automaticElementIds: result.automaticElementIds,
    canvasPatch: composed.patch,
    patchSummary: {
      updated: result.changedElementIds.length,
      added: result.addedElementIds.length,
      removed: result.removedElementIds.length,
      layout: composed.patch.layout ?? 'preserve',
    },
  }
  const proposal = setThreadProposalBranch(threadId, proposalInput, branchLabel)
  const store = await DiagramStore.open(proposal.workspacePath)
  const current = await store.get(proposal.path)
  const before = { ...current, source: proposal.baseSource, modifiedAt: proposal.baseModifiedAt }
  markThreadDiagram(extra._meta, proposal.path, result.impactElementIds.filter((id) => result.scene.elements.find((item) => item.id === id)?.type !== 'arrow'))
  return {
    content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram-proposal-source', path: proposal.path, source: proposal.source }) }],
    structuredContent: {
      kind: 'diagram-proposal-source',
      workspacePath: store.workspacePath,
      proposal: proposalSummary(proposal),
      before,
      candidateSource: proposal.source,
      branchSet: proposalBranchSummaries(threadId),
    },
  }
})

server.registerTool('diagram.applyProposal', {
  title: 'Apply diagram proposal',
  description: 'Internal app bridge for accepting the pending Diagram proposal after user review. Canvas proposals may pass elementIds to apply only selected nodes/links while preserving the rest of the current document.',
  inputSchema: z.object({ expectedProposalRevision: z.string().min(1), elementIds: z.array(z.string().min(1)).max(200).optional() }),
  annotations: write,
  _meta: appOnly,
}, async ({ expectedProposalRevision, elementIds }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (!threadId) throw new Error('当前调用没有聊天上下文。')
  const proposal = threadProposals.get(threadId)
  if (!proposal) throw new Error('当前聊天没有待应用的 Diagram Proposal。')
  assertProposalRevision(proposal, expectedProposalRevision)
  if (elementIds?.length && proposal.patchSummary?.layout === 'local') {
    throw new Error('局部布局 Proposal 是耦合事务，不能只接受部分元素；请全部接受或拒绝后重新调整。')
  }
  const store = await DiagramStore.open(proposal.workspacePath)
  const current = await store.get(proposal.path)
  assertProposalRevision(threadProposals.get(threadId), expectedProposalRevision)
  const stale = current.modifiedAt !== proposal.baseModifiedAt
  let candidateSource = proposal.source
  let baseSource = proposal.baseSource
  let expectedModifiedAt = proposal.baseModifiedAt
  let rebased = Boolean(proposal.rebased)
  if (stale && proposal.canvasPatch) {
    const rebasedPatch = rebaseCanvasSubgraphPatch(
      parseCanvasScene(proposal.baseSource),
      parseCanvasScene(current.source),
      proposal.canvasPatch,
      proposal.automaticElementIds,
    )
    const rebasedSource = serializeCanvasScene(rebasedPatch.scene)
    const reviewIds = new Set([
      ...canvasPatchRebaseReviewIds(
        parseCanvasScene(proposal.source),
        rebasedPatch.scene,
        proposal.automaticElementIds,
        proposal.newElementIds,
      ),
      ...rebasedPatch.automaticElementIds.filter((id) => !(proposal.automaticElementIds ?? []).includes(id)),
    ])
    if (reviewIds.size) {
      const refreshed: ThreadDiagramProposal = {
        ...proposal,
        branchId: undefined,
        branchLabel: undefined,
        branchGroupId: undefined,
        rebased: true,
        source: rebasedSource,
        baseSource: current.source,
        baseModifiedAt: current.modifiedAt,
        updatedAt: new Date().toISOString(),
        newElementIds: rebasedPatch.addedElementIds,
        impactElementIds: rebasedPatch.impactElementIds,
        automaticElementIds: rebasedPatch.automaticElementIds,
        patchSummary: {
          updated: rebasedPatch.changedElementIds.length,
          added: rebasedPatch.addedElementIds.length,
          removed: rebasedPatch.removedElementIds.length,
          layout: proposal.canvasPatch.layout ?? 'preserve',
        },
      }
      setThreadProposal(threadId, refreshed)
      const currentById = new Map(parseCanvasScene(current.source).elements.map((item) => [item.id, item]))
      const candidateById = new Map(rebasedPatch.scene.elements.map((item) => [item.id, item]))
      const focusNodeIds = rebasedPatch.impactElementIds.filter((id) => (candidateById.get(id) ?? currentById.get(id))?.type !== 'arrow')
      markThreadDiagram(extra._meta, current.path, focusNodeIds)
      const payload = {
        kind: 'diagram-proposal-refresh',
        workspacePath: store.workspacePath,
        proposal: proposalSummary(refreshed),
        before: current,
        candidateSource: rebasedSource,
        reviewElementIds: [...reviewIds],
      }
      return {
        content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
        structuredContent: payload,
      }
    }
    candidateSource = rebasedSource
    baseSource = current.source
    expectedModifiedAt = current.modifiedAt
    rebased = true
  }
  const source = elementIds?.length
    ? mergeCanvasProposalSelection(baseSource, candidateSource, elementIds, !proposal.patchSummary)
    : candidateSource
  const diagram = await store.update(proposal.path, source, expectedModifiedAt)
  let historyEntryId: string | undefined
  let historyRecorded = false
  if (proposal.canvasPatch) {
    const historyStore = new CanvasPatchHistoryStore(store.workspacePath)
    const previousHistory = await historyStore.list(proposal.path, 200).catch(() => [])
    const declaredElementIds = [
      ...(proposal.canvasPatch.updates ?? []).map((item) => item.id),
      ...(proposal.canvasPatch.adds ?? []).map((item) => item.id),
      ...(proposal.canvasPatch.removeIds ?? []),
    ]
    const draftEntry = buildCanvasPatchHistoryEntry({
      workspacePath: store.workspacePath,
      path: proposal.path,
      before: parseCanvasScene(baseSource),
      after: parseCanvasScene(source),
      beforeModifiedAt: expectedModifiedAt,
      afterModifiedAt: diagram.modifiedAt,
      reason: proposal.reason,
      layout: proposal.canvasPatch.layout ?? 'preserve',
      rebased,
      acceptedElementIds: elementIds,
      scopeElementIds: proposal.scopeElementIds,
      declaredElementIds,
      automaticElementIds: proposal.automaticElementIds,
      proposalBranchId: proposal.branchId,
      proposalBranchLabel: proposal.branchLabel,
      proposalBranchGroupId: proposal.branchGroupId,
    })
    const entry = { ...draftEntry, dependsOnIds: inferCanvasPatchDependencies(draftEntry, previousHistory) }
    if (entry.changes.length) {
      historyEntryId = entry.id
      historyRecorded = await historyStore.appendApply(entry).then(() => true).catch(() => false)
    }
  }
  if (threadProposals.get(threadId) === proposal) clearThreadProposals(threadId)
  markThreadDiagram(extra._meta, diagram.path, undefined, undefined, 'proposal', diagram.modifiedAt)
  const proposalApply = { rebased, beforeSource: baseSource, historyEntryId, historyRecorded }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram', workspacePath: store.workspacePath, diagram, proposalApply }) }],
    structuredContent: {
      kind: 'diagram',
      workspacePath: store.workspacePath,
      diagram,
      proposalApply,
    },
  }
})

server.registerTool('diagram.dismissProposal', {
  title: 'Dismiss diagram proposal',
  description: 'Internal app bridge for rejecting the pending Diagram proposal without changing the file.',
  inputSchema: z.object({ expectedProposalRevision: z.string().min(1) }),
  annotations: write,
  _meta: appOnly,
}, async ({ expectedProposalRevision }, extra) => {
  const threadId = toolThreadId(extra._meta)
  if (threadId) {
    assertProposalRevision(threadProposals.get(threadId), expectedProposalRevision)
    clearThreadProposals(threadId)
    const current = threadSelection.get(threadId)
    threadSelection.set(threadId, { ...current, updatedAt: new Date().toISOString() })
  }
  return { content: [{ type: 'text', text: encodeToolResultFallback({ kind: 'diagram-proposal-dismissed' }) }], structuredContent: { kind: 'diagram-proposal-dismissed' } }
})

server.registerTool('diagram.patchHistory', {
  title: 'Read AI Canvas patch history',
  description: 'Internal app bridge for listing applied incremental Canvas AI patches and their direct/automatic element changes.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(80),
  }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ workspacePath, path: diagramPath, limit }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  const history = new CanvasPatchHistoryStore(store.workspacePath)
  const entries = await history.list(targetPath, limit)
  const graph = buildCanvasPatchGraph(entries)
  const payload = {
    kind: 'diagram-patch-history',
    workspacePath: store.workspacePath,
    path: targetPath,
    entries: entries.map((entry) => patchHistorySummary(entry, graph.get(entry.id))),
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.patchGraph', {
  title: 'Read Canvas AI patch dependency graph',
  description: 'Read the dependency DAG of applied Canvas AI patches without loading full Canvas documents or element snapshots. Useful for understanding patch ancestry, downstream impact and safe chain operations.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  annotations: readonly,
}, async ({ workspacePath, path: diagramPath, limit }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const targetPath = diagramPath ?? (threadId ? threadSelection.get(threadId)?.path : undefined)
  if (!targetPath) throw new Error('当前聊天没有活动 Canvas 图，请指定 path。')
  const entries = await new CanvasPatchHistoryStore(store.workspacePath).list(targetPath, limit)
  const graph = buildCanvasPatchGraph(entries)
  const payload = {
    kind: 'diagram-patch-graph',
    workspacePath: store.workspacePath,
    path: targetPath,
    roots: entries.filter((entry) => !(graph.get(entry.id)?.dependsOnIds.length)).map((entry) => entry.id),
    nodes: entries.map((entry) => ({
      id: entry.id,
      appliedAt: entry.appliedAt,
      reason: entry.reason,
      branchLabel: entry.proposalBranchLabel,
      active: !entry.undoneAt,
      dependsOnIds: graph.get(entry.id)?.dependsOnIds ?? [],
      dependentIds: graph.get(entry.id)?.dependentIds ?? [],
      depth: graph.get(entry.id)?.depth ?? 0,
      changedElementIds: entry.changes.map((change) => change.id),
    })),
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.undoPatchHistory', {
  title: 'Undo AI Canvas patch',
  description: 'Internal app bridge for safely undoing one applied incremental Canvas patch. Reverts only fields owned by that transaction and refuses to overwrite later edits to the same fields.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    historyId: z.string().min(1),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, historyId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const history = new CanvasPatchHistoryStore(store.workspacePath)
  const entry = await history.get(historyId)
  if (!entry) throw new Error('找不到这条 AI 修改历史，可能已被清理或属于其他工作空间。')
  if (entry.undoneAt) throw new Error('这条 AI 修改已经撤销过。')
  const related = await history.list(entry.path, 200)
  const activeDependents = canvasPatchDependentClosure(related, entry.id)
    .filter((id) => id !== entry.id && !related.find((item) => item.id === id)?.undoneAt)
  if (activeDependents.length) throw new Error(`这次修改仍有 ${activeDependents.length} 个活跃下游 Patch，不能单独撤销；请使用“撤销依赖链”。`)
  const current = await store.get(entry.path)
  if (current.type !== 'canvas') throw new Error('AI Patch 历史撤销只支持 Canvas 图。')
  const result = undoCanvasPatchHistory(parseCanvasScene(current.source), entry)
  const diagram = await store.update(entry.path, serializeCanvasScene(result.scene), current.modifiedAt)
  const undoEvent = await history.appendUndo({
    path: entry.path,
    targetId: entry.id,
    beforeModifiedAt: current.modifiedAt,
    afterModifiedAt: diagram.modifiedAt,
  })
  const byId = new Map(result.scene.elements.map((item) => [item.id, item]))
  const focusNodeIds = result.revertedElementIds.filter((id) => byId.get(id)?.type !== 'arrow')
  markThreadDiagram(extra._meta, diagram.path, focusNodeIds, undefined, 'history-undo', diagram.modifiedAt)
  const payload = {
    kind: 'diagram-patch-history-undo',
    workspacePath: store.workspacePath,
    diagram,
    historyId: entry.id,
    undoEventId: undoEvent.id,
    revertedElementIds: result.revertedElementIds,
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.undoPatchHistoryChain', {
  title: 'Undo AI Canvas patch dependency chain',
  description: 'Internal app bridge for safely undoing one active Canvas patch and all of its active dependent patches in reverse dependency order.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    historyId: z.string().min(1),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, historyId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const history = new CanvasPatchHistoryStore(store.workspacePath)
  const target = await history.get(historyId)
  if (!target) throw new Error('找不到这条 AI 修改历史。')
  if (target.undoneAt) throw new Error('这条 AI 修改已经撤销过。')
  const entries = await history.list(target.path, 200)
  const closure = new Set(canvasPatchDependentClosure(entries, historyId))
  const graph = buildCanvasPatchGraph(entries)
  const ordered = entries
    .filter((entry) => closure.has(entry.id) && !entry.undoneAt)
    .sort((left, right) => (graph.get(right.id)?.depth ?? 0) - (graph.get(left.id)?.depth ?? 0) || right.appliedAt.localeCompare(left.appliedAt))
  if (!ordered.length) throw new Error('当前没有可撤销的 Patch 依赖链。')
  const current = await store.get(target.path)
  if (current.type !== 'canvas') throw new Error('AI Patch 依赖链撤销只支持 Canvas 图。')
  let scene = parseCanvasScene(current.source)
  const reverted = new Set<string>()
  for (const entry of ordered) {
    const result = undoCanvasPatchHistory(scene, entry)
    scene = result.scene
    result.revertedElementIds.forEach((id) => reverted.add(id))
  }
  const diagram = await store.update(target.path, serializeCanvasScene(scene), current.modifiedAt)
  await history.appendUndoBatch(ordered.map((entry) => ({
      path: entry.path,
      targetId: entry.id,
      beforeModifiedAt: current.modifiedAt,
      afterModifiedAt: diagram.modifiedAt,
    })))
  const byId = new Map(scene.elements.map((item) => [item.id, item]))
  const focusNodeIds = [...reverted].filter((id) => byId.get(id)?.type !== 'arrow')
  markThreadDiagram(extra._meta, diagram.path, focusNodeIds, undefined, 'history-undo', diagram.modifiedAt)
  const payload = {
    kind: 'diagram-patch-history-chain-undo',
    workspacePath: store.workspacePath,
    diagram,
    rootHistoryId: historyId,
    historyIds: ordered.map((entry) => entry.id),
    revertedElementIds: [...reverted],
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.redoPatchHistory', {
  title: 'Redo AI Canvas patch',
  description: 'Internal app bridge for safely reapplying one previously undone incremental Canvas patch. Reapplies only fields owned by that transaction and refuses to overwrite later edits to the same fields.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    historyId: z.string().min(1),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, historyId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const history = new CanvasPatchHistoryStore(store.workspacePath)
  const entry = await history.get(historyId)
  if (!entry) throw new Error('找不到这条 AI 修改历史，可能已被清理或属于其他工作空间。')
  if (!entry.undoneAt) throw new Error('这条 AI 修改当前不是已撤销状态，不能重做。')
  const related = await history.list(entry.path, 200)
  const inactiveDependencies = (entry.dependsOnIds ?? []).filter((id) => related.find((item) => item.id === id)?.undoneAt)
  if (inactiveDependencies.length) throw new Error(`这次修改依赖 ${inactiveDependencies.length} 个仍处于撤销状态的上游 Patch，请先重做上游依赖。`)
  const current = await store.get(entry.path)
  if (current.type !== 'canvas') throw new Error('AI Patch 历史重做只支持 Canvas 图。')
  const result = redoCanvasPatchHistory(parseCanvasScene(current.source), entry)
  const diagram = await store.update(entry.path, serializeCanvasScene(result.scene), current.modifiedAt)
  const redoEvent = await history.appendRedo({
    path: entry.path,
    targetId: entry.id,
    beforeModifiedAt: current.modifiedAt,
    afterModifiedAt: diagram.modifiedAt,
  })
  const byId = new Map(result.scene.elements.map((item) => [item.id, item]))
  const focusNodeIds = result.reappliedElementIds.filter((id) => byId.get(id)?.type !== 'arrow')
  markThreadDiagram(extra._meta, diagram.path, focusNodeIds, undefined, 'history-redo', diagram.modifiedAt)
  const payload = {
    kind: 'diagram-patch-history-redo',
    workspacePath: store.workspacePath,
    diagram,
    historyId: entry.id,
    redoEventId: redoEvent.id,
    reappliedElementIds: result.reappliedElementIds,
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.redoPatchHistoryChain', {
  title: 'Redo AI Canvas patch dependency chain',
  description: 'Internal app bridge for safely reapplying one undone Canvas patch and its undone dependent chain in dependency order.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    historyId: z.string().min(1),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, historyId }, extra) => {
  const threadId = toolThreadId(extra._meta)
  const store = await resolveStore(workspacePath, threadId)
  const history = new CanvasPatchHistoryStore(store.workspacePath)
  const target = await history.get(historyId)
  if (!target) throw new Error('找不到这条 AI 修改历史。')
  if (!target.undoneAt) throw new Error('这条 AI 修改当前不是已撤销状态。')
  const entries = await history.list(target.path, 200)
  const closure = new Set(canvasPatchDependentClosure(entries, historyId))
  const graph = buildCanvasPatchGraph(entries)
  const ordered = entries
    .filter((entry) => closure.has(entry.id) && Boolean(entry.undoneAt))
    .sort((left, right) => (graph.get(left.id)?.depth ?? 0) - (graph.get(right.id)?.depth ?? 0) || left.appliedAt.localeCompare(right.appliedAt))
  if (!ordered.length) throw new Error('当前没有可重做的 Patch 依赖链。')
  const availableDependencies = new Set(entries.filter((entry) => !entry.undoneAt).map((entry) => entry.id))
  for (const entry of ordered) {
    const missing = (entry.dependsOnIds ?? []).filter((id) => !availableDependencies.has(id))
    if (missing.length) throw new Error(`无法重做依赖链：Patch ${entry.id} 仍依赖 ${missing.length} 个未恢复的上游 Patch。请先从更上游的根节点重做。`)
    availableDependencies.add(entry.id)
  }
  const current = await store.get(target.path)
  if (current.type !== 'canvas') throw new Error('AI Patch 依赖链重做只支持 Canvas 图。')
  let scene = parseCanvasScene(current.source)
  const reapplied = new Set<string>()
  for (const entry of ordered) {
    const result = redoCanvasPatchHistory(scene, entry)
    scene = result.scene
    result.reappliedElementIds.forEach((id) => reapplied.add(id))
  }
  const diagram = await store.update(target.path, serializeCanvasScene(scene), current.modifiedAt)
  await history.appendRedoBatch(ordered.map((entry) => ({
      path: entry.path,
      targetId: entry.id,
      beforeModifiedAt: current.modifiedAt,
      afterModifiedAt: diagram.modifiedAt,
    })))
  const byId = new Map(scene.elements.map((item) => [item.id, item]))
  const focusNodeIds = [...reapplied].filter((id) => byId.get(id)?.type !== 'arrow')
  markThreadDiagram(extra._meta, diagram.path, focusNodeIds, undefined, 'history-redo', diagram.modifiedAt)
  const payload = {
    kind: 'diagram-patch-history-chain-redo',
    workspacePath: store.workspacePath,
    diagram,
    rootHistoryId: historyId,
    historyIds: ordered.map((entry) => entry.id),
    reappliedElementIds: [...reapplied],
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.rename', {
  title: 'Rename diagram',
  description: 'Rename an existing diagram in place. Pass expectedModifiedAt when available to avoid racing external edits.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    title: z.string().min(1).max(120),
    expectedModifiedAt: z.string().optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, title, expectedModifiedAt }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.rename(diagramPath, title, expectedModifiedAt)
  markThreadDiagram(extra._meta, diagram.path)
  return {
    content: [{ type: 'text', text: `Renamed ${diagramPath} to ${diagram.path}` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.duplicate', {
  title: 'Duplicate diagram',
  description: 'Duplicate an existing diagram beside the source file.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    title: z.string().min(1).max(120).optional(),
  }),
  annotations: write,
}, async ({ workspacePath, path: diagramPath, title }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const diagram = await store.duplicate(diagramPath, title)
  markThreadDiagram(extra._meta, diagram.path)
  return {
    content: [{ type: 'text', text: `Duplicated ${diagramPath} as ${diagram.path}` }],
    structuredContent: { kind: 'diagram', workspacePath: store.workspacePath, diagram },
  }
})

server.registerTool('diagram.delete', {
  title: 'Delete diagram',
  description: 'Delete one diagram from the current workspace. Pass expectedModifiedAt when available to avoid deleting a newly changed file.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    expectedModifiedAt: z.string().optional(),
  }),
  annotations: destructive,
}, async ({ workspacePath, path: diagramPath, expectedModifiedAt }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const deletedPath = await store.delete(diagramPath, expectedModifiedAt)
  clearThreadDiagram(extra._meta, deletedPath)
  return {
    content: [{ type: 'text', text: `Deleted ${deletedPath}` }],
    structuredContent: { kind: 'diagram-deleted', workspacePath: store.workspacePath, path: deletedPath },
  }
})

server.registerTool('diagram.exportAsset', {
  title: 'Export diagram asset',
  description: 'Internal app bridge for saving an exported SVG or PNG into docs/diagrams/exports when the host cannot download files directly.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    filename: z.string().min(1).max(180),
    format: z.enum(['svg', 'png']),
    content: z.string().min(1).max(32 * 1024 * 1024),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, filename, format, content }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const data = format === 'png' ? Buffer.from(content, 'base64') : content
  const assetPath = await store.exportAsset(filename, data)
  const payload = { kind: 'diagram-export', workspacePath: store.workspacePath, path: assetPath }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.importImageAsset', {
  title: 'Import Canvas image asset',
  description: 'Internal app bridge for persisting a PNG, JPEG or WebP used by a Canvas diagram.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
    filename: z.string().min(1).max(220),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    content: z.string().min(1).max(18 * 1024 * 1024),
  }),
  annotations: write,
  _meta: appOnly,
}, async ({ workspacePath, path: diagramPath, filename, mimeType, content }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const asset = await store.importCanvasImage(diagramPath, filename, mimeType, Buffer.from(content, 'base64'))
  const payload = { kind: 'diagram-image-asset', workspacePath: store.workspacePath, ...asset }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

server.registerTool('diagram.readImageAsset', {
  title: 'Read Canvas image asset',
  description: 'Internal app bridge for loading a persisted Canvas image asset.',
  inputSchema: z.object({
    workspacePath: z.string().optional(),
    path: z.string().min(1),
  }),
  annotations: readonly,
  _meta: appOnly,
}, async ({ workspacePath, path: assetPath }, extra) => {
  const store = await resolveStore(workspacePath, toolThreadId(extra._meta))
  const asset = await store.readCanvasImage(assetPath)
  const payload = {
    kind: 'diagram-image-asset-content',
    workspacePath: store.workspacePath,
    path: asset.path,
    mimeType: asset.mimeType,
    content: Buffer.from(asset.content).toString('base64'),
  }
  return {
    content: [{ type: 'text', text: encodeToolResultFallback(payload) }],
    structuredContent: payload,
  }
})

await server.connect(new StdioServerTransport())

function registerWorkspaceResource(name: string, uri: string, surface: DiagramSurface = 'workspace'): void {
  server.registerResource(
    name,
    uri,
    { title: surface === 'thread' ? 'Diagram' : 'Diagram 图表库', mimeType: 'text/html;profile=mcp-app' },
    async () => workspaceResource(uri, surface),
  )
}

function workspaceResource(uri: string, surface: DiagramSurface) {
  return {
    contents: [{
      uri,
      mimeType: 'text/html;profile=mcp-app',
      text: html(surface),
      _meta: {
        'openai/ui': {
          // Codex opens fullscreen MCP Apps as the tab/panel beside the thread.
          // This mirrors MCP for Blender's viewport resource. Inline mode leaves
          // only a tool card in the transcript and does not reliably expose the
          // persistent right-side working surface the Diagram workflow needs.
          preferredDisplayMode: 'fullscreen',
          availableDisplayModes: ['fullscreen'],
        },
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
      },
    }],
  }
}

async function bootstrapWorkspace(threadId?: string): Promise<WorkspaceSnapshot> {
  const boundWorkspace = threadId ? hostWorkspaces.get(threadId) : undefined
  if (boundWorkspace) {
    const store = await DiagramStore.open(boundWorkspace)
    return { kind: 'workspace', workspacePath: store.workspacePath, recentWorkspaces: [], diagrams: await store.list() }
  }
  if (process.env.DIAGRAM_PLUGIN_HOST === 'deepseek') throw new Error('缺少 DeepSeek 会话工作区。')
  const recentWorkspaces = await readRecentWorkspaces()
  const threadWorkspaces = threadId ? await readCodexDesktopRoots(threadId) : []
  const candidates = uniquePaths([
    // A thread-specific writable root/project assignment is the strongest
    // signal for "the directory of this conversation". Keep it ahead of
    // generic MCP roots and recently opened Diagram workspaces so a model
    // initiated diagram.create cannot accidentally write into another project.
    ...threadWorkspaces,
    ...(await clientWorkspaceRoots()),
    ...(!threadId ? await readCodexDesktopRoots() : []),
    ...recentWorkspaces,
  ])
  for (const candidate of candidates) {
    try {
      return await openWorkspace(candidate)
    } catch {
      // Try the next known workspace. Stale recent entries are expected.
    }
  }
  return { kind: 'workspace', recentWorkspaces, diagrams: [] }
}

async function openWorkspace(input: string): Promise<WorkspaceSnapshot> {
  const store = await DiagramStore.open(input)
  const recent = await readRecentWorkspaces()
  const recentWorkspaces = [store.workspacePath, ...recent.filter((item) => item !== store.workspacePath)].slice(0, 12)
  await writeRecentWorkspaces(recentWorkspaces)
  return { kind: 'workspace', workspacePath: store.workspacePath, recentWorkspaces, diagrams: await store.list() }
}

async function resolveStore(workspacePath: string | undefined, threadId?: string): Promise<DiagramStore> {
  if (process.env.DIAGRAM_PLUGIN_HOST === 'deepseek') {
    const boundWorkspace = threadId ? hostWorkspaces.get(threadId) : undefined
    if (!boundWorkspace) throw new Error('缺少 DeepSeek 会话工作区。')
    const store = await DiagramStore.open(boundWorkspace)
    if (workspacePath && (await DiagramStore.open(workspacePath)).workspacePath !== store.workspacePath) {
      throw new Error('图表操作超出当前会话工作区。')
    }
    return store
  }
  if (workspacePath) return DiagramStore.open(workspacePath)
  const snapshot = await bootstrapWorkspace(threadId)
  if (!snapshot.workspacePath) throw new Error('没有可用的 Codex 工作空间，请先在 Diagram 工作台中打开目录。')
  return DiagramStore.open(snapshot.workspacePath)
}

async function clientWorkspaceRoots(): Promise<string[]> {
  try {
    const result = await server.server.listRoots()
    return result.roots.flatMap((root) => {
      try {
        return root.uri.startsWith('file:') ? [fileURLToPath(root.uri)] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

async function readCodexDesktopRoots(threadId?: string): Promise<string[]> {
  if (process.env.DIAGRAM_PLUGIN_HOST === 'deepseek') return []
  const stateFile = process.env.DIAGRAM_PLUGIN_CODEX_STATE
    || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), '.codex-global-state.json')
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as CodexDesktopState
    const roots: string[] = []
    if (threadId) {
      roots.push(...stringArray(state['thread-writable-roots']?.[threadId]))
      const hinted = state['thread-workspace-root-hints']?.[threadId]
      if (typeof hinted === 'string') roots.push(hinted)
      const assignment = state['thread-project-assignments']?.[threadId]
      if (assignment?.projectKind === 'local' && typeof assignment.projectId === 'string') {
        roots.push(...stringArray(state['local-projects']?.[assignment.projectId]?.rootPaths))
      }
    }
    if (roots.length === 0) {
      const selected = state['selected-project']
      if (selected?.type === 'local' && typeof selected.projectId === 'string') {
        roots.push(...stringArray(state['local-projects']?.[selected.projectId]?.rootPaths))
      }
    }
    return uniquePaths(roots)
  } catch {
    return []
  }
}

/** 新的状态目录；未设置 DIAGRAM_PLUGIN_STATE_HOME 时使用。 */
const stateHome = process.env.DIAGRAM_PLUGIN_STATE_HOME || path.join(os.homedir(), '.diagram-plugin')
/** 改名前的状态目录；只读回退，让升级前的最近工作区列表不丢。 */
const legacyStateHome = path.join(os.homedir(), '.codex-diagram')
const recentStateFile = path.join(stateHome, 'sidebar-state.json')
const legacyStateFile = path.join(legacyStateHome, 'sidebar-state.json')

async function readRecentWorkspaces(): Promise<string[]> {
  for (const file of [recentStateFile, legacyStateFile]) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { recentWorkspaces?: unknown }
      const workspaces = stringArray(parsed.recentWorkspaces)
      if (workspaces.length > 0) return workspaces
    } catch {
      continue
    }
  }
  return []
}

async function writeRecentWorkspaces(recentWorkspaces: string[]): Promise<void> {
  await mkdir(path.dirname(recentStateFile), { recursive: true })
  await writeFile(recentStateFile, JSON.stringify({ recentWorkspaces }, null, 2), 'utf8')
}

function toolThreadId(meta: unknown): string | undefined {
  const context = diagramSessionContext(meta)
  if (context) {
    const key = `${context.host}:${JSON.stringify([context.sessionId, context.workspacePath])}`
    hostWorkspaces.set(key, context.workspacePath)
    recordSessionAccess(key)
    return key
  }
  if (process.env.DIAGRAM_PLUGIN_HOST === 'deepseek') throw new Error('缺少 DeepSeek 会话身份。')
  if (!meta || typeof meta !== 'object') return undefined
  const threadId = (meta as Record<string, unknown>).threadId
  if (typeof threadId !== 'string' || !threadId.length) return undefined
  recordSessionAccess(threadId)
  return threadId
}

function recordSessionAccess(key: string): void {
  const now = Date.now()
  sessionLastAccess.delete(key)
  sessionLastAccess.set(key, now)
  if (++sessionSweepCalls < 64 && sessionLastAccess.size <= maxSessionStates) return
  sessionSweepCalls = 0
  for (const [session, lastAccess] of sessionLastAccess) {
    if (lastAccess >= now - sessionIdleLimitMs && sessionLastAccess.size <= maxSessionStates) break
    sessionLastAccess.delete(session)
    hostWorkspaces.delete(session)
    threadSelection.delete(session)
    threadProposals.delete(session)
    threadProposalBranches.delete(session)
    threadGitImpacts.delete(session)
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values)]
}

function fuzzyPathMatch(pathValue: string, query: string): boolean {
  if (pathValue.includes(query)) return true
  const terms = query.split(/[\\/\s]+/).filter(Boolean)
  return terms.every((term) => pathValue.includes(term))
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLocaleLowerCase()
}

function sourcePathMatches(candidate: string, query: string): boolean {
  return candidate === query || candidate.endsWith(`/${query}`) || query.endsWith(`/${candidate}`)
}

async function sourceFileRealpath(file: string): Promise<string | undefined> {
  return realpath(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
}

async function resolveSourceFile(files: string[], sourcePath: string, workspacePath: string): Promise<string | undefined> {
  const input = sourcePath.replace(/\\/g, '/')
  const lexical = path.resolve(workspacePath, input)
  const target = path.isAbsolute(input) ? await sourceFileRealpath(lexical) : lexical
  if (!target) return undefined
  const requested = path.relative(workspacePath, target).split(path.sep).join('/')
  if (requested === '..' || requested.startsWith('../')) throw new Error('源码路径必须位于当前工作空间内。')
  const exact = files.find((file) => file === requested)
  if (exact) return exact
  const matches = files.filter((file) => sourcePathMatches(normalizeSourcePath(file), normalizeSourcePath(requested)))
  if (matches.length > 1) throw new Error(`匹配到多个源码文件，请指定完整相对路径：${matches.join('、')}`)
  return matches[0]
}

async function linkedSourceNodes(nodes: CanvasNode[], workspacePath: string, sourcePath: string): Promise<CanvasNode[]> {
  const target = path.resolve(workspacePath, sourcePath)
  const linked = await Promise.all(nodes.map(async (node) => {
    for (const candidate of node.sourcePaths ?? []) {
      const lexical = path.resolve(workspacePath, candidate.replace(/\\/g, '/'))
      if (lexical === target) return node
      if (path.basename(lexical) === path.basename(target) && await sourceFileRealpath(lexical) === target) return node
    }
    return undefined
  }))
  return linked.filter((node): node is CanvasNode => Boolean(node))
}

interface SourceNodeSpec {
  sourcePath: string
  elementId?: string
  text?: string
  subtitle?: string
  description?: string
  tags?: string[]
  icon?: CanvasIcon
  stencil?: CanvasStencil
  iconRef?: CanvasIconRef
  c4Type?: CanvasC4Type
  groupId?: string
  laneId?: string
}

async function upsertSourceNodeInScene(scene: CanvasScene, realSourcePath: string, spec: SourceNodeSpec, workspacePath: string): Promise<{ nodeId: string; created: boolean }> {
  if (spec.groupId && !scene.groups?.some((group) => group.id === spec.groupId)) throw new Error(`Canvas 中不存在容器：${spec.groupId}`)
  if (spec.laneId && !scene.lanes?.some((lane) => lane.id === spec.laneId)) throw new Error(`Canvas 中不存在泳道：${spec.laneId}`)
  const boxes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const linked = await linkedSourceNodes(boxes, workspacePath, realSourcePath)
  let target = spec.elementId ? boxes.find((item) => item.id === spec.elementId) : undefined
  if (spec.elementId && !target) throw new Error(`Canvas 中不存在节点：${spec.elementId}`)
  if (!target && linked.length > 1) throw new Error(`源码 ${realSourcePath} 已关联多个 Canvas 节点，请传 elementId：${linked.map((item) => item.id).join(', ')}`)
  if (!target) target = linked[0]
  const cleanTags = spec.tags?.map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
  if (target) {
    scene.elements = scene.elements.map((item) => {
      if (item.id !== target!.id || item.type === 'arrow') return item
      return {
        ...item,
        ...(spec.text ? { text: spec.text } : {}),
        ...(spec.subtitle !== undefined ? { subtitle: spec.subtitle || undefined } : {}),
        ...(spec.description !== undefined ? { description: spec.description || undefined } : {}),
        ...(cleanTags ? { tags: cleanTags.length ? cleanTags : undefined } : {}),
        ...(spec.icon ? { icon: spec.icon } : {}),
        ...(spec.stencil ? { stencil: spec.stencil } : {}),
        ...(spec.iconRef ? { iconRef: spec.iconRef } : {}),
        ...(spec.c4Type ? { c4Type: spec.c4Type } : {}),
        ...(spec.groupId ? { groupId: spec.groupId } : {}),
        ...(spec.laneId ? { laneId: spec.laneId } : {}),
        sourcePaths: [...new Set([...(item.sourcePaths ?? []), realSourcePath])],
      }
    })
    return { nodeId: target.id, created: false }
  }

  const nodeId = nextCanvasElementId('node', scene.elements)
  const index = boxes.length
  const columns = 4
  const fileName = path.basename(realSourcePath).replace(/\.[^.]+$/, '')
  const x = 120 + (index % columns) * 280
  const y = 120 + Math.floor(index / columns) * 160
  scene.height = Math.max(scene.height, y + 180)
  scene.elements.push({
    id: nodeId,
    type: 'node',
    x,
    y,
    width: 220,
    height: 96,
    text: spec.text ?? fileName,
    ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
    ...(spec.description ? { description: spec.description } : {}),
    ...(cleanTags?.length ? { tags: cleanTags } : {}),
    ...(spec.icon ? { icon: spec.icon } : {}),
    ...(spec.stencil ? { stencil: spec.stencil } : {}),
    ...(spec.iconRef ? { iconRef: spec.iconRef } : {}),
    ...(spec.c4Type ? { c4Type: spec.c4Type } : {}),
    ...(spec.groupId ? { groupId: spec.groupId } : {}),
    ...(spec.laneId ? { laneId: spec.laneId } : {}),
    sourcePaths: [realSourcePath],
  })
  return { nodeId, created: true }
}

function workspaceContent(snapshot: WorkspaceSnapshot, surface?: DiagramSurface, threadId?: string): Record<string, unknown> {
  const threadState = threadId ? threadSelection.get(threadId) : undefined
  const availablePaths = new Set(snapshot.diagrams.map((diagram) => diagram.path))
  const activeDiagramPath = threadId
    ? (threadState?.path && availablePaths.has(threadState.path) ? threadState.path : undefined)
    : snapshot.activeDiagramPath
  const threadDiagramPaths = threadId
    ? threadState?.diagramPaths?.filter((path) => availablePaths.has(path))
    : snapshot.threadDiagramPaths
  return {
    kind: snapshot.kind,
    surface: surface ?? snapshot.surface,
    workspacePath: snapshot.workspacePath,
    recentWorkspaces: snapshot.recentWorkspaces,
    diagrams: snapshot.diagrams,
    activeDiagramPath,
    threadDiagramPaths,
  }
}

function markThreadDiagram(meta: unknown, diagramPath: string, focusElementIds?: string[], trace?: ThreadTraceState, activityKind?: ThreadDrawActivity['kind'], activityModifiedAt?: string): void {
  const threadId = toolThreadId(meta)
  if (!threadId) return
  const current = threadSelection.get(threadId)
  const now = new Date().toISOString()
  const diagramPaths = current?.diagramPaths?.includes(diagramPath)
    ? current.diagramPaths
    : [...(current?.diagramPaths ?? []), diagramPath]
  threadSelection.set(threadId, {
    path: diagramPath,
    diagramPaths,
    focusElementIds,
    trace,
    activity: activityKind ? { kind: activityKind, path: diagramPath, key: `${activityKind}:${diagramPath}:${now}`, modifiedAt: activityModifiedAt } : current?.activity,
    updatedAt: now,
  })
}

function setThreadProposal(threadId: string, proposal: ThreadDiagramProposal): ThreadDiagramProposal {
  threadProposalBranches.delete(threadId)
  threadProposals.set(threadId, proposal)
  return proposal
}

function setThreadProposalBranch(threadId: string, proposal: ThreadDiagramProposal, branchLabel: string): ThreadDiagramProposal {
  const label = branchLabel.trim().slice(0, 80)
  if (!label) return setThreadProposal(threadId, proposal)
  const result = addProposalBranch(threadProposalBranches.get(threadId), proposal, label, { maxBranches: 6 })
  threadProposalBranches.set(threadId, result.set)
  const next = result.proposal
  threadProposals.set(threadId, next)
  return next
}

function clearThreadProposals(threadId: string): void {
  threadProposals.delete(threadId)
  threadProposalBranches.delete(threadId)
}

function proposalBranchSummaries(threadId: string) {
  const branches = threadProposalBranches.get(threadId)
  if (!branches) return undefined
  return {
    groupId: branches.groupId,
    activeBranchId: branches.activeBranchId,
    branches: branches.proposals.map((proposal) => proposalSummary(proposal)),
  }
}

function clearThreadDiagram(meta: unknown, deletedPath: string): void {
  const threadId = toolThreadId(meta)
  if (!threadId) return
  const current = threadSelection.get(threadId)
  if (!current) return
  const diagramPaths = current.diagramPaths?.filter((path) => path !== deletedPath)
  if (current.path === deletedPath) {
    threadSelection.set(threadId, { diagramPaths, updatedAt: new Date().toISOString() })
  } else if (diagramPaths?.length !== current.diagramPaths?.length) {
    threadSelection.set(threadId, { ...current, diagramPaths, updatedAt: new Date().toISOString() })
  }
  if (threadGitImpacts.get(threadId)?.path === deletedPath) threadGitImpacts.delete(threadId)
}

function gitImpactSummary(value: ThreadGitImpact | undefined) {
  if (!value) return undefined
  const report = value.report as {
    git?: { files?: unknown[] }
    directElementIds?: unknown[]
    trace?: { nodeIds?: unknown[] }
    unmatchedFiles?: unknown[]
  }
  return {
    path: value.path,
    updatedAt: value.updatedAt,
    fileCount: report.git?.files?.length ?? 0,
    directCount: report.directElementIds?.length ?? 0,
    affectedCount: report.trace?.nodeIds?.length ?? 0,
    unmatchedCount: report.unmatchedFiles?.length ?? 0,
  }
}

function proposalRevision(proposal: ThreadDiagramProposal): string {
  return createHash('sha256').update(JSON.stringify(proposal)).digest('hex')
}

function assertProposalRevision(proposal: ThreadDiagramProposal | undefined, expected: string): void {
  if (!proposal || proposalRevision(proposal) !== expected) throw new Error('候选修改已更新，请重新审查后再操作。')
}

function proposalSummary(proposal: ThreadDiagramProposal | undefined) {
  if (!proposal) return undefined
  return {
    revision: proposalRevision(proposal),
    path: proposal.path,
    reason: proposal.reason,
    baseModifiedAt: proposal.baseModifiedAt,
    updatedAt: proposal.updatedAt,
    scopeElementIds: proposal.scopeElementIds,
    newElementIds: proposal.newElementIds,
    impactElementIds: proposal.impactElementIds,
    automaticElementIds: proposal.automaticElementIds,
    branchId: proposal.branchId,
    branchLabel: proposal.branchLabel,
    branchGroupId: proposal.branchGroupId,
    rebased: proposal.rebased,
    rebaseable: Boolean(proposal.canvasPatch),
    patchSummary: proposal.patchSummary,
  }
}

function patchHistorySummary(entry: CanvasPatchHistorySummary, graphNode?: { dependsOnIds: string[]; dependentIds: string[]; depth: number }) {
  return {
    id: entry.id,
    path: entry.path,
    appliedAt: entry.appliedAt,
    reason: entry.reason,
    layout: entry.layout,
    rebased: entry.rebased,
    partial: entry.partial,
    acceptedElementIds: entry.acceptedElementIds,
    scopeElementIds: entry.scopeElementIds,
    automaticElementIds: entry.automaticElementIds,
    proposalBranchId: entry.proposalBranchId,
    proposalBranchLabel: entry.proposalBranchLabel,
    proposalBranchGroupId: entry.proposalBranchGroupId,
    dependsOnIds: graphNode?.dependsOnIds ?? entry.dependsOnIds ?? [],
    dependentIds: graphNode?.dependentIds ?? [],
    dependencyDepth: graphNode?.depth ?? 0,
    undoneAt: entry.undoneAt,
    undoEventId: entry.undoEventId,
    undoBatchId: entry.undoBatchId,
    redoneAt: entry.redoneAt,
    redoEventId: entry.redoEventId,
    redoBatchId: entry.redoBatchId,
    counts: {
      updated: entry.changes.filter((item) => item.kind === 'update').length,
      added: entry.changes.filter((item) => item.kind === 'add').length,
      removed: entry.changes.filter((item) => item.kind === 'remove').length,
      automatic: entry.changes.filter((item) => item.automatic).length,
    },
    changes: entry.changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      automatic: change.automatic,
      declared: change.declared,
      label: canvasHistoryElementLabel(change.after ?? change.before),
      fields: change.before && change.after ? canvasHistoryChangedFields(change.before, change.after) : [change.kind === 'add' ? '新增' : '删除'],
    })),
  }
}

function canvasHistoryElementLabel(element: CanvasElement | undefined): string {
  if (!element) return '未知元素'
  if (element.type === 'arrow') return `${element.from} → ${element.to}${element.label ? ` · ${element.label}` : ''}`
  return element.text || element.id
}

function canvasHistoryChangedFields(before: CanvasElement, after: CanvasElement): string[] {
  const left = before as unknown as Record<string, unknown>
  const right = after as unknown as Record<string, unknown>
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => key !== 'id' && key !== 'type' && JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .map(canvasHistoryFieldLabel)
}

function canvasHistoryFieldLabel(field: string): string {
  return ({
    text: '文字', subtitle: '副标题', description: '说明', tags: '标签', x: 'X', y: 'Y', width: '宽度', height: '高度',
    from: '起点', to: '终点', points: '折点', label: '关系文字', labelPosition: '标签位置', routing: '路由', fromAnchor: '起点锚点', toAnchor: '终点锚点',
    groupId: '边界', laneId: '泳道', c4Type: 'C4', icon: '角色', stencil: '技术栈', iconRef: '显示图标', emphasis: '强调', sourcePaths: '源码', tone: '色调', shape: '旧形状', shapeRef: '图形', fillColor: '填充', strokeColor: '描边', strokeWidth: '线宽', opacity: '透明度', cornerRadius: '圆角', rotation: '旋转', textOnly: '纯文字', fontSize: '字号', fontWeight: '字重', textColor: '文字颜色', start: '自由线起点', end: '自由线终点', markerEnd: '箭头', locked: '锁定', bundleKey: '关系通道', lineStyle: '线型',
  } as Record<string, string>)[field] ?? field
}

function validateCanvasSubgraphProposal(baseSource: string, candidateSource: string, elementIds: string[], newElementIds: string[]): void {
  let base: CanvasScene
  let candidate: CanvasScene
  try {
    base = parseCanvasScene(baseSource)
    candidate = parseCanvasScene(candidateSource)
  } catch {
    throw new Error('Subgraph Proposal 必须提供结构有效的 Canvas JSON。')
  }
  const scope = new Set(elementIds)
  const declaredNew = new Set(newElementIds)
  const baseById = new Map(base.elements.map((item) => [item.id, item]))
  const candidateById = new Map(candidate.elements.map((item) => [item.id, item]))
  const missingScope = [...scope].filter((id) => !baseById.has(id))
  if (missingScope.length) throw new Error(`Subgraph Proposal 包含不存在的基线元素：${missingScope.join(', ')}`)
  const invalidDeclaredNew = [...declaredNew].filter((id) => baseById.has(id))
  if (invalidDeclaredNew.length) throw new Error(`newElementIds 只能声明新增元素：${invalidDeclaredNew.join(', ')}`)
  if (base.title !== candidate.title || base.width !== candidate.width || base.height !== candidate.height) {
    throw new Error('Subgraph Proposal 当前不允许修改画布标题或尺寸；请改用整图 Proposal。')
  }

  const scopedNodes = new Set([...scope].filter((id) => baseById.get(id)?.type !== 'arrow'))
  const allowedExisting = new Set(scope)
  for (const item of base.elements) {
    if (item.type === 'arrow' && (scopedNodes.has(item.from) || scopedNodes.has(item.to))) allowedExisting.add(item.id)
  }
  const changedOutsideScope: string[] = []
  for (const item of base.elements) {
    if (allowedExisting.has(item.id)) continue
    const next = candidateById.get(item.id)
    if (!next || JSON.stringify(item) !== JSON.stringify(next)) changedOutsideScope.push(item.id)
  }
  if (changedOutsideScope.length) {
    throw new Error(`Subgraph Proposal 越界修改了范围外元素：${changedOutsideScope.slice(0, 12).join(', ')}${changedOutsideScope.length > 12 ? '…' : ''}`)
  }

  const additions = candidate.elements.filter((item) => !baseById.has(item.id)).map((item) => item.id)
  const undeclared = additions.filter((id) => !declaredNew.has(id))
  if (undeclared.length) throw new Error(`Subgraph Proposal 含未声明的新元素：${undeclared.join(', ')}`)
  const absentDeclared = [...declaredNew].filter((id) => !candidateById.has(id))
  if (absentDeclared.length) throw new Error(`newElementIds 中的元素没有出现在候选图：${absentDeclared.join(', ')}`)
  const newArrowsOutsideScope = candidate.elements.flatMap((item) => {
    if (item.type !== 'arrow' || !declaredNew.has(item.id)) return []
    const touchesScope = scopedNodes.has(item.from) || scopedNodes.has(item.to) || declaredNew.has(item.from) || declaredNew.has(item.to)
    return touchesScope ? [] : [item.id]
  })
  if (newArrowsOutsideScope.length) {
    throw new Error(`Subgraph Proposal 的新增连线没有连接到当前子图：${newArrowsOutsideScope.join(', ')}`)
  }

  if (JSON.stringify(base.groups ?? []) !== JSON.stringify(candidate.groups ?? [])) {
    throw new Error('Subgraph Proposal 当前不允许修改容器元数据；请改用整图 Proposal。')
  }
  if (JSON.stringify(base.lanes ?? []) !== JSON.stringify(candidate.lanes ?? [])) {
    throw new Error('Subgraph Proposal 当前不允许修改泳道元数据；请改用整图 Proposal。')
  }
}

interface CodexDesktopState {
  'thread-writable-roots'?: Record<string, unknown>
  'thread-workspace-root-hints'?: Record<string, unknown>
  'thread-project-assignments'?: Record<string, { projectKind?: unknown; projectId?: unknown } | undefined>
  'local-projects'?: Record<string, { rootPaths?: unknown } | undefined>
  'selected-project'?: { type?: unknown; projectId?: unknown }
}
