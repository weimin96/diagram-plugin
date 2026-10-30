import React, { useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { diagramTypeGroups, type DiagramDocument, type DiagramType } from './types.js'
import type { DiagramGenerationRequest } from './aiPrompts.js'
import type { CanvasWorkbenchMode } from './canvas.js'
import { architectureStyleChoices, detectArchitectureStyle, type ArchitectureDiagramStyle } from './architectureStyle.js'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface AiPanelProps {
  open: boolean
  returnFocusElement: HTMLElement | null
  selected: DiagramDocument | null
  initialMode?: 'generate' | 'modify'
  error?: string | null
  sending: boolean
  generationPreset?: { key: number; scope?: string; title?: string; instructions?: string }
  onSearchSources: (query: string) => Promise<string[]>
  onClose: () => void
  onGenerate: (request: DiagramGenerationRequest) => Promise<boolean>
  onModify: (instruction: string) => Promise<boolean>
}

const quickModifications = [
  '补全失败、超时、重试和回滚路径，但不要重复正常流程。',
  '简化这张图，合并没有信息增益的中间节点，保留关键边界和决策。',
  '优化图的阅读顺序和分组，让主路径更清晰，但不要改变业务语义。',
]

const generationTemplates: Array<{ label: string; type: DiagramType; canvasWorkbench?: CanvasWorkbenchMode; architectureStyle?: ArchitectureDiagramStyle; title: string; instructions: string }> = [
  { label: '系统架构', type: 'canvas', canvasWorkbench: 'architecture', title: '系统架构', instructions: '从真实代码、配置或用户提供的资料提炼系统能力、组件和依赖，不虚构。' },
  { label: '业务流程', type: 'flowchart', title: '核心业务流程', instructions: '从真实入口、关键决策、成功路径和异常/补偿路径还原流程；决策节点只表达一个条件，主路径保持连续阅读方向。' },
  { label: '调用链', type: 'sequence', title: '核心调用链', instructions: '沿真实调用顺序展示入口、服务、存储和外部依赖，并保留关键失败分支。' },
  { label: '数据模型', type: 'er', title: '数据模型', instructions: '从实体、表结构或模型定义提取核心实体、主外键和主要关系，不展开无关字段。' },
  { label: '状态流转', type: 'state', title: '状态流转', instructions: '从枚举、状态字段和业务分支还原合法状态、触发条件以及失败或终止状态。' },
  { label: '功能脑图', type: 'mindmap', title: '功能与能力地图', instructions: '围绕一个中心主题按互斥维度拆成 3~7 个一级分支，同层保持相同抽象粒度，不按目录结构机械展开。' },
  { label: '类关系', type: 'class', title: '核心类关系', instructions: '只保留有设计意义的类、接口、继承/实现/组合关系和关键公开成员，不展开 getter/setter、DTO 与无关工具类。' },
  { label: '项目计划', type: 'gantt', title: '项目计划', instructions: '按真实阶段、依赖和里程碑组织计划；没有真实日期时不要编造日历日期，优先使用已知计划信息。' },
  { label: '需求追踪', type: 'requirement', title: '需求追踪', instructions: '从需求、测试和实现中提取稳定需求项、实现元素及 satisfies/verifies/traces 等真实追踪关系，不编造风险与验证方法。' },
  { label: '指标趋势', type: 'xychart', title: '指标趋势', instructions: '只使用代码、评测、日志或上下文中存在的真实数值；趋势优先 line，离散比较优先 bar，不混用不同量纲。' },
  { label: '流量去向', type: 'sankey', title: '流量去向', instructions: '只使用可加总且同量纲的真实流量、资金、容量或转化数据；保持主流向清晰，不为凑比例编造数值。' },
  { label: '根因分析', type: 'ishikawa', title: '根因分析', instructions: '围绕一个明确问题，从日志、缺陷、复盘或上下文事实提炼原因类别和可验证具体原因；区分候选原因与已证实根因。' },
  { label: '架构画布', type: 'canvas', canvasWorkbench: 'architecture', title: '架构画布', instructions: '用自由画布组织核心模块、外部系统、数据存储和关键说明，保持留白和清晰的空间分组。' },
  { label: '企业方案架构', type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'enterprise', title: '总体技术架构', instructions: '按已确认的业务能力、功能分层和依赖生成企业方案总览，保持各层模块紧凑、标签清晰。' },
  { label: '工程架构', type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'engineering', title: '系统技术架构', instructions: '从真实源码与配置提取组件边界和有向依赖，采用工程架构表达。' },
  { label: 'C4 Context', type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'engineering', title: 'C4 系统上下文', instructions: '按 C4 Context 层级只展示 Person、当前 Software System 和关键外部 Software System。使用 c4Type 明确语义；当前系统用 software-system boundary，外部系统保持独立节点，连线写明关系，不展开内部容器。' },
  { label: 'C4 Container', type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'engineering', title: 'C4 容器架构', instructions: '按 C4 Container 层级识别 Web/客户端、API/网关、应用服务、数据库、缓存、消息队列和关键外部系统。使用 software-system 父边界 + container 子边界或 container 节点，保留 parentId 层级，节点绑定最相关源码路径，主要关系使用正交连线。' },
  { label: 'C4 Component', type: 'canvas', canvasWorkbench: 'architecture', architectureStyle: 'engineering', title: 'C4 组件架构', instructions: '聚焦一个 Container，按 C4 Component 层级提炼内部主要组件、职责与依赖。节点使用 c4Type=component，外层边界使用 c4Type=container；只画有架构意义的组件，不展开每个类和方法。' },
  { label: '服务拓扑', type: 'canvas', canvasWorkbench: 'architecture', title: '服务拓扑', instructions: '从部署配置、服务注册、HTTP/RPC/MQ 调用关系提取真实服务拓扑。使用 service/api/database/cache/queue/cloud/external 节点角色，按边界分组，并区分同步调用和异步消息。' },
  { label: '事件/数据流', type: 'canvas', canvasWorkbench: 'architecture', title: '事件与数据流', instructions: '展示事件产生者、Topic/Queue、消费者、数据存储和下游系统，优先从 Kafka/MQ/任务代码和配置还原真实流向；用 queue/database/service 角色和正交连线。' },
]

export function AiPanel({ open, returnFocusElement, selected, initialMode = 'generate', error, sending, generationPreset, onSearchSources, onClose, onGenerate, onModify }: AiPanelProps) {
  const [mode, setMode] = useState(initialMode)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 620px)').matches)
  const [activeTemplate, setActiveTemplate] = useState<(typeof generationTemplates)[number] | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [type, setType] = useState<DiagramType>('canvas')
  const [canvasWorkbench, setCanvasWorkbench] = useState<CanvasWorkbenchMode>('architecture')
  const [architectureStyle, setArchitectureStyle] = useState<ArchitectureDiagramStyle | ''>('')
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState('')
  const [generationInstructions, setGenerationInstructions] = useState('')
  const resolvedArchitectureStyle = architectureStyle || detectArchitectureStyle(`${title} ${activeTemplate?.instructions ?? ''} ${generationInstructions}`)
  const [modification, setModification] = useState('')
  const [scopeFocused, setScopeFocused] = useState(false)
  const [sourceOptions, setSourceOptions] = useState<string[]>([])
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceOptionIndex, setSourceOptionIndex] = useState(-1)
  const sourceListOpen = scopeFocused && (sourceLoading || sourceOptions.length > 0)
  const draft = { generation: [type, canvasWorkbench, architectureStyle, title, scope, generationInstructions, activeTemplate], modification, path: selected?.path, mode }
  const latestDraft = useRef(draft)
  latestDraft.current = draft

  useEffect(() => {
    if (sourceOptionIndex >= 0) document.getElementById(`ai-source-option-${sourceOptionIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [sourceOptionIndex])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!generationPreset) return
    setMode('generate')
    setActiveTemplate(null)
    setArchitectureStyle('')
    if (generationPreset.scope !== undefined) setScope(generationPreset.scope)
    if (generationPreset.title !== undefined) setTitle(generationPreset.title)
    if (generationPreset.instructions !== undefined) setGenerationInstructions(generationPreset.instructions)
  }, [generationPreset?.key])

  useEffect(() => { if (open) setMode(initialMode) }, [initialMode, open])

  useEffect(() => {
    if (!selected && mode === 'modify') setMode('generate')
  }, [selected, mode])

  useEffect(() => { setModification('') }, [selected?.path])

  useEffect(() => {
    if (!open || !scopeFocused || scope.trim() === '.') {
      if (!open) setScopeFocused(false)
      setSourceLoading(false)
      setSourceOptions([])
      setSourceOptionIndex(-1)
      if (scope.trim() === '.') setSourceError(null)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      setSourceLoading(true)
      setSourceError(null)
      void onSearchSources(scope)
        .then((files) => {
          if (!cancelled) {
            setSourceOptions(files)
            setSourceOptionIndex(-1)
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setSourceOptions([])
            setSourceError(cause instanceof Error ? cause.message : '读取源码列表失败')
          }
        })
        .finally(() => {
          if (!cancelled) setSourceLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [onSearchSources, open, scope, scopeFocused])

  async function generate() {
    if (type === 'canvas' && canvasWorkbench === 'architecture' && !resolvedArchitectureStyle) return
    const submitted = latestDraft.current
    if (!await onGenerate({
      type, ...(type === 'canvas' ? { canvasWorkbench } : {}), title, scope,
      ...(type === 'canvas' && canvasWorkbench === 'architecture' && resolvedArchitectureStyle ? { architectureStyle: resolvedArchitectureStyle } : {}),
      instructions: [activeTemplate?.instructions, generationInstructions].filter(Boolean).join('\n'),
    })) return
    const latest = latestDraft.current
    if (!submitted.generation.every((value, index) => value === latest.generation[index])) return
    setActiveTemplate(null)
    setTitle('')
    setScope('')
    setGenerationInstructions('')
    setSourceError(null)
    setScopeFocused(false)
    if (latest.mode === 'generate') onClose()
  }

  async function modify(instruction: string) {
    const submitted = latestDraft.current
    if (!await onModify(instruction)) return
    const latest = latestDraft.current
    if (latest.path !== submitted.path || latest.modification !== submitted.modification) return
    if (instruction === submitted.modification) setModification('')
    if (latest.mode === 'modify') onClose()
  }

  function chooseSource(path: string) {
    setScope(path)
    setScopeFocused(false)
    setSourceOptions([])
    setSourceOptionIndex(-1)
  }

  function navigateSources(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setScopeFocused(true)
      if (!sourceOptions.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSourceOptionIndex((current) => current < 0 ? step > 0 ? 0 : sourceOptions.length - 1 : (current + step + sourceOptions.length) % sourceOptions.length)
    } else if (event.key === 'Enter' && sourceListOpen && sourceOptions[sourceOptionIndex]) {
      event.preventDefault()
      chooseSource(sourceOptions[sourceOptionIndex])
    }
  }

  function chooseTemplate(template: (typeof generationTemplates)[number]) {
    setActiveTemplate(template)
    setType(template.type)
    if (template.canvasWorkbench) setCanvasWorkbench(template.canvasWorkbench)
    setArchitectureStyle(template.architectureStyle ?? '')
    setTitle(template.title)
  }

  function templateButton(template: (typeof generationTemplates)[number]) {
    return <Button key={template.label} variant={activeTemplate?.label === template.label ? 'secondary' : 'ghost'} size="sm" type="button" aria-pressed={activeTemplate?.label === template.label} onClick={() => chooseTemplate(template)}>{template.label}</Button>
  }

  return (
    <Dialog open={open} modal={narrow} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogPrimitive.Content
      className="ai-panel"
      aria-modal={narrow || undefined}
      aria-describedby={undefined}
      onInteractOutside={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusElement?.focus() }}
      onEscapeKeyDown={(event) => {
        if (sourceListOpen && (event.target as HTMLElement).id === 'ai-diagram-scope') {
          event.preventDefault()
          setScopeFocused(false)
        }
      }}
    >
      <div className="ai-panel-head">
        <DialogTitle asChild><strong>图表操作</strong></DialogTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>关闭</Button>
      </div>
      <div className="ai-mode-switch" role="group" aria-label="图表操作模式">
        <Button type="button" variant={mode === 'generate' ? 'secondary' : 'ghost'} size="sm" aria-pressed={mode === 'generate'} onClick={() => setMode('generate')}>新建图表</Button>
        {selected ? <Button type="button" variant={mode === 'modify' ? 'secondary' : 'ghost'} size="sm" aria-pressed={mode === 'modify'} onClick={() => setMode('modify')}>修改当前图</Button> : null}
      </div>
      {error ? <div className="ai-panel-error" role="alert">{error}</div> : null}
      {mode === 'generate' ? <section className="ai-panel-section">
        <div className="generation-templates" aria-label="常用预设">{generationTemplates.slice(0, 4).map(templateButton)}</div>
        <details className="ai-more-presets">
          <summary>更多预设 <span>{generationTemplates.length - 4}</span></summary>
          <div className="generation-templates" aria-label="更多生成预设">{generationTemplates.slice(4).map(templateButton)}</div>
        </details>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>图表类型</FieldLabel>
            <Select value={type} onValueChange={(value) => { setType(value as DiagramType); setActiveTemplate(null) }}>
              <SelectTrigger className="w-full" aria-label="图表类型"><SelectValue placeholder="选择图表类型" /></SelectTrigger>
              <SelectContent>{diagramTypeGroups.map((group) => <SelectGroup key={group.category}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => <SelectItem key={item.type} value={item.type}>{item.type === 'canvas' ? 'Canvas 画布' : item.label}</SelectItem>)}
              </SelectGroup>)}</SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-diagram-title">标题</FieldLabel>
            <Input id="ai-diagram-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="图表名称" />
          </Field>
          {type === 'canvas' && canvasWorkbench === 'architecture' ? <Field>
            <FieldLabel>架构图风格</FieldLabel>
            <Select value={resolvedArchitectureStyle ?? ''} onValueChange={(value) => setArchitectureStyle(value as ArchitectureDiagramStyle)}>
              <SelectTrigger className="w-full" aria-label="架构图风格"><SelectValue placeholder="选择架构图风格" /></SelectTrigger>
              <SelectContent><SelectGroup>{architectureStyleChoices.map((style) => <SelectItem key={style.id} value={style.id}>{style.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field> : null}
          <Field>
            <FieldLabel htmlFor="ai-diagram-instructions">要求</FieldLabel>
            <Textarea id="ai-diagram-instructions" value={generationInstructions} onChange={(event) => setGenerationInstructions(event.target.value)} placeholder="描述要表达的内容" />
          </Field>
        </FieldGroup>
        <details className="ai-advanced-options">
          <summary>来源与高级选项</summary>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="ai-diagram-scope">文件或目录</FieldLabel>
              <div className="source-picker">
                <Input
                  id="ai-diagram-scope"
                  value={scope}
                  onChange={(event) => { setScope(event.target.value); setSourceOptions([]); setSourceOptionIndex(-1); setScopeFocused(true) }}
                  onFocus={() => setScopeFocused(true)}
                  onBlur={() => setScopeFocused(false)}
                  onKeyDown={navigateSources}
                  placeholder="搜索或输入源码路径（可选）"
                  aria-label="文件或目录"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={sourceListOpen}
                  aria-controls={sourceListOpen ? 'ai-source-options' : undefined}
                  aria-activedescendant={sourceListOpen && sourceOptionIndex >= 0 ? `ai-source-option-${sourceOptionIndex}` : undefined}
                  autoComplete="off"
                />
                {sourceListOpen ? (
                  <div id="ai-source-options" className="source-picker-popover" role="listbox" aria-label="源码文件" aria-busy={sourceLoading}>
                    {sourceLoading ? <div className="source-picker-status">正在扫描工作区…</div> : null}
                    {!sourceLoading ? sourceOptions.map((file, index) => (
                      <Button key={file} id={`ai-source-option-${index}`} variant={sourceOptionIndex === index ? 'secondary' : 'ghost'} size="sm" type="button" role="option" tabIndex={-1} aria-selected={sourceOptionIndex === index} className="w-full justify-start font-mono text-xs" onMouseMove={() => setSourceOptionIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSource(file)}>
                        {file}
                      </Button>
                    )) : null}
                  </div>
                ) : null}
              </div>
              {sourceError ? <div className="ai-field-error" role="alert">{sourceError}</div> : null}
            </Field>

            <Button variant="outline" size="sm" type="button" onClick={() => setScope('.')}>使用整个工作区</Button>
            {type === 'canvas' ? <Field>
              <FieldLabel>画布用途</FieldLabel>
              <Select value={canvasWorkbench} onValueChange={(value) => { setCanvasWorkbench(value as CanvasWorkbenchMode); setActiveTemplate(null) }}>
                <SelectTrigger className="w-full" aria-label="画布用途"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="architecture">系统架构</SelectItem>
                  <SelectItem value="flowchart">流程画布</SelectItem>
                  <SelectItem value="freeform">自由画布</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
            </Field> : null}
          </FieldGroup>
        </details>
        <Button className="mt-3 w-full" type="button" disabled={sending || !title.trim() || (type === 'canvas' && canvasWorkbench === 'architecture' && !resolvedArchitectureStyle)} onClick={() => void generate()}>{sending ? '发送中…' : '生成图表'}</Button>
      </section> : null}
      {mode === 'modify' && selected ? <section className="ai-panel-section">
        <div className="ai-current-diagram">{selected.name}</div>
        <div className="ai-quick-actions">{quickModifications.map((instruction, index) => (
          <Button key={instruction} variant="outline" size="sm" type="button" disabled={sending} onClick={() => void modify(instruction)}>{index === 0 ? '补异常路径' : index === 1 ? '简化结构' : '整理布局'}</Button>
        ))}</div>
        <Textarea aria-label="修改要求" value={modification} onChange={(event) => setModification(event.target.value)} placeholder="描述需要怎么改" />
        <Button className="mt-3 w-full" type="button" disabled={sending || !modification.trim()} onClick={() => void modify(modification)}>{sending ? '发送中…' : '应用修改'}</Button>
      </section> : null}
    </DialogPrimitive.Content>
    </Dialog>
  )
}
