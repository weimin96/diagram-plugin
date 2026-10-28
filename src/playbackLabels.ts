import type { DiagramThreadActivityKind } from './reviewTypes.js'

/** How a background write is described while the canvas plays it back. */
export function playbackActivityLabel(kind: DiagramThreadActivityKind): string {
  if (kind === 'create') return 'AI 正在创建画板'
  if (kind === 'source-sync') return 'AI 正在同步源码节点'
  if (kind === 'proposal') return 'AI 正在应用候选修改'
  if (kind === 'history-undo') return '正在撤销 AI 修改'
  if (kind === 'history-redo') return '正在重做 AI 修改'
  return 'AI 正在更新画板'
}
