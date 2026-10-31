import path from 'node:path'
import { realpath } from 'node:fs/promises'
import { detectArchitectureStyle } from '../../src/architectureStyle.ts'

/** Read the actual human prompt from DSH's durable session log, never a model-supplied style claim. */
export function confirmedArchitectureStyle(inspection) {
  const events = inspection.events ?? []
  const lastUserIndex = events.findLastIndex((event) =>
    event.type === 'user/message' && event.data?.source?.kind === 'user')
  if (lastUserIndex < 0) return { text: '', style: undefined }
  const text = (events[lastUserIndex].data.content ?? [])
    .filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  const explicit = detectArchitectureStyle(text)
  if (explicit) return { text, style: explicit }
  // A short choice is authoritative only after the assistant actually asked the two-style question.
  const previousUserIndex = events.findLastIndex((event, index) => index < lastUserIndex
    && event.type === 'user/message' && event.data?.source?.kind === 'user')
  const assistantText = events.slice(previousUserIndex + 1, lastUserIndex)
    .filter((event) => event.type === 'assistant/message')
    .flatMap((event) => (event.data?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text))
    .join('\n')
  if (assistantText.includes('国内企业方案风格') && assistantText.includes('国际工程架构风格')) {
    if (/^(?:我)?(?:选择?|用|要|就)?\s*(?:第?[一1](?:种|个)?|国内(?:的)?)(?:吧|，.*|。.*)?$/.test(text.trim()))
      return { text, style: 'enterprise' }
    if (/^(?:我)?(?:选择?|用|要|就)?\s*(?:第?[二2](?:种|个)?|国际(?:的)?)(?:吧|，.*|。.*)?$/.test(text.trim()))
      return { text, style: 'engineering' }
  }
  return { text, style: undefined }
}

export function isModelTool(tool) {
  const visibility = tool._meta?.ui?.visibility
  return !Array.isArray(visibility) || visibility.includes('model')
}

export function toolName(rawName) {
  if (!/^diagram\.[A-Za-z][A-Za-z0-9]*$/.test(rawName)) throw new Error(`无效的 Diagram 工具名称：${rawName}`)
  return rawName.replace('.', '_')
}

export async function boundArguments(args, workspacePath) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('图表工具参数无效。')
  const workspace = await realpath(workspacePath)
  if (args.workspacePath !== undefined) {
    if (typeof args.workspacePath !== 'string' || !path.isAbsolute(args.workspacePath)
      || await realpath(args.workspacePath) !== workspace) throw new Error('图表操作超出当前会话工作区。')
  }
  return { ...args, workspacePath: workspace }
}

export function inspectionDirectory(inspection) {
  let directory = inspection.meta.cwd
  for (const event of inspection.events) {
    if (event.type === 'working-directory/change') directory = event.data.cwd
  }
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('当前会话没有有效的本地工作区。')
  return directory
}
