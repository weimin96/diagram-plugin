import type { RefObject } from 'react'
import { MoreHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DiagramCapability } from './diagramCapabilities.js'
import type { ViewMode } from './editorPolicy.js'
import type { MermaidVisualStyle } from './mermaidVisualGrammar.js'

export interface ThreadActionCommands {
  openDiagramList: () => void
  createDiagram: () => void
  generateFromCode: () => void
  modifyCurrent: () => void
  updateFromConversation: () => void
  updateSelection: () => void
  addFailurePaths: () => void
  explainDiagram: () => void
  openPatchHistory: () => void
  reviewProposal: () => void
  reviewChanges: () => void
  exportSvg: () => void
  exportPng: () => void
  save: () => void
}

export interface ThreadActionsProps {
  hasDocument: boolean
  dirty: boolean
  saving: boolean
  follow: { enabled: boolean; paused: boolean; onToggle: () => void }
  modes: {
    visible: boolean
    value: ViewMode
    options: readonly ViewMode[]
    label: (mode: ViewMode) => string
    onChange: (mode: ViewMode) => void
  }
  moreButtonRef: RefObject<HTMLButtonElement | null>
  aiOpen: boolean
  aiSending: boolean
  exporting: boolean
  capability: DiagramCapability
  hasCanvasSelection: boolean
  hasProposal: boolean
  hasChanges: boolean
  style: {
    value: string
    options: { value: string; label: string }[]
    onChange: (value: MermaidVisualStyle) => void
  }
  commands: ThreadActionCommands
}

/**
 * Everything the panel lets you do to the open diagram without leaving it:
 * follow the conversation, switch the view shape, and the ⋯ command menu.
 * Which commands exist is decided by `DiagramCapability`, so a Mermaid document
 * never offers canvas-only actions and vice versa.
 */
export function ThreadActions({
  hasDocument,
  dirty,
  saving,
  follow,
  modes,
  moreButtonRef,
  aiOpen,
  aiSending,
  exporting,
  capability,
  hasCanvasSelection,
  hasProposal,
  hasChanges,
  style,
  commands,
}: ThreadActionsProps) {
  const blocked = dirty || aiSending
  return (
    <div className="thread-document-actions">
      <button
        className={`thread-follow-toggle${follow.enabled ? ' is-active' : ''}${follow.paused ? ' is-paused' : ''}`}
        type="button"
        aria-pressed={follow.enabled}
        title={!follow.enabled ? '已暂停跟随当前对话' : follow.paused ? '有未保存修改，跟随已暂停切换' : '正在跟随当前对话中的图表'}
        onClick={follow.onToggle}
      >
        {follow.enabled ? '跟随中' : '已暂停'}
      </button>
      {hasDocument && modes.visible && modes.options.length > 1 ? (
        <span className="compact-mode-switch" role="group" aria-label="视图模式">
          {modes.options.map((value) => (
            <button
              key={value}
              type="button"
              className={modes.value === value ? 'is-active' : ''}
              aria-pressed={modes.value === value}
              title={`${modes.label(value)}：${value === 'preview' ? '只看渲染结果' : value === 'source' ? '编辑源码' : '源码与预览并排'}`}
              onClick={() => modes.onChange(value)}
            >
              {modes.label(value)}
            </button>
          ))}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button ref={moreButtonRef} variant="ghost" size="icon-sm" aria-label="更多图表操作"><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(event) => { if (aiOpen) event.preventDefault() }}>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={commands.openDiagramList}>打开图表</DropdownMenuItem>
            <DropdownMenuItem onSelect={commands.createDiagram}>新建图表</DropdownMenuItem>
            <DropdownMenuItem onSelect={commands.generateFromCode}>从代码生成</DropdownMenuItem>
            {hasDocument ? <DropdownMenuItem disabled={blocked} onSelect={commands.modifyCurrent}>修改当前图</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          {hasDocument ? <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={blocked} onSelect={commands.updateFromConversation}>按对话更新</DropdownMenuItem>
              {capability.visualEdit && hasCanvasSelection ? <DropdownMenuItem disabled={blocked} onSelect={commands.updateSelection}>调整选中</DropdownMenuItem> : null}
              <DropdownMenuItem disabled={blocked} onSelect={commands.addFailurePaths}>补异常路径</DropdownMenuItem>
              <DropdownMenuItem disabled={aiSending} onSelect={commands.explainDiagram}>解释图表</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {capability.patchHistory ? <DropdownMenuItem onSelect={commands.openPatchHistory}>修改记录</DropdownMenuItem> : <DropdownMenuSub>
                <DropdownMenuSubTrigger>图表样式</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-auto">
                  <DropdownMenuRadioGroup value={style.value} onValueChange={(value) => style.onChange(value as MermaidVisualStyle)}>
                    {style.options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>}
              {hasProposal ? <DropdownMenuItem onSelect={commands.reviewProposal}>候选修改</DropdownMenuItem> : null}
              {hasChanges ? <DropdownMenuItem onSelect={commands.reviewChanges}>查看变更</DropdownMenuItem> : null}
              <DropdownMenuItem disabled={exporting} onSelect={commands.exportSvg}>导出 SVG</DropdownMenuItem>
              <DropdownMenuItem disabled={exporting} onSelect={commands.exportPng}>导出 PNG</DropdownMenuItem>
            </DropdownMenuGroup>
          </> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {hasDocument ? dirty || saving ? <button className="primary-button compact" type="button" disabled={saving} onClick={commands.save}>{saving ? '保存中…' : '保存'}</button> : <span className="save-state">已保存</span> : null}
    </div>
  )
}
