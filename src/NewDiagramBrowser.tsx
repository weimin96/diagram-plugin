import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/diagram/icon-button'
import { createTemplate } from './templates.js'
import { createSafeSvgElement, renderMermaidSvg } from './mermaidRender.js'
import type { CanvasWorkbenchMode } from './canvas.js'
import { diagramTypeGroups, type DiagramType, type MermaidDiagramType } from './types.js'

export type NewDiagramChoice = {
  key: string
  label: string
  meta: string
  type: DiagramType
  canvasWorkbench?: CanvasWorkbenchMode
}

const canvasWorkbenchChoices: NewDiagramChoice[] = [
  { key: 'canvas:architecture', label: '系统架构', meta: '组件 · 边界 · 依赖', type: 'canvas', canvasWorkbench: 'architecture' },
  { key: 'canvas:flowchart', label: '流程画布', meta: '流程 · 连线 · 泳道', type: 'canvas', canvasWorkbench: 'flowchart' },
  { key: 'canvas:freeform', label: '自由画布', meta: '通用绘图', type: 'canvas', canvasWorkbench: 'freeform' },
]

const newDiagramChoiceGroups = [
  { key: 'canvas', label: '画布', items: canvasWorkbenchChoices },
  ...diagramTypeGroups.filter((group) => group.category !== 'canvas').map((group) => ({
    key: group.category,
    label: group.label,
    items: group.items.map((item) => ({
      key: `mermaid:${item.type}`,
      label: item.type === 'flowchart' ? '自动布局流程图' : item.label,
      meta: '自动布局',
      type: item.type,
    } satisfies NewDiagramChoice)),
  })),
]

export function NewDiagramForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) => Promise<void> }) {
  const [choice, setChoice] = useState<NewDiagramChoice | null>(null)
  const [previewChoice, setPreviewChoice] = useState<NewDiagramChoice | null>(null)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const visiblePreview = previewChoice ?? choice

  function resetChoice() {
    if (submitting) return
    setChoice(null)
    setPreviewChoice(null)
    setTitle('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choice || !title.trim()) return
    setSubmitting(true)
    void onCreate(choice.type, title, choice.canvasWorkbench).finally(() => setSubmitting(false))
  }

  return (
    <div className="new-diagram-form">
      <div className="new-diagram-form-head">
        <strong>新建图表</strong>
        <IconButton icon={XIcon} label="关闭新建图表" onClick={onCancel} />
      </div>
      <div className="new-diagram-browser">
        <div className="new-diagram-type-groups" aria-label="图表类型">
          {newDiagramChoiceGroups.map((group) => (
            <section className="new-diagram-type-group" key={group.key}>
              <span>{group.label}</span>
              <div>
                {group.items.map((item) => (
                  <Button
                    key={item.key}
                    type="button"
                    variant={choice?.key === item.key ? 'default' : 'secondary'}
                    className="h-auto min-h-10 justify-between px-3 py-2 text-left"
                    onClick={() => {
                      setChoice(item)
                      setPreviewChoice(null)
                      setTitle('')
                    }}
                    onMouseEnter={() => setPreviewChoice(item)}
                    onMouseLeave={() => setPreviewChoice(null)}
                    onFocus={() => setPreviewChoice(item)}
                    onBlur={() => setPreviewChoice(null)}
                  >
                    <strong className="min-w-0 truncate font-medium">{item.label}</strong>
                    <small className="text-xs text-muted-foreground max-[620px]:hidden">{item.meta}</small>
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DiagramChoicePreview choice={visiblePreview} />
      </div>
      <Dialog open={Boolean(choice)} onOpenChange={(open) => { if (!open) resetChoice() }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogDescription>{choice?.label}</DialogDescription>
              <DialogTitle>输入图表名称</DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="new-diagram-title">图表名称</FieldLabel>
                <Input id="new-diagram-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：企业知识平台系统架构" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={resetChoice}>返回</Button>
              <Button disabled={submitting || !title.trim()}>{submitting ? '创建中…' : '确认'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DiagramChoicePreview({ choice }: { choice: NewDiagramChoice | null }) {
  return (
    <aside className={`new-diagram-preview${choice ? ' has-preview' : ''}`} aria-live="polite">
      {choice ? (
        <div key={choice.key} className="new-diagram-preview-content">
          <div className="new-diagram-preview-stage">
            {choice.type === 'canvas'
              ? <CanvasChoicePreview workbench={choice.canvasWorkbench ?? 'freeform'} />
              : <MermaidChoicePreview type={choice.type} label={choice.label} />}
          </div>
          <div className="new-diagram-preview-caption">
            <strong>{choice.label}</strong>
            <span>{choice.meta}</span>
          </div>
        </div>
      ) : (
        <div className="new-diagram-preview-empty">
          <span className="new-diagram-preview-empty-mark" />
          <strong>图表预览</strong>
          <span>悬停在类型上查看结构示例</span>
        </div>
      )}
    </aside>
  )
}

function CanvasChoicePreview({ workbench }: { workbench: CanvasWorkbenchMode }) {
  if (workbench === 'architecture') {
    return (
      <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
        <rect className="preview-boundary" x="20" y="20" width="240" height="140" rx="12" />
        <rect className="preview-node is-accent" x="42" y="66" width="58" height="36" rx="8" />
        <rect className="preview-node" x="121" y="46" width="64" height="36" rx="8" />
        <rect className="preview-node" x="121" y="106" width="64" height="36" rx="8" />
        <rect className="preview-node is-data" x="207" y="76" width="34" height="48" rx="8" />
        <path className="preview-line" d="M100 84 H110 V64 H121" />
        <path className="preview-line" d="M100 84 H110 V124 H121" />
        <path className="preview-line" d="M185 64 H196 V100 H207" />
        <path className="preview-line" d="M185 124 H196 V100" />
      </svg>
    )
  }
  if (workbench === 'flowchart') {
    return (
      <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
        <rect className="preview-node is-accent" x="20" y="72" width="54" height="34" rx="17" />
        <rect className="preview-node" x="104" y="68" width="66" height="42" rx="8" />
        <path className="preview-decision" d="M210 58 242 89 210 120 178 89Z" />
        <path className="preview-line" d="M74 89 H104" />
        <path className="preview-line" d="M170 89 H178" />
        <path className="preview-line" d="M210 120 V145 H130" />
        <circle className="preview-dot" cx="130" cy="145" r="5" />
      </svg>
    )
  }
  return (
    <svg className="new-diagram-preview-svg is-canvas" viewBox="0 0 280 180" aria-hidden="true">
      <rect className="preview-node is-accent" x="38" y="38" width="78" height="48" rx="10" transform="rotate(-4 77 62)" />
      <circle className="preview-shape" cx="188" cy="66" r="30" />
      <path className="preview-free-line" d="M70 130 C108 105 150 152 218 122" />
      <rect className="preview-note" x="165" y="112" width="68" height="40" rx="7" transform="rotate(3 199 132)" />
    </svg>
  )
}

function MermaidChoicePreview({ type, label }: { type: MermaidDiagramType; label: string }) {
  const container = useRef<HTMLDivElement>(null)
  const renderId = useMemo(() => `diagram-choice-${Math.random().toString(36).slice(2)}`, [])

  useEffect(() => {
    let cancelled = false
    let handle: number | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      handle = window.setTimeout(() => {
        void renderMermaidSvg(createTemplate(type, label), `${renderId}-${Date.now()}`, () => cancelled)
          .then((markup) => {
            if (cancelled || !container.current) return
            const svg = createSafeSvgElement(markup)
            svg.removeAttribute('width')
            svg.removeAttribute('height')
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
            container.current.replaceChildren(svg)
          })
          .catch(() => {
            if (!cancelled && container.current) container.current.replaceChildren()
          })
      }, 90)
    }, { rootMargin: '120px' })
    if (container.current) observer.observe(container.current)
    return () => {
      cancelled = true
      observer.disconnect()
      if (handle !== undefined) window.clearTimeout(handle)
    }
  }, [label, renderId, type])

  return <div ref={container} className="new-diagram-preview-mermaid" aria-hidden="true" />
}

export interface NewDiagramDialogProps {
  open: boolean
  openKey: number
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onCreate: (type: DiagramType, title: string, canvasWorkbench?: CanvasWorkbenchMode) => Promise<void>
}

/** The panel's full-screen new-diagram picker, with the live preview beside the type list. */
export function NewDiagramDialog({ open, openKey, onOpenChange, onCancel, onCreate }: NewDiagramDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100vh-56px)] overflow-hidden p-0 sm:max-w-[760px]">
        <DialogTitle className="sr-only">新建图表</DialogTitle>
        <NewDiagramForm key={`thread-new-${openKey}`} onCancel={onCancel} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  )
}
