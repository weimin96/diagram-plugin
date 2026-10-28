import { extractToolResultError, extractToolResultPayload } from './toolResult.js'
import { createCodexHost } from './hosts/codex.js'
import { createDeepSeekHost } from './hosts/deepseek.js'
import type { DiagramHost } from './hosts/types.js'
import type { ToolResultLike } from './toolResult.js'

declare const __DIAGRAM_PLUGIN_VERSION__: string

/** The single host bridge. Every module that needs a tool call imports this one. */
const rootElement = document.getElementById('root')!

export const host: DiagramHost = rootElement.dataset.diagramHost === 'deepseek'
  ? createDeepSeekHost()
  : createCodexHost(__DIAGRAM_PLUGIN_VERSION__)

export const hostSurface: 'thread' | 'workspace' = rootElement.dataset.diagramSurface === 'thread' ? 'thread' : 'workspace'

export async function callTool<T>(name: string, arguments_: Record<string, unknown>): Promise<T> {
  const result = await host.callServerTool({ name, arguments: arguments_ }) as ToolResultLike
  const serverError = extractToolResultError(result)
  if (serverError) throw new Error(serverError)
  const payload = extractToolResultPayload<T>(result)
  if (payload === undefined) throw new Error(`${name} 没有返回可解析结果。`)
  return payload
}

export async function sendHostMessage(text: string): Promise<void> {
  if (!host.sendMessage) throw new Error('当前宿主没有提供对话消息能力。')
  await host.sendMessage(text)
}
