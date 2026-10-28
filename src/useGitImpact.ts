import { errorMessage } from './errors.js'
import { callTool, sendHostMessage } from './hostRuntime.js'
import type { DiagramDocument } from './types.js'
import type { DiagramGitImpactResult } from './reviewTypes.js'
import type { DiagramCapability } from './diagramCapabilities.js'
import type { ThreadFocus } from './useThreadFollow.js'

export interface GitImpactDeps {
  threadSurface: boolean
  workspacePath: string
  selected: DiagramDocument | null
  capability: DiagramCapability
  gitImpactReport: DiagramGitImpactResult | null
  setGitImpactReport: (report: DiagramGitImpactResult | null) => void
  setGitImpactOpen: (open: boolean) => void
  setCanvasFocus: (focus: ThreadFocus | null) => void
  setAiSending: (value: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string) => void
}

export interface GitImpact {
  analyzeGitImpact: (baseRef?: string) => Promise<void>
  explainGitImpact: () => Promise<void>
  clearGitImpact: () => Promise<void>
}

/** Turning real Git changes into a diagram trace, and explaining it in the conversation. */
export function useGitImpact(deps: GitImpactDeps): GitImpact {
  const {
    threadSurface,
    workspacePath,
    selected,
    capability,
    gitImpactReport,
    setGitImpactReport,
    setGitImpactOpen,
    setCanvasFocus,
    setAiSending,
    setError,
    setNotice,
  } = deps

  async function analyzeGitImpact(baseRef?: string) {
    if (!selected || !capability.visualEdit) return
    setError(null)
    try {
      const result = await callTool<DiagramGitImpactResult>('diagram.impactFromGit', {
        workspacePath,
        path: selected.path,
        ...(baseRef?.trim() ? { baseRef: baseRef.trim() } : {}),
        direction: 'both',
        depth: 2,
        includeUntracked: true,
      })
      setGitImpactReport(result)
      setGitImpactOpen(true)
      setCanvasFocus(result.trace.nodeIds.length ? {
        ids: result.trace.nodeIds,
        key: `git-impact-${Date.now()}`,
        trace: result.directElementIds.length ? {
          seedElementIds: result.directElementIds,
          direction: result.direction,
          depth: result.depth,
        } : undefined,
      } : null)
      setNotice(result.directElementIds.length
        ? `代码影响：${result.git.files.length} 个改动文件 · ${result.directElementIds.length} 个直接节点 · ${Math.max(0, result.trace.nodeIds.length - result.directElementIds.length)} 个间接影响`
        : `发现 ${result.git.files.length} 个 Git 改动文件，但当前图没有 sourcePaths 命中`)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  async function explainGitImpact() {
    if (!gitImpactReport) return
    setAiSending(true)
    setError(null)
    try {
      const direct = gitImpactReport.buckets.find((bucket) => bucket.distance === 0)?.elementIds ?? []
      const oneHop = gitImpactReport.buckets.find((bucket) => bucket.distance === 1)?.elementIds ?? []
      const twoHop = gitImpactReport.buckets.find((bucket) => bucket.distance === 2)?.elementIds ?? []
      await sendHostMessage([
        '基于当前 Diagram 的 Git 影响报告分析这次代码改动。请先核对真实代码事实，再说明影响链路、风险点、需要回归的模块和可能遗漏的图节点。',
        `图表：${gitImpactReport.path}`,
        `Git 改动文件：${gitImpactReport.git.files.map((file) => file.path).join(', ') || '无'}`,
        `直接命中节点：${direct.join(', ') || '无'}`,
        `1 跳影响：${oneHop.join(', ') || '无'}`,
        `2 跳影响：${twoHop.join(', ') || '无'}`,
        `未映射文件：${gitImpactReport.unmatchedFiles.map((file) => file.path).join(', ') || '无'}`,
        '不要仅复述列表；结合源码调用、数据流和外部依赖判断真实影响。对于架构上重要但未映射的真实源码，先阅读后可使用 diagram.upsertSourceNodes 批量补充节点；测试、文档、生成文件不要为了覆盖率机械加入架构图。',
      ].join('\n'))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAiSending(false)
    }
  }

  async function clearGitImpact() {
    setGitImpactReport(null)
    setGitImpactOpen(false)
    setCanvasFocus(null)
    if (!threadSurface) return
    try {
      await callTool<{ kind: 'diagram-git-impact-dismissed' }>('diagram.dismissGitImpact', {})
    } catch {
      // Clearing the local visualization is still useful if the host bridge is temporarily unavailable.
    }
  }

  return { analyzeGitImpact, explainGitImpact, clearGitImpact }
}
