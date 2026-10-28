import { ChevronDownIcon, FolderOpenIcon, RefreshCwIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { DiagramSummary } from './types.js'

export interface ThreadDiagramGroups {
  current: DiagramSummary[]
  project: DiagramSummary[]
}

export interface ThreadDiagramPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenList: () => void
  total: number
  loading: boolean
  error: string | null
  query: string
  onQueryChange: (query: string) => void
  onRefresh: () => void
  groups: ThreadDiagramGroups
  selectedPath: string | undefined
  selectedBadge: string
  describe: (diagram: DiagramSummary) => string
  shortPath: (path: string) => string
  onSelect: (path: string) => void
}

/**
 * The panel's only entry point to the workspace: a searchable popover of saved
 * diagrams. It owns no state — the open flag, query and list status live with
 * the caller, so closing the popover and resetting the query stay one decision.
 */
export function ThreadDiagramPicker({
  open,
  onOpenChange,
  onOpenList,
  total,
  loading,
  error,
  query,
  onQueryChange,
  onRefresh,
  groups,
  selectedPath,
  selectedBadge,
  describe,
  shortPath,
  onSelect,
}: ThreadDiagramPickerProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenList()
        else onOpenChange(false)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between gap-1" aria-label="打开图表">
          <FolderOpenIcon className="size-4 shrink-0" />
          <span>打开图表</span>
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-28px))] p-0">
        <div className="flex h-9 items-center justify-between border-b px-3">
          <strong className="text-sm font-medium">打开已有图表</strong>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{total} 个图表</span>
            <Button
              size="icon-xs"
              variant="ghost"
              type="button"
              aria-label="刷新图表列表"
              title="刷新图表列表"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="搜索图表名称、类型或路径"
            aria-label="搜索图表"
            className="thread-diagram-search h-8"
          />
        </div>
        {error ? (
          <div role="alert" className="px-3 py-2 text-xs text-destructive">
            加载失败：{error}
            <Button type="button" variant="link" size="sm" onClick={onRefresh}>重试</Button>
          </div>
        ) : null}
        <ScrollArea className="h-[min(340px,48vh)]">
          <div className="flex flex-col gap-1 p-1">
            {([
              { key: 'current', label: '当前对话', items: groups.current },
              { key: 'project', label: '当前项目 · 最近修改', items: groups.project },
            ] as const).map((section) => section.items.length ? (
              <section className="flex flex-col gap-1" key={section.key} aria-label={section.label}>
                <div className="flex h-7 items-center justify-between px-2 text-xs text-muted-foreground">
                  <strong className="font-medium">{section.label}</strong>
                  <span>{section.items.length}</span>
                </div>
                {section.items.map((diagram) => (
                  <Button
                    key={diagram.path}
                    variant={selectedPath === diagram.path ? 'secondary' : 'ghost'}
                    className="h-auto w-full justify-between gap-3 px-2 py-2 text-left"
                    type="button"
                    onClick={() => onSelect(diagram.path)}
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate font-medium">{diagram.name}</strong>
                      <small className="block truncate text-xs text-muted-foreground">{shortPath(diagram.path)}</small>
                    </span>
                    <Badge variant="outline">{selectedPath === diagram.path ? selectedBadge : describe(diagram)}</Badge>
                  </Button>
                ))}
              </section>
            ) : null)}
            {groups.current.length === 0 && groups.project.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {loading ? '正在读取已保存的图表…' : query.trim() ? '没有匹配的图表' : '当前项目还没有已保存的图表'}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
