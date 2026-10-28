import { useEffect, useRef } from 'react'
import { buildGenerationPrompt, buildModificationPrompt, buildSubgraphModificationPrompt, type DiagramGenerationRequest } from './aiPrompts.js'
import type { CanvasSelection } from './CanvasEditor.js'
import type { DiagramCapability } from './diagramCapabilities.js'
import { errorMessage } from './errors.js'
import { callTool, host, sendHostMessage } from './hostRuntime.js'
import type { DiagramDocument, DiagramSummary, WorkspaceSnapshot } from './types.js'
import type { DiagramListResult } from './reviewTypes.js'

export interface AiRequestsDeps {
  workspacePath: string
  snapshot: WorkspaceSnapshot
  onSnapshot: (next: WorkspaceSnapshot | ((current: WorkspaceSnapshot) => WorkspaceSnapshot)) => void
  selected: DiagramDocument | null
  dirty: boolean
  capability: DiagramCapability
  canvasSelection: CanvasSelection | null
  aiSending: boolean
  aiReturnFocus: React.RefObject<HTMLElement | null>
  threadMoreButton: React.RefObject<HTMLElement | null>
  selectDiagram: (diagramPath: string, force?: boolean, remember?: boolean) => Promise<void>
  setAiSending: (value: boolean) => void
  setAiOpen: (open: boolean) => void
  setAiMode: (mode: 'generate' | 'modify') => void
  setGenerationPreset: (preset: { key: number; scope: string; title: string; instructions: string }) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
}

export interface AiRequests {
  sendGeneration: (request: DiagramGenerationRequest) => Promise<boolean>
  sendModification: (instruction: string) => Promise<boolean>
  updateSelectedCanvasFromConversation: () => Promise<void>
  openAiPanel: (mode: 'generate' | 'modify') => void
  openWorkspaceGeneration: () => void
  explainInConversation: () => Promise<void>
  updateFromConversation: () => void
}

/**
 * Sending work to the conversation, and watching for the diagram it creates.
 *
 * The watcher lives here because it is the second half of the same request: after a
 * generation prompt goes out, the only thing that closes the loop is a new file
 * appearing in the workspace.
 */
export function useAiRequests(deps: AiRequestsDeps): AiRequests {
  const {
    workspacePath,
    snapshot,
    onSnapshot,
    selected,
    dirty,
    capability,
    canvasSelection,
    aiSending,
    aiReturnFocus,
    threadMoreButton,
    selectDiagram,
    setAiSending,
    setAiOpen,
    setAiMode,
    setGenerationPreset,
    setError,
    setNotice,
  } = deps

  const aiWatch = useRef<{ until: number; existingPaths: Set<string> } | null>(null)

  useEffect(() => {
    let inFlight = false
    const handle = window.setInterval(() => {
      const watch = aiWatch.current
      if (!watch || inFlight) return
      if (Date.now() > watch.until) {
        aiWatch.current = null
        setError('未检测到 AI 创建的新图表。可以刷新列表，或在当前对话中查看任务执行结果。')
        return
      }
      inFlight = true
      void callTool<DiagramListResult>('diagram.list', { workspacePath })
        .then(async (result) => {
          onSnapshot({ ...snapshot, diagrams: result.diagrams })
          const created = result.diagrams.find((item) => !watch.existingPaths.has(item.path))
          if (created && !dirty) {
            aiWatch.current = null
            await selectDiagram(created.path)
            setNotice(`AI 已创建 ${created.name}`)
          }
        })
        .catch((cause) => {
          aiWatch.current = null
          setError(`自动刷新图表失败：${errorMessage(cause)}`)
        })
        .finally(() => { inFlight = false })
    }, 1_600)
    return () => window.clearInterval(handle)
  }, [dirty, onSnapshot, snapshot, workspacePath])

  async function sendGeneration(request: DiagramGenerationRequest) {
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return false
    }
    setAiSending(true)
    setError(null)
    try {
      aiWatch.current = {
        until: Date.now() + 90_000,
        existingPaths: new Set(snapshot.diagrams.map((item) => item.path)),
      }
      await sendHostMessage(buildGenerationPrompt(workspacePath, request))
      setNotice('已发送到当前 对话，生成后会自动刷新')
      return true
    } catch (cause) {
      aiWatch.current = null
      setError(errorMessage(cause))
      return false
    } finally {
      setAiSending(false)
    }
  }

  async function sendModification(instruction: string) {
    if (!selected) return false
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return false
    }
    if (dirty) {
      setError('先保存当前修改，再让 AI 继续编辑这张图。')
      return false
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage(buildModificationPrompt(workspacePath, selected, instruction))
      setNotice('已发送到当前 对话；AI 返回候选修改后会先进入 Proposal 审查')
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setAiSending(false)
    }
  }

  async function updateSelectedCanvasFromConversation() {
    if (!selected || !capability.visualEdit || !canvasSelection?.elements.length) return
    const compact = canvasSelection.elements.map((element) => {
      if (element.type === 'arrow') return { id: element.id, type: element.type, from: element.from, to: element.to, label: element.label, lineStyle: element.lineStyle, routing: element.routing, fromAnchor: element.fromAnchor, toAnchor: element.toAnchor, fromPortRatio: element.fromPortRatio, toPortRatio: element.toPortRatio, points: element.points, labelPosition: element.labelPosition, emphasis: element.emphasis, bundleKey: element.bundleKey }
      return { id: element.id, type: element.type, text: element.text, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, tone: element.tone, shape: element.shape, shapeRef: element.shapeRef, textOnly: element.type === 'note' ? element.textOnly : undefined, fontSize: element.type === 'note' ? element.fontSize : undefined, fontWeight: element.type === 'note' ? element.fontWeight : undefined, textColor: element.type === 'note' ? element.textColor : undefined, imagePath: element.type === 'note' ? element.imagePath : undefined, imageFit: element.type === 'note' ? element.imageFit : undefined, icon: element.icon, stencil: element.stencil, c4Type: element.c4Type, subtitle: element.subtitle, description: element.description, tags: element.tags, locked: element.locked, groupId: element.groupId, laneId: element.laneId, sourcePaths: element.sourcePaths }
    })
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return
    }
    if (dirty) {
      setError('先保存当前修改，再让 AI 继续编辑这张图。')
      return
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage(buildSubgraphModificationPrompt(
        workspacePath,
        selected,
        canvasSelection.ids,
        [
          '结合当前对话中用户最新的要求调整当前选区。',
          '当前选区结构：',
          JSON.stringify(compact),
        ].join('\n'),
      ))
      setAiOpen(false)
      setNotice('已发送子图修改请求，候选完成后会在右侧进入 Proposal 审查')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  function openAiPanel(mode: 'generate' | 'modify') {
    const focused = document.activeElement as HTMLElement | null
    aiReturnFocus.current = focused?.closest('[role="menu"]') ? threadMoreButton.current : focused
    setAiMode(mode)
    setAiOpen(true)
  }

  function openWorkspaceGeneration() {
    setGenerationPreset({
      key: Date.now(),
      scope: '.',
      title: '',
      instructions: '先识别核心模块和边界，再画主要依赖或调用关系；不要把所有文件都展开。',
    })
    openAiPanel('generate')
  }

  async function explainInConversation() {
    if (!selected || aiSending) return
    if (!host.sendMessage) {
      setError('当前宿主没有提供对话消息能力。')
      return
    }
    setAiSending(true)
    setError(null)
    try {
      await sendHostMessage([
        '解释 Diagram 侧边栏当前选中的图表，并在当前对话中回答，不要修改文件。',
        `工作空间：${workspacePath}`,
        `图表路径：${selected.path}`,
        `图表类型：${selected.type}`,
        '',
        '先调用 diagram.get 读取最新版本；结合当前对话上下文说明主流程、关键边界、异常路径和最值得关注的设计点。',
      ].join('\n'))
      setNotice('已让 AI 在当前对话中解释这张图')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  function updateFromConversation() {
    void sendModification('结合当前对话中用户最新提出的需求和已确认的代码事实更新这张图。只调整受当前对话影响的部分，保留仍然正确的结构。')
  }

  return {
    sendGeneration,
    sendModification,
    updateSelectedCanvasFromConversation,
    openAiPanel,
    openWorkspaceGeneration,
    explainInConversation,
    updateFromConversation,
  }
}
