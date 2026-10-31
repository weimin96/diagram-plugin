import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import { boundArguments, confirmedArchitectureStyle, inspectionDirectory, isModelTool, toolName } from './bridge.mjs'
import { architectureStyleQuestion } from '../../src/architectureStyle.ts'
import { isArchitectureIntent } from '../../src/architectureSkill.ts'

export const name = 'diagram'
export const inject = ['tools', 'connection', 'sessionController', 'workingDirectory', 'systemPrompt']

export async function apply(ctx) {
  const directory = path.dirname(fileURLToPath(import.meta.url))
  const client = new Client({ name: 'diagram-plugin', version: __DIAGRAM_PLUGIN_VERSION__ })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(directory, 'server.mjs')],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/KEY|PASSWORD|SECRET|TOKEN|^DSH_/i.test(key))), ELECTRON_RUN_AS_NODE: '1', DIAGRAM_PLUGIN_HOST: 'deepseek' },
    stderr: 'inherit',
  })
  ctx.effect(() => () => client.close())
  await client.connect(transport)
  const tools = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]))
  const adaptInstructions = (text) => text.replaceAll(/diagram\.[A-Za-z][A-Za-z0-9]*/g, (raw) => tools.has(raw) ? toolName(raw) : raw).replaceAll('Codex', 'the assistant')
  const openRequests = new Map()
  let openSequence = 0

  async function sessionContext(sessionId, signal, agent) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('缺少 Diagram 会话身份。')
    const workspacePath = agent
      ? ctx.workingDirectory.get(agent.session)
      : inspectionDirectory(await ctx.sessionController.inspect(sessionId, signal))
    const bound = await boundArguments({}, workspacePath)
    return { host: 'deepseek', sessionId, workspacePath: bound.workspacePath }
  }

  async function call(name, args, context, signal) {
    if (!tools.has(name)) throw new Error(`未知的 Diagram 工具：${name}`)
    const bound = await boundArguments(args, context.workspacePath)
    // Only tools declaring workspacePath receive it; internal state tools use the trusted metadata.
    if (!tools.get(name).inputSchema.properties?.workspacePath) delete bound.workspacePath
    const result = await client.callTool({ name, arguments: bound, _meta: { 'diagram/context': context } }, undefined, { signal, timeout: 60_000 })
    return result
  }

  for (const tool of tools.values()) {
    if (!isModelTool(tool)) continue
    const definition = createMcpToolDefinition(ctx, {
      name: toolName(tool.name), rawName: tool.name,
      description: adaptInstructions(tool.description ?? ''),
      inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
      call: async (args, execution) => {
        if (!execution.agent) throw new Error('Diagram 工具必须由会话调用。')
        const context = await sessionContext(execution.agent.session.id, execution.signal, execution.agent)
        if (tool.name === 'diagram.composeArchitecture' || tool.name === 'diagram.create' || tool.name === 'diagram.designGuide') {
          const inspection = await ctx.sessionController.inspect(context.sessionId, execution.signal)
          const { text, style } = confirmedArchitectureStyle(inspection)
          const architectureRequest = isArchitectureIntent(text)
          const composing = tool.name === 'diagram.composeArchitecture'
          const creating = tool.name === 'diagram.create'
          const guiding = tool.name === 'diagram.designGuide'
          if (composing || (creating && architectureRequest)
            || (guiding && (architectureRequest || isArchitectureIntent(args.intent ?? '')))) {
            if (!style) return {
              content: [{ type: 'text', text: architectureStyleQuestion + '\n请先向用户询问，收到用户回答前不要调用任何创建或修改图表的工具。' }],
              isError: !guiding,
              structuredContent: { kind: 'architecture-style-required', question: architectureStyleQuestion },
            }
            if ((composing || guiding) && args.architectureStyle && args.architectureStyle !== style)
              throw new Error('架构风格与用户本轮明确选择不一致，请使用用户选择的风格。')
            if (composing && args.architectureStyle !== style)
              throw new Error('必须使用用户实际选择的 architectureStyle，而不是模型自行填写的风格。')
            if (guiding) args = { ...args, architectureStyle: style }
          }
        }
        const result = await call(tool.name, args, context, execution.signal)
        if (tool.name === 'diagram.thread' && !result.isError) {
          openRequests.delete(context.sessionId)
          openRequests.set(context.sessionId, ++openSequence)
          if (openRequests.size > 512) openRequests.delete(openRequests.keys().next().value)
        }
        return result
      },
    })
    ctx.effect(() => ctx.tools.register(definition))
  }
  const instructions = client.getInstructions()
  if (instructions) ctx.systemPrompt.section({
    name: 'diagram:instructions', order: 500, interpolate: false,
    text: adaptInstructions(instructions),
  })

  const [appJs, appCss] = await Promise.all([
    readFile(path.join(directory, 'app.js'), 'utf8'), readFile(path.join(directory, 'app.css'), 'utf8'),
  ])
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${appCss}</style></head><body><div id="root" data-diagram-host="deepseek" data-diagram-surface="thread"></div><script>${appJs.replaceAll('</script', '<\\/script')}</script></body></html>`
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/diagram/app', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }),
  }))
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/diagram/call', methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json()
        if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) throw new Error('缺少 Diagram 会话身份。')
        const context = await sessionContext(body.sessionId, request.signal)
        if (body.method === 'status') return Response.json({ result: { openRequest: openRequests.get(body.sessionId) ?? 0 } })
        let result
        if (body.method === 'tool') {
          const tool = tools.get(body.params?.name)
          if (!tool || (Array.isArray(tool._meta?.ui?.visibility) && !tool._meta.ui.visibility.includes('app'))) throw new Error('该操作不允许由图表面板调用。')
          result = await call(tool.name, body.params.arguments ?? {}, context, request.signal)
        } else if (body.method === 'filePath') {
          if (typeof body.params?.path !== 'string' || !path.isAbsolute(body.params.path)) throw new Error('文件路径无效。')
          const target = await realpath(body.params.path)
          const relative = path.relative(context.workspacePath, target)
          if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('文件超出当前会话工作区。')
          result = target
        } else throw new Error('未知的图表面板操作。')
        return Response.json({ result })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
      }
    },
  }))
}
