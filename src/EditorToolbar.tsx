import type { ReactNode } from 'react'
import { MoreHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ViewMode } from './editorPolicy.js'
import type { MermaidVisualStyle } from './mermaidVisualGrammar.js'

export interface EditorToolbarProps {
  name: string
  path: string
  exporting: boolean
  onGenerate: () => void
  onExportSvg: () => void
  onExportPng: () => void
  styleSelect: {
    visible: boolean
    value: string
    shared: readonly { id: string; label: string }[]
    onChange: (value: MermaidVisualStyle) => void
  }
  mode: { value: ViewMode; onChange: (value: ViewMode) => void }
  changeReview: { visible: boolean; onOpen: () => void }
  proposal: { visible: boolean; onOpen: () => void }
  patchHistory: { visible: boolean; open: boolean; onOpen: () => void }
  save: { dirty: boolean; saving: boolean; onSave: () => void }
  menu: {
    open: boolean
    onOpenChange: (open: boolean) => void
    dirty: boolean
    onRename: () => void
    onDuplicate: () => void
    onDelete: () => void
  }
}

function ModeButton({ value, mode, onChange, children }: { value: ViewMode; mode: ViewMode; onChange: (value: ViewMode) => void; children: ReactNode }) {
  return (
    <button type="button" className={mode === value ? 'is-active' : ''} onClick={() => onChange(value)}>{children}</button>
  )
}

/**
 * The wide (workspace) chrome: document identity, export, style, view mode,
 * review entry points and the document menu. It is shown only when
 * `resolveEditorPolicy` decides the surface has room for the full toolbar; the
 * narrow panel gets the compact header instead.
 */
export function EditorToolbar({
  name,
  path,
  exporting,
  onGenerate,
  onExportSvg,
  onExportPng,
  styleSelect,
  mode,
  changeReview,
  proposal,
  patchHistory,
  save,
  menu,
}: EditorToolbarProps) {
  return (
    <header className="editor-toolbar">
      <div className="document-identity">
        <strong>{name}</strong>
        <span>{path}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" onClick={onGenerate}>生成</button>
        <div className="export-actions" aria-label="导出图表">
          <button type="button" disabled={exporting} onClick={onExportSvg}>{exporting ? '导出中…' : 'SVG'}</button>
          <button type="button" disabled={exporting} onClick={onExportPng}>PNG</button>
        </div>
        {styleSelect.visible ? <select className="freeform-visual-style" aria-label="图表样式" value={styleSelect.value} onChange={(event) => styleSelect.onChange(event.target.value as MermaidVisualStyle)}>
          <optgroup label="共享样式">{styleSelect.shared.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</optgroup>
          <optgroup label="经典排版"><option value="technical">工程文档</option><option value="minimal">极简</option><option value="editorial">叙事</option><option value="presentation">汇报</option></optgroup>
        </select> : null}
        <div className="mode-switch" aria-label="视图模式">
          <ModeButton value="preview" mode={mode.value} onChange={mode.onChange}>预览</ModeButton>
          <ModeButton value="source" mode={mode.value} onChange={mode.onChange}>源码</ModeButton>
          <ModeButton value="split" mode={mode.value} onChange={mode.onChange}>分屏</ModeButton>
        </div>
        {changeReview.visible ? (
          <button className="change-review-trigger" type="button" onClick={changeReview.onOpen}>变更</button>
        ) : null}
        {proposal.visible ? <button className="proposal-review-trigger" type="button" onClick={proposal.onOpen}>候选修改</button> : null}
        {patchHistory.visible ? <button className={`patch-history-trigger${patchHistory.open ? ' is-active' : ''}`} type="button" onClick={patchHistory.onOpen}>历史</button> : null}
        <span className={`save-state${save.dirty ? ' is-dirty' : ''}`}>{save.saving ? '保存中…' : save.dirty ? '未保存' : '已保存'}</span>
        {save.dirty || save.saving ? <button className="primary-button compact" type="button" disabled={save.saving} onClick={save.onSave}>保存</button> : null}
        <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="更多图表操作">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={menu.dirty} onSelect={menu.onRename}>重命名</DropdownMenuItem>
              <DropdownMenuItem disabled={menu.dirty} onSelect={menu.onDuplicate}>复制图表</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" disabled={menu.dirty} onSelect={menu.onDelete}>删除图表</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
