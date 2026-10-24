import { canvasVisualSkin, canvasStyledBox, canvasFillTextColor, diagramVisualStyles, type DiagramVisualStyle } from './diagramVisualStyles.js'
import { canvasArrowLabelText } from './canvasLabelText.js'
import { CanvasRectIndex } from './canvasRectIndex.js'
import { canvasArrowCrossesViewport } from './canvasViewport.js'
import { buildCanvasPlaybackPlan } from './canvasPlayback.js'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Hand, Link2, MousePointer2, Shapes, Type, type IconNode } from 'lucide'
import { applyArchitectureTheme as applyArchitectureThemeToScene, beautifyArchitectureScene, routeArchitectureArrowIds, routeArchitectureEdges, routeArchitectureEdgesIncremental, type ArchitectureTheme } from './architectureDesign.js'
import { architecturePartitionFlow } from './architecturePartitionFlow.js'
import { recommendArchitectureReadingViewport } from './architecturePresentationQuality.js'
import { ARCHITECTURE_NODE_TEMPLATES, architectureNodeTemplate, type ArchitectureNodeTemplate, type ArchitectureNodeTemplateProvider } from './architectureNodeTemplates.js'
import { anchorPoint, canvasArchitectureCardTemplate, canvasArchitectureHeader, canvasArchitectureProjection, canvasArchitectureRelationLabelVisible, canvasArchitectureScopeProjection, canvasArrowBoxRoute, canvasArrowLabelLayouts, canvasArrowPath, canvasArrowRoutePath, canvasArrowRoutePoints, canvasBundleTrunks, canvasCollapsedConnections, canvasCollapsedOwners, canvasGroupFrames, canvasPresentationGroupFrames, canvasIconLabel, canvasIconPaths, canvasIconRefLabel, canvasIconRefMarkup, canvasSemanticLodProjection, resolveCanvasSemanticLod, canvasStencilLabel, canvasStencilVisual, c4Label, parseCanvasScene, serializeCanvasScene, type CanvasAnchor, type CanvasArchitectureDensity, type CanvasArchitectureScope, type CanvasArchitectureView, type CanvasArrow, type CanvasC4Type, type CanvasElement, type CanvasGroup, type CanvasGroupFrame, type CanvasIcon, type CanvasIconRef, type CanvasLineStyle, type CanvasNode, type CanvasNote, type CanvasPoint, type CanvasRouting, type CanvasScene, type CanvasSemanticLodLevel, type CanvasShape, type CanvasStencil, type CanvasTone } from './canvas.js'
import { CANVAS_ICON_CATALOG, type CanvasIconSource } from './iconRegistry.js'
import { alignCanvasSelection, assignCanvasSelectionToLane, canvasRotationFromPointer, clearCanvasLanes, computeCanvasSmartSnap, copyCanvasSelection, createCanvasLanePreset, deleteCanvasSelection, distributeCanvasSelection, expandCanvasGroupSelection, groupCanvasSelection, insertCanvasArchitectureNodeTemplate, insertCanvasArchitectureTemplate, insertCanvasNodeOnArrow, layoutCanvasNeighborhood, layoutCanvasScene, layoutCanvasSelection, nextCanvasElementId, pasteCanvasSelection, reconnectCanvasArrow, reflowCanvasNeighborhood, reorderCanvasSelection, resizeCanvasTransformBox, reverseCanvasArrow, scaleCanvasTransformBoxes, separateCanvasSelection, setCanvasC4CollapseLevel, setCanvasGroupParent, traceCanvasGraph, ungroupCanvasSelection, updateCanvasGroup, updateCanvasLane, type CanvasArchitectureTemplate, type CanvasC4CollapseLevel, type CanvasLayoutMode, type CanvasResizeHandle, type CanvasSpacingGuide, type CanvasTraceDirection, type CanvasTransformBox } from './canvasOperations.js'
import { ShapeLibrary, ShapePreview } from './ShapeLibrary.js'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CANVAS_SHAPE_CATALOG, canvasShapeDefinition, canvasShapeGeometry, isCanvasShapeRef, type CanvasShapeDefinition, type CanvasShapeRef } from './shapeRegistry.js'

type CanvasTool = 'select' | 'hand' | 'node' | 'note' | 'text' | 'pen' | 'connect' | 'line' | 'arrow'

export interface CanvasSelection {
  ids: string[]
  elements: CanvasElement[]
  trace?: { direction: CanvasTraceDirection; depth: number; nodeIds: string[]; arrowIds: string[] }
}

export interface CanvasPlaybackRequest {
  key: string
  path: string
  mode: 'create' | 'update'
  fromSource?: string
  label?: string
}

interface CanvasEditorProps {
  source: string
  active?: boolean
  onChange: (source: string) => void
  onSelectionChange?: (selection: CanvasSelection | null) => void
  onOpenSource?: (path: string) => void
  onSearchSources?: (query: string) => Promise<string[]>
  onAnalyzeGitImpact?: () => void | Promise<void>
  onImportImage?: (input: { filename: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; content: string }) => Promise<{ path: string; mimeType: string }>
  onResolveImage?: (path: string) => Promise<string>
  focusElementIds?: string[]
  focusKey?: string
  traceRequest?: { seedElementIds: string[]; direction: CanvasTraceDirection; depth: number; key: string }
  playbackRequest?: CanvasPlaybackRequest | null
  onPlaybackComplete?: (key: string) => void
}

type Viewport = { x: number; y: number; zoom: number }
type SelectionRect = { x1: number; y1: number; x2: number; y2: number }
type ContextMenuState = { x: number; y: number }
type SnapGuides = {
  x?: number
  y?: number
  spacing?: CanvasSpacingGuide[]
  sizeLabel?: string
  sizePoint?: CanvasPoint
}
type InsertTarget = { arrowId: string; point: CanvasPoint }
type GestureVisualDraft = { positions: Record<string, CanvasPoint>; guides: SnapGuides; insertTarget: InsertTarget | null }
type DragState =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; before: string; positions: Map<string, { x: number; y: number }> }
  | { kind: 'pan'; pointerId: number; clientX: number; clientY: number; start: Viewport }
  | { kind: 'marquee'; pointerId: number; startX: number; startY: number }
  | { kind: 'resize'; pointerId: number; id: string; handle: CanvasResizeHandle; box: CanvasTransformBox; before: string }
  | { kind: 'multi-resize'; pointerId: number; handle: CanvasResizeHandle; bounds: CanvasTransformBox; boxes: Map<string, CanvasTransformBox>; before: string }
  | { kind: 'rotate'; pointerId: number; id: string; center: CanvasPoint; start: CanvasPoint; initialRotation: number; before: string }
  | { kind: 'arrow-point'; pointerId: number; id: string; index: number; before: string }
  | { kind: 'arrow-endpoint'; pointerId: number; id: string; endpoint: 'from' | 'to'; before: string }
  | { kind: 'arrow-label'; pointerId: number; id: string; before: string }
  | { kind: 'line-draw'; pointerId: number; markerEnd: 'none' | 'arrow' }
  | { kind: 'freehand-draw'; pointerId: number }

type LineDraft = { start: CanvasPoint; end: CanvasPoint; markerEnd: 'none' | 'arrow' }
type FreehandDraft = { points: CanvasPoint[] }
type CanvasCssVars = CSSProperties & Record<`--${string}`, string | number | undefined>

const GRID = 16
const MIN_ZOOM = 0.45
const MAX_ZOOM = 4

const ARCHITECTURE_THEME_OPTIONS: Array<{ value: ArchitectureTheme; label: string; description: string }> = [
  { value: 'enterprise', label: '工程', description: '工程蓝图' },
  { value: 'cloud', label: '云平台', description: '云原生' },
  { value: 'technical', label: '蓝图', description: '高密线路' },
  { value: 'presentation', label: '汇报', description: '低噪总览' },
  { value: 'editorial', label: '编辑', description: '留白叙事' },
  { value: 'sketch', label: '草图', description: '白板讨论' },
]

const ICON_SOURCE_OPTIONS: ReadonlyArray<readonly ['all' | CanvasIconSource, string]> = [
  ['all', '全部'],
  ['role', '语义'],
  ['simple', '品牌'],
  ['lucide', 'Lucide'],
  ['aws', 'AWS'],
  ['azure', 'Azure'],
  ['gcp', 'GCP'],
]

const TEMPLATE_FAVORITES_STORAGE_KEY = 'diagram-plugin:architecture-template-favorites'
const TEMPLATE_RECENTS_STORAGE_KEY = 'diagram-plugin:architecture-template-recents'
const TEMPLATE_DRAG_MIME = 'application/x-diagram-plugin-architecture-template'
const SHAPE_DRAG_MIME = 'application/x-diagram-plugin-shape'
const TEMPLATE_RECENT_LIMIT = 8

type ArchitectureTemplateDragState = {
  templateId: string
  point?: CanvasPoint
  groupId?: string
}

type ShapeDragState = {
  shapeRef: CanvasShapeRef
  point?: CanvasPoint
}

function readStoredTemplateIds(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((id): id is string => typeof id === 'string' && Boolean(architectureNodeTemplate(id)))
  } catch {
    return []
  }
}

function storeTemplateIds(key: string, ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // The current in-memory preference remains usable when persistent storage is unavailable.
  }
}

function FavoriteGlyph({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.6 14.55 8.8l5.75.84-4.16 4.05.98 5.72L12 16.72l-5.12 2.69.98-5.72L3.7 9.64l5.75-.84L12 3.6Z" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function ArchitectureTemplateGlyph({ asset }: { asset: ArchitectureNodeTemplate }) {
  if (asset.iconRef) return <IconRefGlyph refValue={asset.iconRef} />
  if (asset.stencil) {
    const visual = canvasStencilVisual(asset.stencil)
    return visual.path
      ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d={visual.path} fill={visual.color} data-stencil={asset.stencil} /></svg>
      : <i>{visual.label}</i>
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="is-role">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {canvasIconPaths(asset.icon).map((path, index) => <path key={`${asset.id}-${index}`} d={path} />)}
      </g>
    </svg>
  )
}

function IconRefGlyph({ refValue, className }: { refValue: CanvasIconRef; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: canvasIconRefMarkup(refValue, false, 'currentColor') }} />
}

function ToolbarGlyph({ icon }: { icon: IconNode }) {
  const markup = icon.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${String(value)}"`).join(' ')}/>`).join('')
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
}

function CanvasBoxShape({ item }: { item: CanvasNode | CanvasNote }) {
  if (item.type === 'note' && item.textOnly) {
    return <rect width={item.width} height={item.height} className="freeform-text-hitbox" />
  }
  if (item.shapeRef) {
    const geometry = canvasShapeGeometry(item.shapeRef, item.width, item.height, item.cornerRadius)
    return <>
      <path d={geometry.bodyPath} className="freeform-shape-body" />
      {geometry.detailPaths.map((path, index) => <path key={index} d={path} className="freeform-shape-detail" />)}
    </>
  }
  return <rect width={item.width} height={item.height} rx={item.cornerRadius ?? (item.shape === 'square' ? 3 : item.shape === 'pill' ? item.height / 2 : 14)} />
}

function canvasBoxVisualStyle(item: CanvasNode | CanvasNote): CanvasCssVars {
  return {
    ...(item.fillColor ? { '--canvas-box-fill': item.fillColor } : {}),
    ...(item.strokeColor ? { '--canvas-box-stroke': item.strokeColor } : {}),
    ...(item.strokeWidth ? { '--canvas-box-stroke-width': `${item.strokeWidth}px` } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
  }
}

const STYLE_COLOR_SWATCHES = ['#1f2937', '#ef3340', '#22a45d', '#2f73d9', '#f59e0b', '#ffffff'] as const
const CANVAS_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_CANVAS_IMAGE_BYTES = 12 * 1024 * 1024

function StyleColorControl({ label, value, mixed = false, onChange }: { label: string; value?: string; mixed?: boolean; onChange: (value?: string) => void }) {
  return (
    <div className="freeform-style-color">
      <span>{label}{mixed ? <em>混合</em> : null}</span>
      <div>
        {STYLE_COLOR_SWATCHES.map((color) => <button key={color} type="button" aria-label={`${label} ${color}`} className={value === color ? 'is-selected' : ''} style={{ background: color }} onClick={() => onChange(color)} />)}
        <label className="freeform-style-native-color" title="自定义颜色">
          <input type="color" value={value ?? '#64748b'} onChange={(event) => onChange(event.target.value)} />
        </label>
        <button type="button" className="freeform-style-auto" onClick={() => onChange(undefined)}>自动</button>
      </div>
    </div>
  )
}

async function readCanvasImageFile(file: File): Promise<{ dataUrl: string; content: string; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }> {
  if (!CANVAS_IMAGE_MIME_TYPES.has(file.type)) throw new Error('只支持 PNG、JPEG 和 WebP 图片。')
  if (!file.size || file.size > MAX_CANVAS_IMAGE_BYTES) throw new Error('图片大小必须在 12MB 以内。')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败。'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('读取图片失败。'))
    reader.readAsDataURL(file)
  })
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new globalThis.Image()
    image.onerror = () => reject(new Error('无法解析图片尺寸。'))
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = dataUrl
  })
  const content = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return { dataUrl, content, ...size, mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' }
}

function relationLabelScene(scene: CanvasScene, architecture: boolean, level: CanvasSemanticLodLevel, selected: Set<string>): CanvasScene {
  return {
    ...scene,
    elements: scene.elements.map((item) => {
      if (item.type !== 'arrow' || !item.label) return item
      const visible = architecture
        ? selected.has(item.id) || canvasArchitectureRelationLabelVisible(item)
        : semanticLodAllowsArrowLabel(level, item, selected)
      return visible ? item : { ...item, label: undefined }
    }),
  }
}


const CanvasBoxArtwork = memo(function CanvasBoxArtwork({ item, visualStyle, darkTheme, architecture, architectureTheme, density, titleScale, level, selected, imageSource }: {
  item: CanvasNode | CanvasNote
  visualStyle?: DiagramVisualStyle
  darkTheme: boolean
  architecture: boolean
  architectureTheme?: ArchitectureTheme
  density: CanvasArchitectureDensity
  titleScale?: number
  level: CanvasSemanticLodLevel
  selected: boolean
  imageSource?: string
}) {
  const originalItem = item
  // Architecture nodes use semantic outlines rather than a wall of solid primary cards.
  const skin = canvasVisualSkin(originalItem.type === 'note' ? undefined : visualStyle, darkTheme, originalItem.tone, originalItem.emphasis === 'primary' && !architecture)
  // A visual-style preset must not silently turn a semantic architecture card
  // into an authored solid-fill node. Only explicit node colors override cards.
  const displayItem = architecture && originalItem.type === 'node' ? originalItem : canvasStyledBox(originalItem, skin)
  const displayText = displayItem.text
  const imagePath = displayItem.type === 'note' ? displayItem.imagePath : undefined
  const imageFit = displayItem.type === 'note' ? displayItem.imageFit : undefined
  const architectureCard = displayItem.type === 'node' && Boolean(displayItem.iconRef || displayItem.icon || displayItem.stencil || displayItem.c4Type)
  const cardTemplate = canvasArchitectureCardTemplate(displayItem)
  const cardMeta = displayItem.iconRef ? canvasIconRefLabel(displayItem.iconRef) : displayItem.stencil ? canvasStencilLabel(displayItem.stencil) : architectureCard ? cardTemplate.label : displayItem.icon ? canvasIconLabel(displayItem.icon) : undefined
  // Actor, external and technical nodes share a common card/icon/title grid.
  const architectureMark = Boolean(architecture && architectureCard && (displayItem.iconRef || displayItem.stencil || displayItem.icon))
  const titleColor = architectureMark && !originalItem.fillColor
    ? darkTheme ? '#f8fafc' : '#243247'
    : canvasFillTextColor(displayItem.fillColor, skin?.text ?? (darkTheme ? '#f8fafc' : '#243247'))
  const stencilVisual = displayItem.stencil ? canvasStencilVisual(displayItem.stencil) : undefined
  const iconRefMarkup = displayItem.iconRef ? canvasIconRefMarkup(displayItem.iconRef, false, 'currentColor') : undefined
  const showNodeTitle = !imagePath && (level !== 'regions' || selected || displayItem.emphasis === 'primary')
  const showRoleIcon = level === 'detail' || level === 'compact' || selected || displayItem.emphasis === 'primary'
  const showCardMeta = !architecture && (level === 'detail' || (level === 'compact' && architectureCard) || selected)
  const showC4Badge = !architecture && (level === 'detail' || level === 'compact' || selected)
  const showCardSubtitle = level === 'detail' && Boolean(displayItem.subtitle && (!architectureCard || density !== 'dense'))
  const showSourceBadge = architecture ? selected : level === 'detail' || selected
  const cardTitleLimit = density === 'dense' ? 22 : density === 'compact' ? 26 : 30
  const architectureMarkSize = density === 'dense' ? 30 : density === 'compact' ? 34 : 38
  const architectureMarkX = 14
  const architectureMarkY = (displayItem.height - architectureMarkSize) / 2
  const architectureTextX = architectureMark ? architectureMarkX + architectureMarkSize + 12 : architectureCard ? 16 : displayItem.width / 2
  const architectureTitleY = architectureMark ? displayItem.height / 2 + (showCardSubtitle ? -4 : 4) : architectureCard ? (showCardSubtitle ? 55 : Math.max(54, displayItem.height / 2 + 5)) : displayItem.height / 2
  return <>
              {displayItem.description ? <title>{displayItem.description}</title> : null}
              {imagePath ? <>
                <defs><clipPath id={`canvas-image-${displayItem.id}`}><rect width={displayItem.width} height={displayItem.height} rx={displayItem.cornerRadius ?? 8} /></clipPath></defs>
                <rect className="freeform-image-frame" width={displayItem.width} height={displayItem.height} rx={displayItem.cornerRadius ?? 8} />
                {imageSource
                  ? <image href={imageSource} width={displayItem.width} height={displayItem.height} preserveAspectRatio={imageFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'} clipPath={`url(#canvas-image-${displayItem.id})`} />
                  : <text className="freeform-image-placeholder" x={displayItem.width / 2} y={displayItem.height / 2} textAnchor="middle" dominantBaseline="middle">图片加载中</text>}
                <rect className="freeform-image-outline" width={displayItem.width} height={displayItem.height} rx={displayItem.cornerRadius ?? 8} />
              </> : displayItem.shapeRef ? <CanvasBoxShape item={displayItem} /> : <rect width={displayItem.width} height={displayItem.height} rx={displayItem.cornerRadius ?? (displayItem.shape === 'square' ? 3 : displayItem.shape === 'pill' ? displayItem.height / 2 : architecture && architectureMark ? 9 : 14)} />}
              {!architecture && !visualStyle && displayItem.emphasis === 'primary' ? <rect className="freeform-card-accent" width="5" height={displayItem.height} rx="3" /> : null}
              {!architecture && architectureCard ? <rect className="freeform-card-kind-band" x="12" y={displayItem.height - 4} width={Math.max(24, displayItem.width - 24)} height="2" rx="1" /> : null}
              {architectureMark && iconRefMarkup && showRoleIcon ? (
                <g className="freeform-icon-ref" transform={`translate(${architectureMarkX} ${architectureMarkY}) scale(${architectureMarkSize / 24})`} dangerouslySetInnerHTML={{ __html: iconRefMarkup }} />
              ) : architectureMark && stencilVisual && showRoleIcon ? (
                <g className="freeform-stencil-logo" transform={`translate(${architectureMarkX} ${architectureMarkY})`}>
                  {stencilVisual.path
                    ? <path d={stencilVisual.path} fill={stencilVisual.color} data-stencil={displayItem.stencil} transform={`scale(${architectureMarkSize / 24})`} />
                    : <><rect width={architectureMarkSize} height={architectureMarkSize} rx={7} /><text x={architectureMarkSize / 2} y={architectureMarkSize / 2 + 4} textAnchor="middle">{stencilVisual.label}</text></>}
                </g>
              ) : architectureMark && displayItem.icon && showRoleIcon ? (
                <g className="freeform-node-role is-architecture-role" transform={`translate(${architectureMarkX} ${architectureMarkY})`}>
                  <rect width={architectureMarkSize} height={architectureMarkSize} rx={7} />
                  <g className="freeform-node-role-symbol" transform={`translate(${architectureMarkSize * .18} ${architectureMarkSize * .18}) scale(${architectureMarkSize * .64 / 24})`}>
                    {canvasIconPaths(displayItem.icon).map((path, index) => <path key={`${displayItem.icon}-${index}`} d={path} />)}
                  </g>
                </g>
              ) : displayItem.iconRef && iconRefMarkup && showRoleIcon ? (
                <g className="freeform-icon-ref" transform="translate(8 8) scale(.8333)" dangerouslySetInnerHTML={{ __html: iconRefMarkup }} />
              ) : displayItem.icon && showRoleIcon ? (
                <g className="freeform-node-role" transform="translate(18 18)">
                  <circle r="10" />
                  <g className="freeform-node-role-symbol" transform="translate(-7 -7) scale(.5833)">
                    {canvasIconPaths(displayItem.icon).map((path, index) => <path key={`${displayItem.icon}-${index}`} d={path} />)}
                  </g>
                </g>
              ) : null}
              {cardMeta && showCardMeta ? <text className="freeform-node-icon" x={(displayItem.iconRef || displayItem.icon) && showRoleIcon ? 34 : 13} y="19">{cardMeta}</text> : null}
              {displayItem.c4Type && showC4Badge ? <text className="freeform-c4-badge" x={displayItem.width - 10} y={19} textAnchor="end">{c4Label(displayItem.c4Type)}</text> : null}
              {showNodeTitle ? displayItem.type === 'note' && displayItem.textOnly ? (
                <text
                  className="freeform-plain-text"
                  x="0"
                  y={displayItem.fontSize ?? 20}
                  style={{ fontSize: displayItem.fontSize ?? 20, fontWeight: displayItem.fontWeight ?? 500, fill: displayItem.textColor ?? undefined }}
                >
                  {displayText.split('\n').slice(0, 8).map((line, index) => <tspan key={index} x="0" dy={index === 0 ? 0 : (displayItem.fontSize ?? 20) * 1.35}>{line}</tspan>)}
                </text>
              ) : <text style={{
                ...(displayItem.type === 'node' && (skin || originalItem.fillColor) ? { fill: titleColor, fontFamily: skin?.font, fontWeight: 600 } : {}),
                ...(architecture && architectureCard && titleScale && titleScale > 1 ? {
                  fontSize: (architectureMark
                    ? ({ technical: 12, presentation: 14, editorial: 14.5 } as Partial<Record<ArchitectureTheme, number>>)[architectureTheme ?? 'enterprise'] ?? 13
                    : density === 'dense' ? 12 : density === 'compact' ? 13 : 14) * titleScale,
                } : {}),
              }} className={architectureCard ? 'freeform-node-title' : undefined} x={architectureTextX} y={architectureTitleY} textAnchor={architectureCard ? 'start' : 'middle'} dominantBaseline={architectureCard ? undefined : 'middle'}>
                {truncate(displayText, architectureCard ? cardTitleLimit : 28)}
              </text> : null}
              {showCardSubtitle ? <text className="freeform-node-subtitle" x={architectureTextX} y={architectureMark ? architectureTitleY + 17 : displayItem.height - 12} textAnchor={architectureCard ? 'start' : 'middle'}>{truncate(displayItem.subtitle!, architectureCard ? 34 : 32)}</text> : null}
              {displayItem.sourcePaths?.length && showSourceBadge ? <text className="freeform-source-badge" x={displayItem.width - 10} y={displayItem.c4Type ? 34 : 18} textAnchor="end">⌘ {displayItem.sourcePaths.length}</text> : null}
  </>
})

const CanvasArrowInk = memo(function CanvasArrowInk({ label, path, markerEnd, strokeColor, strokeWidth }: {
  label?: string
  path: string
  markerEnd?: string
  strokeColor?: string
  strokeWidth?: number
}) {
  return <>
    {label ? <title>{label}</title> : null}
    <path className="freeform-arrow-hit-path" d={path} />
    <path
      className="freeform-arrow-line"
      d={path}
      markerEnd={markerEnd}
      pathLength="1"
      style={{ ...(strokeColor !== undefined ? { stroke: strokeColor } : {}), ...(strokeWidth ? { strokeWidth } : {}) }}
    />
  </>
})

export function CanvasEditor({ source, active = true, onChange, onSelectionChange, onOpenSource, onSearchSources, onAnalyzeGitImpact, onImportImage, onResolveImage, focusElementIds, focusKey, traceRequest, playbackRequest, onPlaybackComplete }: CanvasEditorProps) {
  const parsed = useMemo(() => {
    try {
      return { scene: parseCanvasScene(source), error: null as string | null }
    } catch (error) {
      return { scene: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [source])
  const [tool, setTool] = useState<CanvasTool>('select')
  const [darkTheme, setDarkTheme] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const update = () => setDarkTheme(document.documentElement.dataset.theme === 'dark')
    window.addEventListener('diagram-theme-change', update)
    return () => window.removeEventListener('diagram-theme-change', update)
  }, [])
  const [architectureTheme, setArchitectureTheme] = useState<ArchitectureTheme>(parsed.scene?.architecture?.theme ?? 'enterprise')
  const [architectureView, setArchitectureView] = useState<CanvasArchitectureView>(parsed.scene?.architecture?.view ?? 'detail')
  const [architectureDensity, setArchitectureDensity] = useState<CanvasArchitectureDensity>(parsed.scene?.architecture?.density ?? 'auto')
  const [architectureScope, setArchitectureScope] = useState<CanvasArchitectureScope | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [connectFromAnchor, setConnectFromAnchor] = useState<CanvasAnchor>('auto')
  const [connectPreviewPoint, setConnectPreviewPoint] = useState<CanvasPoint | null>(null)
  const [arrowEndpointPreview, setArrowEndpointPreview] = useState<{ id: string; endpoint: 'from' | 'to'; fixedPoint: CanvasPoint; point: CanvasPoint; targetId?: string; targetAnchor?: Exclude<CanvasAnchor, 'auto'> } | null>(null)
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null)
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({})
  const [gesturePositionOverrides, setGesturePositionOverrides] = useState<Record<string, CanvasPoint> | null>(null)
  const [transformDrafts, setTransformDrafts] = useState<Record<string, CanvasTransformBox> | null>(null)
  const [arrowPointDraft, setArrowPointDraft] = useState<{ id: string; points: CanvasPoint[] } | null>(null)
  const [arrowLabelDraft, setArrowLabelDraft] = useState<{ id: string; position: CanvasPoint } | null>(null)
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null)
  const [freehandDraft, setFreehandDraft] = useState<FreehandDraft | null>(null)
  const [imageSources, setImageSources] = useState<Record<string, string>>({})
  const [imageImportError, setImageImportError] = useState<string | null>(null)
  const [imageImporting, setImageImporting] = useState(false)
  const [spacePanning, setSpacePanning] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [sourceLinkQuery, setSourceLinkQuery] = useState('')
  const [sourceLinkOptions, setSourceLinkOptions] = useState<string[]>([])
  const [sourceLinkLoading, setSourceLinkLoading] = useState(false)
  const [sourceLinkError, setSourceLinkError] = useState<string | null>(null)
  const [layersOpen, setLayersOpen] = useState(false)
  const [compactToolbar, setCompactToolbar] = useState(false)
  const [moreToolsOpen, setMoreToolsOpen] = useState(false)
  const [layerQuery, setLayerQuery] = useState('')
  const [toolbarMenu, setToolbarMenu] = useState<'architecture' | 'flowchart' | 'analysis' | 'insert' | 'style' | null>(null)
  const [architecturePanel, setArchitecturePanel] = useState<'settings' | 'assets'>('settings')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetProvider, setAssetProvider] = useState<'all' | ArchitectureNodeTemplateProvider>('all')
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState<string[]>(() => readStoredTemplateIds(TEMPLATE_FAVORITES_STORAGE_KEY))
  const [recentTemplateIds, setRecentTemplateIds] = useState<string[]>(() => readStoredTemplateIds(TEMPLATE_RECENTS_STORAGE_KEY))
  const [architectureTemplateDrag, setArchitectureTemplateDrag] = useState<ArchitectureTemplateDragState | null>(null)
  const [shapeLibraryOpen, setShapeLibraryOpen] = useState(parsed.scene?.workbench === 'flowchart' || parsed.scene?.workbench === 'freeform')
  const [activeShapeRef, setActiveShapeRef] = useState<CanvasShapeRef>(parsed.scene?.workbench === 'flowchart' ? 'flowchart:process' : 'basic:rectangle')
  const [shapeDrag, setShapeDrag] = useState<ShapeDragState | null>(null)
  const [inspectorMenuOpen, setInspectorMenuOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconPickerQuery, setIconPickerQuery] = useState('')
  const [iconPickerSource, setIconPickerSource] = useState<'all' | CanvasIconSource>('all')
  const [selectedGroupTarget, setSelectedGroupTarget] = useState<string | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState<boolean | null>(null)
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())
  const [traceDirection, setTraceDirection] = useState<CanvasTraceDirection | null>(null)
  const [traceDepth, setTraceDepth] = useState(2)
  const editorRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const drag = useRef<DragState | null>(null)
  const moveStartedWithInspector = useRef(false)
  const moveLabels = useRef<{
    scene: CanvasScene
    viewport: Viewport
    arrowIds: string[]
    labels: ReturnType<typeof canvasArrowLabelLayouts>
  } | null>(null)
  const visibleLabelCache = useRef<{
    scene: CanvasScene
    level: CanvasSemanticLodLevel
    boxes: readonly (CanvasNode | CanvasNote)[]
    arrows: readonly CanvasArrow[]
    selectedArrowIds: string[]
    labels: ReturnType<typeof canvasArrowLabelLayouts>
  } | null>(null)
  const sourceRef = useRef(source)
  const sceneRef = useRef<CanvasScene | null>(parsed.scene)
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const [, refreshHistoryControls] = useState(0)
  const clipboard = useRef<CanvasElement[]>([])
  const layoutBefore = useRef<CanvasScene | null>(null)
  const lastTransitionKey = useRef<string | undefined>(undefined)
  const lastFocusKey = useRef<string | undefined>(undefined)
  const lastTraceKey = useRef<string | undefined>(undefined)
  const viewportRef = useRef(viewport)
  const arrowEndpointPreviewRef = useRef<typeof arrowEndpointPreview>(null)
  const insertTargetRef = useRef<typeof insertTarget>(null)
  const gesturePositionOverridesRef = useRef<typeof gesturePositionOverrides>(null)
  const transformDraftsRef = useRef<typeof transformDrafts>(null)
  const arrowPointDraftRef = useRef<typeof arrowPointDraft>(null)
  const arrowLabelDraftRef = useRef<typeof arrowLabelDraft>(null)
  const lineDraftRef = useRef<typeof lineDraft>(null)
  const freehandDraftRef = useRef<typeof freehandDraft>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const imageLoadPathsRef = useRef(new Set<string>())
  const imageImportVersion = useRef(0)
  const gestureVisualFrameRef = useRef<number | null>(null)
  const pendingGestureVisualRef = useRef<GestureVisualDraft | null>(null)
  const geometryDraftFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!active) setImageImporting(false)
    // 离开画布或卸载后，旧导入结果不能继续写回编辑目标。
    return () => { imageImportVersion.current += 1 }
  }, [active])

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const updateSize = (width: number) => {
      if (width <= 0) return
      setCompactToolbar(width < 560)
      if (width >= 560) setMoreToolsOpen(false)
    }
    updateSize(surface.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => updateSize(entry.contentRect.width))
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (source !== sourceRef.current) {
      // 外部源码更新建立新的撤销边界，避免旧的整图快照覆盖已同步内容。
      undoStack.current = []
      redoStack.current = []
      refreshHistoryControls((revision) => revision + 1)
    }
    sourceRef.current = source
    sceneRef.current = parsed.scene
  }, [parsed.scene, source])

  useEffect(() => {
    if (!parsed.scene || !onResolveImage) return
    const paths = [...new Set(parsed.scene.elements.flatMap((item) => item.type === 'note' && item.imagePath ? [item.imagePath] : []))]
    paths.forEach((path) => {
      if (imageSources[path] || imageLoadPathsRef.current.has(path)) return
      imageLoadPathsRef.current.add(path)
      void onResolveImage(path)
        .then((dataUrl) => setImageSources((current) => current[path] ? current : { ...current, [path]: dataUrl }))
        .catch((error) => setImageImportError(error instanceof Error ? error.message : String(error)))
        .finally(() => imageLoadPathsRef.current.delete(path))
    })
  }, [imageSources, onResolveImage, parsed.scene])

  useEffect(() => {
    if (!parsed.scene?.architecture) return
    setArchitectureTheme(parsed.scene.architecture.theme)
    setArchitectureView(parsed.scene.architecture.view ?? 'detail')
    setArchitectureDensity(parsed.scene.architecture.density ?? 'auto')
  }, [parsed.scene?.architecture?.density, parsed.scene?.architecture?.theme, parsed.scene?.architecture?.view])

  useEffect(() => {
    if (!parsed.scene) return
    const workbench = parsed.scene.workbench ?? (parsed.scene.architecture ? 'architecture' : 'freeform')
    if (workbench === 'flowchart' && !activeShapeRef.startsWith('flowchart:')) setActiveShapeRef('flowchart:process')
    if (workbench === 'freeform' && activeShapeRef.startsWith('flowchart:')) setActiveShapeRef('basic:rectangle')
    if (workbench === 'architecture') setShapeLibraryOpen(false)
  }, [activeShapeRef, parsed.scene?.architecture, parsed.scene?.workbench])

  useEffect(() => {
    if (!parsed.scene || !architectureScope) return
    const exists = architectureScope.kind === 'group'
      ? parsed.scene.groups?.some((group) => group.id === architectureScope.id)
      : architectureScope.kind === 'lane'
        ? parsed.scene.lanes?.some((lane) => lane.id === architectureScope.id)
        : parsed.scene.elements.some((item) => item.type !== 'arrow' && item.id === architectureScope.id)
    if (!exists) setArchitectureScope(null)
  }, [architectureScope, parsed.scene])

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => () => {
    if (gestureVisualFrameRef.current !== null) window.cancelAnimationFrame(gestureVisualFrameRef.current)
    if (geometryDraftFrameRef.current !== null) window.cancelAnimationFrame(geometryDraftFrameRef.current)
  }, [])

  useEffect(() => {
    if (!connectFrom) {
      setConnectPreviewPoint(null)
      setConnectFromAnchor('auto')
    }
  }, [connectFrom])

  useEffect(() => {
    const closeTransientMenus = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('.freeform-inspector-more')) setInspectorMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeTransientMenus)
    return () => window.removeEventListener('pointerdown', closeTransientMenus)
  }, [])

  useEffect(() => {
    if (!parsed.scene) return
    const valid = selectedIds.filter((id) => parsed.scene!.elements.some((item) => item.id === id))
    if (valid.length !== selectedIds.length) setSelectedIds(valid)
  }, [parsed.scene, selectedIds])

  useEffect(() => {
    const element = editorRef.current
    if (!element) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || target.closest('input, textarea, select, a, summary, [role="combobox"], [role="listbox"], [role="menu"]'))) return
      if (target?.closest('button') && (!target.closest('.freeform-floating-toolbar') || event.code === 'Space' || event.key === 'Enter')) return
      const mod = event.metaKey || event.ctrlKey
      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePanning(true)
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedIds(currentScene().elements.filter((item) => item.type !== 'arrow').map((item) => item.id))
        return
      }
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copySelection()
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        pasteSelection()
        return
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        copySelection()
        pasteSelection()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'Escape') {
        if (toolbarMenu || inspectorMenuOpen || iconPickerOpen) {
          setToolbarMenu(null)
          setInspectorMenuOpen(false)
          setIconPickerOpen(false)
          return
        }
        if (drag.current || connectFrom || tool !== 'select') {
          cancelGesture()
          setConnectFrom(null)
          setConnectPreviewPoint(null)
          setConnectFromAnchor('auto')
          setTool('select')
          return
        }
        if (architectureScope) {
          setArchitectureScope(null)
          setViewport({ x: 0, y: 0, zoom: 1 })
          return
        }
        setContextMenu(null)
        setSelectedIds([])
        setSelectedGroupTarget(null)
        setTraceDirection(null)
        setConnectFrom(null)
        setConnectFromAnchor('auto')
        arrowEndpointPreviewRef.current = null
        setArrowEndpointPreview(null)
        lineDraftRef.current = null
        setLineDraft(null)
        freehandDraftRef.current = null
        setFreehandDraft(null)
        drag.current = null
        clearGestureVisual()
        clearGeometryDrafts()
        setTool('select')
        return
      }
      const key = event.key.toLowerCase()
      if (!mod && key === 'v') setTool('select')
      if (!mod && key === 'h') setTool('hand')
      if (!mod && key === 'n') setTool('node')
      if (!mod && key === 't') setTool('text')
      if (!mod && key === 'm') setTool('note')
      if (!mod && key === 'c') setTool('connect')
      if (!mod && key === 'l') setTool('line')
      if (!mod && key === 'a') setTool('arrow')
      if (!mod && key === 'p') setTool('pen')
      if (!mod && key === 'i' && onImportImage) imageInputRef.current?.click()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false)
    }
    element.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      element.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const selectedBoxForLinks = useMemo(() => {
    if (!parsed.scene) return null
    const selected = parsed.scene.elements.filter((item) => selectedIds.includes(item.id))
    if (selected.length !== 1 || selected[0].type === 'arrow') return null
    return selected[0]
  }, [parsed.scene, selectedIds])

  useEffect(() => {
    setInspectorCollapsed(false)
    setSourceLinkError(null)
    setSourceLinkQuery('')
    setSourceLinkOptions([])
    setInspectorMenuOpen(false)
  }, [selectedBoxForLinks?.id])

  useEffect(() => {
    if (!selectedBoxForLinks || !onSearchSources || !sourceLinkQuery.trim()) {
      setSourceLinkLoading(false)
      setSourceLinkOptions([])
      setSourceLinkError(null)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      setSourceLinkLoading(true)
      setSourceLinkError(null)
      void onSearchSources(sourceLinkQuery.trim())
        .then((files) => {
          if (!cancelled) setSourceLinkOptions(files.filter((path) => !selectedBoxForLinks.sourcePaths?.includes(path)).slice(0, 8))
        })
        .catch((cause) => {
          if (!cancelled) {
            setSourceLinkOptions([])
            setSourceLinkError(cause instanceof Error ? cause.message : '搜索源码失败')
          }
        })
        .finally(() => {
          if (!cancelled) setSourceLinkLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [onSearchSources, selectedBoxForLinks, sourceLinkQuery])

  useEffect(() => {
    if (!parsed.scene || !focusElementIds?.length || !focusKey || focusKey === lastFocusKey.current) return
    const targets = parsed.scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && focusElementIds.includes(item.id))
    if (!targets.length) return
    lastFocusKey.current = focusKey
    setSelectedIds(targets.map((item) => item.id))
    const left = Math.min(...targets.map((item) => item.x))
    const top = Math.min(...targets.map((item) => item.y))
    const right = Math.max(...targets.map((item) => item.x + item.width))
    const bottom = Math.max(...targets.map((item) => item.y + item.height))
    const paddedWidth = Math.max(260, right - left + 220)
    const paddedHeight = Math.max(180, bottom - top + 180)
    const zoom = clamp(Math.min(parsed.scene.width / paddedWidth, parsed.scene.height / paddedHeight), 1, 2.8)
    const viewWidth = parsed.scene.width / zoom
    const viewHeight = parsed.scene.height / zoom
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    setViewport({
      zoom,
      x: clamp(centerX - viewWidth / 2, 0, Math.max(0, parsed.scene.width - viewWidth)),
      y: clamp(centerY - viewHeight / 2, 0, Math.max(0, parsed.scene.height - viewHeight)),
    })
  }, [focusElementIds, focusKey, parsed.scene])

  useEffect(() => {
    if (!focusKey || focusKey === lastTraceKey.current) return
    lastTraceKey.current = focusKey
    if (!traceRequest || traceRequest.key !== focusKey) {
      setTraceDirection(null)
      return
    }
    const seeds = traceRequest.seedElementIds.filter((id) => parsed.scene?.elements.some((item) => item.type !== 'arrow' && item.id === id))
    if (!seeds.length) return
    setSelectedIds(seeds)
    setSelectedGroupTarget(null)
    setTraceDirection(traceRequest.direction)
    setTraceDepth(traceRequest.depth)
    // traceRequest is an event keyed by the thread state's updatedAt. The parent
    // may recreate the object while rendering; only react to a new event key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, parsed.scene, traceRequest?.key])

  useEffect(() => {
    const external = playbackRequest?.key && playbackRequest.key !== lastTransitionKey.current ? playbackRequest : null
    let before = layoutBefore.current
    layoutBefore.current = null
    if (!external && !before) return
    if (external) {
      lastTransitionKey.current = external.key
      if (external.fromSource) {
        // 旧文件可能是正在修复的无效 JSON；此时直接展示最新结果。
        try { before = parseCanvasScene(external.fromSource) } catch { onPlaybackComplete?.(external.key); return }
      }
    }
    if (!parsed.scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (external) onPlaybackComplete?.(external.key)
      return
    }
    const next = parsed.scene
    const plan = buildCanvasPlaybackPlan(before ?? undefined, next, external?.mode ?? 'update')
    const changedIds = new Set(plan.actions.flatMap((action) => action.kind === 'arrange' ? action.ids
      : action.kind === 'boundary' ? [] : action.kind === 'delete' ? [action.element.id] : [action.id]))
    const previousById = new Map(before?.elements.map((item) => [item.id, item]) ?? [])
    const nextById = new Map(next.elements.map((item) => [item.id, item]))
    const regionOrder = new Map(plan.regions.flatMap((region, index) => region.elementIds.map((id) => [id, index] as const)))
    setHighlightedIds(changedIds)
    const animations: Animation[] = []
    const frame = window.requestAnimationFrame(() => {
      for (const element of svgRef.current?.querySelectorAll<SVGGElement>('g[data-element-id]') ?? []) {
        const id = element.dataset.elementId!
        if (!changedIds.has(id)) continue
        const previous = previousById.get(id)
        const current = nextById.get(id)
        if (!previous) {
          animations.push(element.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 180, delay: external?.mode === 'create' ? Math.min(120, (regionOrder.get(id) ?? 0) * 40) : 0,
            easing: 'ease-out', fill: 'backwards',
          }))
        } else if (previous.type !== 'arrow' && current && current.type !== 'arrow'
          && (previous.x !== current.x || previous.y !== current.y)) {
          animations.push(element.animate([
            { translate: `${previous.x - current.x}px ${previous.y - current.y}px` }, { translate: '0px 0px' },
          ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }))
        }
      }
    })
    const finish = window.setTimeout(() => {
      setHighlightedIds(new Set())
      if (external) onPlaybackComplete?.(external.key)
    }, 700)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(finish)
      animations.forEach((animation) => animation.cancel())
      setHighlightedIds(new Set())
      if (external) onPlaybackComplete?.(external.key)
    }
    // 每次数据更新只触发一次，手工拖动期间不插入位置过渡。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, playbackRequest?.key, playbackRequest?.path])

  const traceResult = useMemo(() => {
    if (!parsed.scene || !traceDirection) return null
    const seeds = selectedIds.filter((id) => parsed.scene!.elements.some((item) => item.type !== 'arrow' && item.id === id))
    return seeds.length ? traceCanvasGraph(parsed.scene, seeds, traceDirection, traceDepth) : null
  }, [parsed.scene, selectedIds, traceDepth, traceDirection])

  const staticArchitectureProjection = useMemo(() => {
    if (!parsed.scene) return null
    return canvasArchitectureProjection(parsed.scene)
  }, [parsed.scene])
  const partitionFlow = useMemo(() => parsed.scene?.architecture
    ? architecturePartitionFlow(parsed.scene) : null, [parsed.scene])
  const staticScopeProjection = useMemo(() => {
    if (!parsed.scene || !architectureScope) return null
    return canvasArchitectureScopeProjection(parsed.scene, architectureScope)
  }, [architectureScope, parsed.scene])
  const lodScene = staticScopeProjection?.scene ?? staticArchitectureProjection?.scene
  const lodNodeCount = useMemo(() => lodScene?.elements.filter((item) => item.type !== 'arrow').length ?? 0, [lodScene])
  const lodLevel: CanvasSemanticLodLevel = architectureScope ? 'detail' : resolveCanvasSemanticLod(viewport.zoom, lodNodeCount)
  const lodSelection = lodLevel === 'detail' || lodLevel === 'compact' ? null : selectedIds
  const staticSemanticLodProjection = useMemo(() => {
    if (!lodScene) return null
    if (architectureScope) {
      return { scene: lodScene, level: 'detail' as const, autoCollapsedGroupIds: [], hiddenNodes: 0, hiddenArrows: 0 }
    }
    return canvasSemanticLodProjection(lodScene, lodLevel, lodSelection ?? [])
  }, [architectureScope, lodScene, lodLevel, lodSelection])
  const sourceBoxes = useMemo(() => parsed.scene?.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow') ?? [], [parsed.scene])
  const sourceArrows = useMemo(() => parsed.scene?.elements.filter((item): item is CanvasArrow => item.type === 'arrow') ?? [], [parsed.scene])
  const sourceCollisionIndex = useMemo(() => selectedIds.length > 3 ? new CanvasRectIndex(sourceBoxes) : null, [selectedIds.length > 3, sourceBoxes])
  const staticRenderItems = useMemo(() => {
    const scene = staticSemanticLodProjection?.scene
    if (!scene) return null
    const collapsedOwners = canvasCollapsedOwners(scene)
    const projectedBoxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
    const projectedArrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
    const boxes = projectedBoxes.filter((item) => !collapsedOwners.has(item.id))
    const arrows = projectedArrows.filter((item) => !collapsedOwners.has(item.from) && !collapsedOwners.has(item.to))
    const index = boxes.length > 6000 ? new CanvasRectIndex(boxes, 768) : null
    return {
      scene, collapsedOwners, projectedBoxes, projectedArrows, boxes, arrows, index,
      // For ordinary scenes a linear filter is faster than collecting/sorting indexed hits.
      byId: index ? new Map(boxes.map((item) => [item.id, item])) : null,
    }
  }, [staticSemanticLodProjection])
  const staticArrowBoxes = useMemo(() => staticRenderItems
    ? new Map(staticRenderItems.projectedBoxes.map((item) => [item.id, item]))
    : null, [staticRenderItems])
  const staticMinimapNodeCloudPath = useMemo(() => {
    if (!staticRenderItems || staticRenderItems.boxes.length <= 420) return ''
    const selected = new Set(selectedIds)
    return staticRenderItems.boxes.filter((item) => !selected.has(item.id)).map((item) => `M ${item.x} ${item.y} H ${item.x + item.width} V ${item.y + item.height} H ${item.x} Z`).join(' ')
  }, [selectedIds, staticRenderItems])
  const staticGroupBounds = useMemo(() => parsed.scene ? canvasGroupFrames(parsed.scene) : [], [parsed.scene])
  const staticProjectedGroupBounds = useMemo(() => {
    const projected = staticSemanticLodProjection?.scene
    return projected ? canvasGroupFrames(projected) : []
  }, [staticSemanticLodProjection])
  const staticArchitectureHeader = useMemo(() => parsed.scene ? canvasArchitectureHeader(parsed.scene) : undefined, [parsed.scene])
  const architectureScene = Boolean(parsed.scene?.architecture)
  const staticUnculledScene = useMemo(() => {
    if (!staticSemanticLodProjection?.scene) return null
    const projected = staticSemanticLodProjection.scene
    if (!architectureScope) {
      const limit = architectureScene ? staticArchitectureProjection?.view === 'detail' ? 100 : Infinity : 180
      // A conservative upper bound: collapsed nodes may lower the actual count, but never raise it.
      if (projected.elements.filter((item) => item.type !== 'arrow').length > limit) return null
    }
    return projected
  }, [architectureScene, architectureScope, staticArchitectureProjection, staticSemanticLodProjection])
  const staticRelationshipGeometry = useMemo(() => staticUnculledScene ? {
    connections: canvasCollapsedConnections(staticUnculledScene, staticProjectedGroupBounds),
    trunks: canvasBundleTrunks(staticUnculledScene),
  } : null, [staticProjectedGroupBounds, staticUnculledScene])
  const staticRelationshipLabels = useMemo(() => staticUnculledScene
    ? canvasArrowLabelLayouts(relationLabelScene(staticUnculledScene, architectureScene, staticSemanticLodProjection!.level, new Set(selectedIds)))
    : null, [architectureScene, selectedIds, staticSemanticLodProjection, staticUnculledScene])

  useEffect(() => {
    if (!parsed.scene || selectedIds.length === 0) {
      onSelectionChange?.(null)
      return
    }
    onSelectionChange?.({
      ids: selectedIds,
      elements: parsed.scene.elements.filter((item) => selectedIds.includes(item.id)),
      ...(traceResult && traceDirection ? { trace: { direction: traceDirection, depth: traceDepth, nodeIds: traceResult.nodeIds, arrowIds: traceResult.arrowIds } } : {}),
    })
  }, [onSelectionChange, parsed.scene, selectedIds, traceDepth, traceDirection, traceResult])

  if (!parsed.scene) {
    return <div className="canvas-invalid"><strong>自由画布无法渲染</strong><span>{parsed.error}</span><p>可以切到“源码”修复 JSON。</p></div>
  }

  const scene = parsed.scene
  const visualSkin = canvasVisualSkin(scene.style, darkTheme)
  const workbench = scene.workbench ?? (scene.architecture ? 'architecture' : 'freeform')
  const architectureWorkbench = workbench === 'architecture'
  const flowchartWorkbench = workbench === 'flowchart'
  const shapeLibraryPacks = flowchartWorkbench ? ['flowchart', 'basic'] as const : ['basic', 'flowchart'] as const
  const boxes = sourceBoxes
  const arrows = sourceArrows
  const baseArchitectureProjection = staticArchitectureProjection!
  const scopedArchitectureProjection = staticScopeProjection
  const architectureProjection = scopedArchitectureProjection
    ? {
        ...baseArchitectureProjection,
        scene: scopedArchitectureProjection.scene,
        hiddenNodes: scopedArchitectureProjection.hiddenNodes,
        hiddenArrows: scopedArchitectureProjection.hiddenArrows,
      }
    : baseArchitectureProjection
  const semanticLodProjection = staticSemanticLodProjection!
  const semanticLodLevel = semanticLodProjection.level
  const autoCollapsedGroupIds = new Set(semanticLodProjection.autoCollapsedGroupIds)
  const renderSceneBase = semanticLodProjection.scene
  const renderScene = gesturePositionOverrides || transformDrafts || arrowPointDraft
    ? {
        ...renderSceneBase,
        elements: renderSceneBase.elements.map((item) => {
          if (item.type === 'arrow') return arrowPointDraft?.id === item.id ? { ...item, points: arrowPointDraft.points, bundleKey: undefined } : item
          const position = gesturePositionOverrides?.[item.id]
          const transform = transformDrafts?.[item.id]
          if (!position && !transform) return item
          return {
            ...item,
            ...(transform ? { x: transform.x, y: transform.y, width: transform.width, height: transform.height, rotation: transform.rotation } : {}),
            ...(position ? { x: position.x, y: position.y } : {}),
          }
        }),
      }
    : renderSceneBase
  const architectureBreadcrumbs = scopedArchitectureProjection?.breadcrumbs ?? []
  const staticGeometry = staticRenderItems?.scene === renderScene ? staticRenderItems : null
  const projectedBoxes = staticGeometry?.projectedBoxes ?? renderScene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const projectedArrows = staticGeometry?.projectedArrows ?? renderScene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const selected = scene.elements.filter((item) => selectedIds.includes(item.id))
  const selectedSingle = selected.length === 1 ? selected[0] : null
  const selectedBox = selectedSingle && selectedSingle.type !== 'arrow' ? selectedSingle : null
  const selectedBoxes = selected.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const projectedSelectedBoxes = projectedBoxes.filter((item) => selectedIds.includes(item.id))
  const multiTransformBounds = !architectureWorkbench && projectedSelectedBoxes.length > 1 && selectedBoxes.every((item) => !item.locked) ? canvasBoxesBounds(projectedSelectedBoxes) : null
  const selectedTextBox = selectedBox?.type === 'note' && selectedBox.textOnly ? selectedBox : null
  const selectedImageBox = selectedBox?.type === 'note' && selectedBox.imagePath ? selectedBox : null
  const batchStyleBoxes = selectedBoxes.filter((item) => !(item.type === 'note' && (item.textOnly || item.imagePath)))
  const batchFillValues = new Set(batchStyleBoxes.map((item) => item.fillColor ?? ''))
  const batchStrokeValues = new Set(batchStyleBoxes.map((item) => item.strokeColor ?? ''))
  const batchWidthValues = new Set(batchStyleBoxes.map((item) => item.strokeWidth ?? 1.6))
  const batchOpacityValues = new Set(batchStyleBoxes.map((item) => item.opacity ?? 1))
  const batchFillColor = batchFillValues.size === 1 ? [...batchFillValues][0] || undefined : undefined
  const batchStrokeColor = batchStrokeValues.size === 1 ? [...batchStrokeValues][0] || undefined : undefined
  const batchStrokeWidth = batchWidthValues.size === 1 ? [...batchWidthValues][0] : undefined
  const batchOpacity = batchOpacityValues.size === 1 ? [...batchOpacityValues][0] : undefined
  const iconPickerNeedle = iconPickerQuery.trim().toLocaleLowerCase()
  const iconPickerEntries = CANVAS_ICON_CATALOG.filter((entry) => {
    if (iconPickerSource !== 'all' && entry.source !== iconPickerSource) return false
    if (!iconPickerNeedle) return true
    return [entry.label, entry.ref, ...entry.keywords].some((value) => value.toLocaleLowerCase().includes(iconPickerNeedle))
  })
  const assetNeedle = assetQuery.trim().toLocaleLowerCase()
  const architectureAssets = ARCHITECTURE_NODE_TEMPLATES.filter((asset) => {
    if (assetProvider !== 'all' && asset.provider !== assetProvider) return false
    if (!assetNeedle) return true
    return [asset.label, asset.subtitle, asset.category, asset.id, ...asset.keywords]
      .some((value) => value.toLocaleLowerCase().includes(assetNeedle))
  })
  const favoriteAssets = favoriteTemplateIds
    .map((id) => architectureNodeTemplate(id))
    .filter((asset): asset is ArchitectureNodeTemplate => Boolean(asset))
    .filter((asset) => assetProvider === 'all' || asset.provider === assetProvider)
  const recentAssets = recentTemplateIds
    .filter((id) => !favoriteTemplateIds.includes(id))
    .map((id) => architectureNodeTemplate(id))
    .filter((asset): asset is ArchitectureNodeTemplate => Boolean(asset))
    .filter((asset) => assetProvider === 'all' || asset.provider === assetProvider)
  const selectedLocked = selectedBoxes.filter((item) => item.locked)
  const selectedGroupIds = [...new Set(selectedBoxes.map((item) => item.groupId).filter((value): value is string => Boolean(value)))]
  const groupBounds = staticGroupBounds
  const hasGeometryDraft = Boolean(gesturePositionOverrides || transformDrafts || arrowPointDraft)
  const projectedGroupBounds = hasGeometryDraft ? canvasGroupFrames(renderScene) : staticProjectedGroupBounds
  const displayGroupBounds = projectedGroupBounds
  // Only an explicitly selected boundary owns the boundary inspector. Nodes that
  // happen to share a group remain a node/multi-selection instead of silently
  // switching the inspector into group-editing mode.
  const selectedGroupId = selectedGroupTarget ?? undefined
  const selectedGroup = selectedGroupId
    ? scene.groups?.find((group) => group.id === selectedGroupId) ?? { id: selectedGroupId, label: selectedGroupId, tone: 'muted' as CanvasTone }
    : undefined
  const c4CollapseLevel: CanvasC4CollapseLevel = scene.groups?.some((group) => group.c4Type === 'software-system' && group.collapsed)
    ? 'system'
    : scene.groups?.some((group) => group.c4Type === 'container' && group.collapsed)
      ? 'container'
      : 'expanded'
  const collapsedOwners = staticGeometry?.collapsedOwners ?? canvasCollapsedOwners(renderScene)
  const collapsedMemberIds = new Set(collapsedOwners.keys())
  const renderBoxes = staticGeometry?.boxes ?? projectedBoxes.filter((item) => !collapsedMemberIds.has(item.id))
  const renderArrows = staticGeometry?.arrows ?? projectedArrows.filter((arrow) => !collapsedMemberIds.has(arrow.from) && !collapsedMemberIds.has(arrow.to))
  const dragCollisionIds = new Set<string>()
  if (gesturePositionOverrides) {
    const movingIds = new Set(Object.keys(gesturePositionOverrides))
    const stationaryBoxes = movingIds.size > 3 ? new CanvasRectIndex(renderBoxes.filter((item) => !movingIds.has(item.id))) : null
    for (const item of renderBoxes) {
      if (!movingIds.has(item.id)) continue
      const overlap = stationaryBoxes
        ? stationaryBoxes.overlaps({ x: item.x - 8, y: item.y - 8, width: item.width + 16, height: item.height + 16 })
        : renderBoxes.some((other) => !movingIds.has(other.id) && rectanglesOverlapWithPadding(item, other, 8))
      if (overlap) dragCollisionIds.add(item.id)
    }
  }
  const gestureAutoReflowCount = gesturePositionOverrides
    ? Object.keys(gesturePositionOverrides).filter((id) => !selectedIds.includes(id)).length
    : 0
  const selectedHasOverlap = selectedBoxes.some((item) => sourceCollisionIndex && selectedBoxes.length > 3
    ? sourceCollisionIndex.overlaps({ x: item.x - 8, y: item.y - 8, width: item.width + 16, height: item.height + 16 }, (other) => item.id !== other.id)
    : boxes.some((other) => item.id !== other.id && rectanglesOverlapWithPadding(item, other, 8)))
  const minimapViewBounds = (() => {
    if (!architectureScope) return { x: 0, y: 0, width: scene.width, height: scene.height }
    const rects = [
      ...renderBoxes.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
      ...projectedGroupBounds.filter((group) => group.collapsed).map((group) => ({ x: group.x, y: group.y, width: group.width, height: group.height })),
    ]
    if (!rects.length) return { x: 0, y: 0, width: scene.width, height: scene.height }
    const padding = 90
    const minX = Math.max(0, Math.min(...rects.map((rect) => rect.x)) - padding)
    const minY = Math.max(0, Math.min(...rects.map((rect) => rect.y)) - padding)
    const maxX = Math.min(scene.width, Math.max(...rects.map((rect) => rect.x + rect.width)) + padding)
    const maxY = Math.min(scene.height, Math.max(...rects.map((rect) => rect.y + rect.height)) + padding)
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  })()
  const largeSceneViewportCulling = Boolean(
    !architectureScope
    && (
      scene.architecture
        ? architectureProjection.view === 'detail' && renderBoxes.length > 100
        : renderBoxes.length > 180
    ),
  )
  const viewportMargin = 220 / Math.max(0.45, viewport.zoom)
  const viewportBounds = {
    x: viewport.x - viewportMargin,
    y: viewport.y - viewportMargin,
    width: scene.width / viewport.zoom + viewportMargin * 2,
    height: scene.height / viewport.zoom + viewportMargin * 2,
  }
  const selectedArrowEndpointIds = new Set(renderArrows
    .filter((arrow) => selectedIds.includes(arrow.id))
    .flatMap((arrow) => [arrow.from, arrow.to]))
  const viewportRenderBoxes = largeSceneViewportCulling
    ? staticGeometry?.index
      ? staticGeometry.index.find(viewportBounds, [...new Set([...selectedIds, ...selectedArrowEndpointIds])]
        .map((id) => staticGeometry.byId?.get(id)).filter((item): item is CanvasNode | CanvasNote => Boolean(item)))
      : renderBoxes.filter((item) => selectedIds.includes(item.id) || selectedArrowEndpointIds.has(item.id) || intersects(viewportBounds, item))
    : renderBoxes
  const viewportNodeIds = new Set(viewportRenderBoxes.map((item) => item.id))
  const viewportArrowBoxes = largeSceneViewportCulling
    ? staticGeometry && staticArrowBoxes ? staticArrowBoxes : new Map(projectedBoxes.map((item) => [item.id, item]))
    : null
  const viewportRenderArrows = largeSceneViewportCulling
    ? renderArrows.filter((arrow) => selectedIds.includes(arrow.id) || viewportNodeIds.has(arrow.from) || viewportNodeIds.has(arrow.to)
      || canvasArrowCrossesViewport(arrow, viewportArrowBoxes!, viewportBounds))
    : renderArrows
  const viewportGroupBounds = largeSceneViewportCulling
    ? canvasPresentationGroupFrames(renderScene, displayGroupBounds)
      .filter((group) => selectedGroupId === group.id || selectedGroupIds.includes(group.id) || intersects(viewportBounds, group))
    : canvasPresentationGroupFrames(renderScene, displayGroupBounds)
  const visibleRenderBoxes = viewportRenderBoxes
  const visibleRenderArrows = viewportRenderArrows
  const reuseStaticRelationships = staticUnculledScene === renderScene && !largeSceneViewportCulling
  const collapsedConnections = reuseStaticRelationships && staticRelationshipGeometry
    ? staticRelationshipGeometry.connections : canvasCollapsedConnections(renderScene, projectedGroupBounds)
  const relationshipRenderScene = largeSceneViewportCulling
    ? { ...renderScene, elements: [...viewportRenderBoxes, ...viewportRenderArrows] }
    : renderScene
  const relationBundleTrunks = Boolean(gesturePositionOverrides) && renderArrows.length > 120
    ? []
    : reuseStaticRelationships && staticRelationshipGeometry ? staticRelationshipGeometry.trunks : canvasBundleTrunks(relationshipRenderScene)
  const selectedIdSet = new Set(selectedIds)
  const reusableVisibleLabels = Boolean(largeSceneViewportCulling && staticGeometry && !hasGeometryDraft && !arrowLabelDraft)
  const selectedArrowIds = reusableVisibleLabels ? viewportRenderArrows.filter((arrow) => selectedIdSet.has(arrow.id)).map((arrow) => arrow.id) : []
  const previouslyVisible = visibleLabelCache.current
  const cachedVisibleLabels = reusableVisibleLabels && previouslyVisible?.scene === renderScene && previouslyVisible.level === semanticLodLevel
    && previouslyVisible.boxes.length === viewportRenderBoxes.length && previouslyVisible.arrows.length === viewportRenderArrows.length
    && previouslyVisible.selectedArrowIds.length === selectedArrowIds.length
    && previouslyVisible.boxes.every((item, index) => item === viewportRenderBoxes[index])
    && previouslyVisible.arrows.every((item, index) => item === viewportRenderArrows[index])
    && previouslyVisible.selectedArrowIds.every((id, index) => id === selectedArrowIds[index])
    ? previouslyVisible.labels : null
  const savedMoveLabels = moveLabels.current
  const frozenMoveLabels = semanticLodLevel === 'detail' && largeSceneViewportCulling && renderArrows.length > 1000
    && gesturePositionOverrides && !transformDrafts && !arrowPointDraft
    && savedMoveLabels?.scene === renderSceneBase
    && savedMoveLabels.viewport.x === viewport.x && savedMoveLabels.viewport.y === viewport.y && savedMoveLabels.viewport.zoom === viewport.zoom
    && savedMoveLabels.arrowIds.length === viewportRenderArrows.length
    && savedMoveLabels.arrowIds.every((id, index) => id === viewportRenderArrows[index].id)
    ? savedMoveLabels.labels : null
  const relationLabelLayouts = frozenMoveLabels ?? cachedVisibleLabels ?? (reuseStaticRelationships && staticRelationshipLabels
    ? staticRelationshipLabels : canvasArrowLabelLayouts(relationLabelScene(relationshipRenderScene, architectureScene, semanticLodLevel, selectedIdSet))
  )
  if (reusableVisibleLabels && !cachedVisibleLabels) {
    visibleLabelCache.current = {
      scene: renderScene, level: semanticLodLevel,
      boxes: viewportRenderBoxes, arrows: viewportRenderArrows,
      selectedArrowIds, labels: relationLabelLayouts,
    }
  }
  const architectureHeader = staticArchitectureHeader
  const architectureLegendStart = architectureHeader
    ? Math.max(scene.width * 0.56, scene.width - architectureHeader.legend.length * 92 - 34)
    : 0
  const selectedLane = selectedBox?.laneId ? scene.lanes?.find((lane) => lane.id === selectedBox.laneId) : undefined
  const layerNeedle = layerQuery.trim().toLocaleLowerCase()
  const layerBoxes = layerNeedle
    ? boxes.filter((item) => [item.text, item.subtitle, item.description, ...(item.tags ?? []), ...(item.sourcePaths ?? [])].some((value) => value?.toLocaleLowerCase().includes(layerNeedle)))
    : boxes
  const tracedNodeIds = new Set(traceResult?.nodeIds ?? [])
  const tracedArrowIds = new Set(traceResult?.arrowIds ?? [])
  const projectedBoxLookup = new Map<string, CanvasNode | CanvasNote>(projectedBoxes.map((item) => [item.id, item]))
  const minimapVisible = minimapOpen ?? largeSceneViewportCulling
  const compactMinimap = renderBoxes.length > 420
  const minimapNodeCloudPath = compactMinimap
    ? staticGeometry ? staticMinimapNodeCloudPath
      : renderBoxes.filter((item) => !selectedIdSet.has(item.id)).map((item) => `M ${item.x} ${item.y} H ${item.x + item.width} V ${item.y + item.height} H ${item.x} Z`).join(' ')
    : ''
  const connectSourceBox = connectFrom ? boxes.find((item) => item.id === connectFrom) : undefined
  const connectPreviewStart = connectSourceBox && connectPreviewPoint
    ? anchorPoint(connectSourceBox, connectFromAnchor, connectPreviewPoint)
    : null

  function currentScene(): CanvasScene {
    if (!sceneRef.current) throw new Error('Canvas scene unavailable')
    return sceneRef.current
  }

  function emitSource(nextSource: string, record = true) {
    if (nextSource === sourceRef.current) return
    if (record) {
      undoStack.current.push(sourceRef.current)
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
    }
    sourceRef.current = nextSource
    try { sceneRef.current = parseCanvasScene(nextSource) } catch { /* source editor owns invalid JSON */ }
    onChange(nextSource)
  }

  function commit(next: CanvasScene, record = true, animate = false) {
    if (animate) layoutBefore.current = currentScene()
    sceneRef.current = next
    emitSource(serializeCanvasScene(next), record)
  }

  function scheduleGestureVisual(draft: GestureVisualDraft) {
    pendingGestureVisualRef.current = draft
    if (gestureVisualFrameRef.current !== null) return
    gestureVisualFrameRef.current = window.requestAnimationFrame(() => {
      gestureVisualFrameRef.current = null
      const pending = pendingGestureVisualRef.current
      pendingGestureVisualRef.current = null
      if (!pending) return
      setGesturePositionOverrides(pending.positions)
      setSnapGuides(pending.guides)
      setInsertTarget(pending.insertTarget)
    })
  }

  function clearGestureVisual() {
    if (gestureVisualFrameRef.current !== null) {
      window.cancelAnimationFrame(gestureVisualFrameRef.current)
      gestureVisualFrameRef.current = null
    }
    pendingGestureVisualRef.current = null
    gesturePositionOverridesRef.current = null
    insertTargetRef.current = null
    setGesturePositionOverrides(null)
    setSnapGuides({})
    setInsertTarget(null)
  }

  function clearGeometryDrafts() {
    if (geometryDraftFrameRef.current !== null) {
      window.cancelAnimationFrame(geometryDraftFrameRef.current)
      geometryDraftFrameRef.current = null
    }
    transformDraftsRef.current = null
    arrowPointDraftRef.current = null
    arrowLabelDraftRef.current = null
    setTransformDrafts(null)
    setArrowPointDraft(null)
    setArrowLabelDraft(null)
  }

  function scheduleGeometryDraftRender() {
    if (geometryDraftFrameRef.current !== null) return
    geometryDraftFrameRef.current = window.requestAnimationFrame(() => {
      geometryDraftFrameRef.current = null
      setTransformDrafts(transformDraftsRef.current)
      setArrowPointDraft(arrowPointDraftRef.current)
      setArrowLabelDraft(arrowLabelDraftRef.current)
    })
  }

  function commitGeometry(next: CanvasScene, record = true, changedNodeIds?: Iterable<string>, animate = false) {
    commit(next.architecture
      ? changedNodeIds ? routeArchitectureEdgesIncremental(next, changedNodeIds) : routeArchitectureEdges(next)
      : next, record, animate)
  }

  function routeArrowIds(scene: CanvasScene, ids: string[]): CanvasScene {
    return routeArchitectureArrowIds(scene, ids)
  }

  function beautifyArchitecture() {
    const current = currentScene()
    const result = beautifyArchitectureScene(current, {
      theme: architectureTheme,
      view: architectureView,
      density: architectureDensity,
    })
    commit(result.scene, true, true)
  }

  function tidyArchitectureRoutes() {
    commit(routeArchitectureEdges(currentScene()))
  }

  function applyArchitectureTheme(theme: ArchitectureTheme) {
    const current = currentScene()
    const themed = applyArchitectureThemeToScene(current, theme)
    setArchitectureTheme(theme)
    commit({
      ...themed,
      architecture: {
        theme,
        ...(theme === 'presentation' ? { presentation: true } : {}),
        view: current.architecture?.view ?? architectureView,
        density: current.architecture?.density ?? architectureDensity,
      },
    })
  }

  function updateArchitectureAppearance(patch: { view?: CanvasArchitectureView; density?: CanvasArchitectureDensity }) {
    const current = currentScene()
    commit({
      ...current,
      architecture: {
        theme: current.architecture?.theme ?? architectureTheme,
        ...(current.architecture?.presentation ? { presentation: true } : {}),
        view: patch.view ?? current.architecture?.view ?? architectureView,
        density: patch.density ?? current.architecture?.density ?? architectureDensity,
      },
    })
  }

  function applyArchitectureDensity(density: CanvasArchitectureDensity) {
    const result = beautifyArchitectureScene(currentScene(), {
      theme: architectureTheme,
      view: architectureView,
      density,
    })
    setArchitectureDensity(density)
    commit(result.scene, true, true)
  }

  function recordGesture(before: string) {
    if (before === sourceRef.current) return
    undoStack.current.push(before)
    if (undoStack.current.length > 100) undoStack.current.shift()
    redoStack.current = []
  }

  function undo() {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(sourceRef.current)
    emitSource(previous, false)
  }

  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(sourceRef.current)
    emitSource(next, false)
  }

  function updateElement(id: string, updater: (item: CanvasElement) => CanvasElement, record = true) {
    const live = currentScene()
    commit({ ...live, elements: live.elements.map((item) => item.id === id ? updater(item) : item) }, record)
  }

  function addBox(kind: 'node' | 'note', x: number, y: number) {
    const live = currentScene()
    const id = nextCanvasElementId(kind, live.elements)
    const shape = kind === 'node' && live.workbench !== 'architecture' ? canvasShapeDefinition(activeShapeRef) : undefined
    const width = shape?.width ?? 200
    const height = shape?.height ?? 90
    const element: CanvasNode | CanvasNote = {
      id,
      type: kind,
      x: clamp(snap(x - width / 2), 0, live.width - width),
      y: clamp(snap(y - height / 2), 0, live.height - height),
      width,
      height,
      text: kind === 'node' ? (live.workbench === 'flowchart' ? shape?.label ?? '流程块' : '新图形') : '备注',
      ...(shape ? { shapeRef: shape.ref } : {}),
    }
    commit({ ...live, elements: [...live.elements, element] })
    setSelectedIds([id])
    setTool('select')
  }

  function addText(x: number, y: number) {
    const live = currentScene()
    const id = nextCanvasElementId('note', live.elements)
    const width = 240
    const height = 60
    const element: CanvasNote = {
      id,
      type: 'note',
      x: clamp(snap(x - width / 2), 0, live.width - width),
      y: clamp(snap(y - height / 2), 0, live.height - height),
      width,
      height,
      text: '文字',
      textOnly: true,
      fontSize: 20,
      fontWeight: 500,
    }
    commit({ ...live, elements: [...live.elements, element] })
    setSelectedIds([id])
    setTool('select')
    window.setTimeout(() => { textInputRef.current?.focus(); textInputRef.current?.select() }, 0)
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return
    const live = currentScene()
    const mutableIds = selected.filter((item) => item.type === 'arrow' || !item.locked).map((item) => item.id)
    if (mutableIds.length === 0) return
    commit(deleteCanvasSelection(live, mutableIds))
    setSelectedIds([])
    setConnectFrom(null)
    setConnectFromAnchor('auto')
    setContextMenu(null)
  }

  function copySelection() {
    if (selectedIds.length === 0) return
    clipboard.current = copyCanvasSelection(currentScene(), selectedIds)
  }

  function pasteSelection() {
    if (clipboard.current.length === 0) return
    const pasted = pasteCanvasSelection(currentScene(), clipboard.current)
    if (pasted.selectedIds.length === 0) return
    commit(pasted.scene)
    setSelectedIds(pasted.selectedIds)
  }

  function alignSelection(axis: 'x' | 'y') {
    commitGeometry(alignCanvasSelection(currentScene(), selectedIds, axis, GRID), true, selectedIds, true)
  }

  function distributeSelection(axis: 'x' | 'y') {
    commitGeometry(distributeCanvasSelection(currentScene(), selectedIds, axis, GRID), true, selectedIds, true)
  }

  function separateSelection() {
    commitGeometry(separateCanvasSelection(currentScene(), selectedIds, 24, GRID), true, selectedIds, true)
  }

  function smartLocalLayout() {
    const seeds = selectedBoxes.map((item) => item.id)
    if (!seeds.length) return
    const live = currentScene()
    const result = layoutCanvasNeighborhood(live, seeds, 1, live.elements.length > 800 ? 28 : 42, GRID)
    if (!result.movedIds.length) return
    commitGeometry(result.scene, true, result.movedIds, true)
  }

  function reverseSelectedArrow(arrowId: string) {
    const live = currentScene()
    const source = live.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === arrowId)
    if (source?.start && source.end) {
      commit({
        ...live,
        elements: live.elements.map((item) => item.type === 'arrow' && item.id === arrowId
          ? { ...item, start: source.end, end: source.start, points: source.points ? [...source.points].reverse() : undefined }
          : item),
      })
      return
    }
    const next = reverseCanvasArrow(live, arrowId)
    commit(next.architecture ? routeArrowIds(next, [arrowId]) : next)
  }

  function rerouteSelectedArrow(arrowId: string) {
    commit(routeArrowIds(currentScene(), [arrowId]))
  }

  function insertNodeIntoArrow(arrow: CanvasArrow) {
    const live = currentScene()
    const from = live.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === arrow.from)
    const to = live.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === arrow.to)
    if (!from || !to) return
    const fromCenter = center(from)
    const toCenter = center(to)
    const start = anchorPoint(from, arrow.fromAnchor, arrow.points?.[0] ?? toCenter)
    const end = anchorPoint(to, arrow.toAnchor, arrow.points?.at(-1) ?? fromCenter)
    const midpoint = polylineMidpoint(canvasArrowRoutePoints(start, end, arrow))
    const nodeId = nextCanvasElementId('node', live.elements)
    const node: CanvasNode = {
      id: nodeId,
      type: 'node',
      x: clamp(snap(midpoint.x - 110), 0, Math.max(0, live.width - 220)),
      y: clamp(snap(midpoint.y - 48), 0, Math.max(0, live.height - 96)),
      width: 220,
      height: 96,
      text: '新节点',
      ...(from.groupId && from.groupId === to.groupId ? { groupId: from.groupId } : {}),
      ...(from.laneId && from.laneId === to.laneId ? { laneId: from.laneId } : {}),
    }
    let next = { ...live, elements: [...live.elements, node] }
    const inserted = insertCanvasNodeOnArrow(next, nodeId, arrow.id)
    next = inserted.scene
    if (next.architecture) next = routeArrowIds(next, [arrow.id, ...(inserted.newArrowId ? [inserted.newArrowId] : [])])
    commit(next)
    setSelectedIds([nodeId])
    setSelectedGroupTarget(null)
    window.setTimeout(() => { textInputRef.current?.focus(); textInputRef.current?.select() }, 0)
  }

  function groupSelection() {
    const grouped = groupCanvasSelection(currentScene(), selectedIds)
    if (!grouped.groupId) return
    commit(grouped.scene)
    setSelectedGroupTarget(grouped.groupId)
    setSelectedIds(expandCanvasGroupSelection(grouped.scene, selectedIds))
  }

  function ungroupSelection() {
    commit(ungroupCanvasSelection(currentScene(), selectedIds))
    setSelectedGroupTarget(null)
  }

  function updateSelectedGroup(patch: Partial<Omit<CanvasGroup, 'id'>>) {
    if (!selectedGroupId) return
    commit(updateCanvasGroup(currentScene(), selectedGroupId, patch))
  }

  function toggleSelectedGroupCollapsed() {
    if (!selectedGroup) return
    updateSelectedGroup({ collapsed: !selectedGroup.collapsed })
  }

  function applyC4CollapseLevel(level: CanvasC4CollapseLevel) {
    commit(setCanvasC4CollapseLevel(currentScene(), level))
    setSelectedIds([])
    setSelectedGroupTarget(null)
    setArchitectureScope(null)
    setToolbarMenu(null)
  }

  function applyLanePreset(axis: 'horizontal' | 'vertical') {
    commit(createCanvasLanePreset(currentScene(), axis, 3))
  }

  function insertArchitectureTemplate(template: CanvasArchitectureTemplate) {
    const result = insertCanvasArchitectureTemplate(currentScene(), template)
    commit(result.scene)
    setSelectedIds(result.selectedIds)
  }

  function rememberArchitectureTemplate(templateId: string) {
    setRecentTemplateIds((current) => {
      const next = [templateId, ...current.filter((id) => id !== templateId)].slice(0, TEMPLATE_RECENT_LIMIT)
      storeTemplateIds(TEMPLATE_RECENTS_STORAGE_KEY, next)
      return next
    })
  }

  function toggleArchitectureTemplateFavorite(templateId: string) {
    setFavoriteTemplateIds((current) => {
      const next = current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [templateId, ...current]
      storeTemplateIds(TEMPLATE_FAVORITES_STORAGE_KEY, next)
      return next
    })
  }

  function canvasGroupAtPoint(point: CanvasPoint): string | undefined {
    return groupBounds
      .filter((group) => !currentScene().groups?.find((candidate) => candidate.id === group.id)?.collapsed)
      .filter((group) => point.x >= group.x && point.x <= group.x + group.width && point.y >= group.y && point.y <= group.y + group.height)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0]?.id
  }

  function insertArchitectureAsset(asset: ArchitectureNodeTemplate, center?: CanvasPoint, explicitGroupId?: string) {
    const live = currentScene()
    const viewWidth = live.width / viewport.zoom
    const viewHeight = live.height / viewport.zoom
    const result = insertCanvasArchitectureNodeTemplate(live, asset, {
      x: center?.x ?? viewport.x + viewWidth / 2,
      y: center?.y ?? viewport.y + viewHeight / 2,
    }, explicitGroupId)
    commit(result.scene)
    setSelectedIds(result.selectedIds)
    setSelectedGroupTarget(null)
    rememberArchitectureTemplate(asset.id)
  }

  function beginArchitectureTemplateDrag(event: React.DragEvent<HTMLButtonElement>, asset: ArchitectureNodeTemplate) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(TEMPLATE_DRAG_MIME, asset.id)
    event.dataTransfer.setData('text/plain', asset.label)
    setArchitectureTemplateDrag({ templateId: asset.id })
  }

  function moveArchitectureTemplateDrag(event: React.DragEvent<SVGSVGElement>) {
    if (!architectureTemplateDrag) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
    const snapped = { x: snap(point.x), y: snap(point.y) }
    setArchitectureTemplateDrag((current) => current ? { ...current, point: snapped, groupId: canvasGroupAtPoint(snapped) } : current)
  }

  function dropArchitectureTemplate(event: React.DragEvent<SVGSVGElement>) {
    const templateId = event.dataTransfer.getData(TEMPLATE_DRAG_MIME) || architectureTemplateDrag?.templateId
    const asset = templateId ? architectureNodeTemplate(templateId) : undefined
    if (!asset) {
      setArchitectureTemplateDrag(null)
      return
    }
    event.preventDefault()
    const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
    const snapped = { x: snap(point.x), y: snap(point.y) }
    insertArchitectureAsset(asset, snapped, canvasGroupAtPoint(snapped))
    setArchitectureTemplateDrag(null)
  }

  function insertShape(shape: CanvasShapeDefinition, center?: CanvasPoint) {
    const live = currentScene()
    const id = nextCanvasElementId('node', live.elements)
    const viewWidth = live.width / viewport.zoom
    const viewHeight = live.height / viewport.zoom
    const point = center ?? { x: viewport.x + viewWidth / 2, y: viewport.y + viewHeight / 2 }
    const x = clamp(snap(point.x - shape.width / 2), 0, Math.max(0, live.width - shape.width))
    const y = clamp(snap(point.y - shape.height / 2), 0, Math.max(0, live.height - shape.height))
    const groupId = canvasGroupAtPoint({ x: x + shape.width / 2, y: y + shape.height / 2 })
    const node: CanvasNode = {
      id,
      type: 'node',
      x,
      y,
      width: shape.width,
      height: shape.height,
      text: live.workbench === 'flowchart' ? shape.label : '新图形',
      shapeRef: shape.ref,
      ...(groupId ? { groupId } : {}),
    }
    commit({ ...live, elements: [...live.elements, node] })
    setSelectedIds([id])
    setActiveShapeRef(shape.ref)
    setTool('select')
  }

  async function insertImageFile(file: File, center?: CanvasPoint) {
    if (!active) return
    if (!onImportImage) {
      setImageImportError('当前 Diagram Host 不支持图片资源写入。')
      return
    }
    const version = ++imageImportVersion.current
    setImageImporting(true)
    setImageImportError(null)
    try {
      const decoded = await readCanvasImageFile(file)
      if (version !== imageImportVersion.current) return
      const asset = await onImportImage({ filename: file.name || 'image', mimeType: decoded.mimeType, content: decoded.content })
      if (version !== imageImportVersion.current) return
      const live = currentScene()
      const viewWidth = live.width / viewport.zoom
      const viewHeight = live.height / viewport.zoom
      const target = center ?? { x: viewport.x + viewWidth / 2, y: viewport.y + viewHeight / 2 }
      const scale = Math.min(1, 480 / Math.max(1, decoded.width), 360 / Math.max(1, decoded.height))
      const width = Math.max(64, Math.round(decoded.width * scale))
      const height = Math.max(48, Math.round(decoded.height * scale))
      const x = clamp(snap(target.x - width / 2), 0, Math.max(0, live.width - width))
      const y = clamp(snap(target.y - height / 2), 0, Math.max(0, live.height - height))
      const id = nextCanvasElementId('note', live.elements)
      const element: CanvasNote = {
        id,
        type: 'note',
        x,
        y,
        width,
        height,
        text: file.name || '图片',
        imagePath: asset.path,
        imageFit: 'contain',
        cornerRadius: 8,
      }
      setImageSources((current) => ({ ...current, [asset.path]: decoded.dataUrl }))
      commit({ ...live, elements: [...live.elements, element] })
      setSelectedIds([id])
      setTool('select')
    } catch (error) {
      if (version === imageImportVersion.current) setImageImportError(error instanceof Error ? error.message : String(error))
    } finally {
      if (version === imageImportVersion.current) setImageImporting(false)
    }
  }

  function handleEditorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (architectureWorkbench) return
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const file = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .find((item): item is File => Boolean(item && CANVAS_IMAGE_MIME_TYPES.has(item.type)))
    if (!file) return
    event.preventDefault()
    void insertImageFile(file)
  }

  function beginShapeDrag(event: React.DragEvent<HTMLButtonElement>, shape: CanvasShapeDefinition) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(SHAPE_DRAG_MIME, shape.ref)
    event.dataTransfer.setData('text/plain', shape.label)
    setShapeDrag({ shapeRef: shape.ref })
  }

  function moveExternalDrag(event: React.DragEvent<SVGSVGElement>) {
    if (!architectureWorkbench && event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      return
    }
    if (architectureTemplateDrag) {
      moveArchitectureTemplateDrag(event)
      return
    }
    if (!shapeDrag) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
    setShapeDrag((current) => current ? { ...current, point: { x: snap(point.x), y: snap(point.y) } } : current)
  }

  async function dropExternalDrag(event: React.DragEvent<SVGSVGElement>) {
    if (!architectureWorkbench && event.dataTransfer.files.length) {
      const file = [...event.dataTransfer.files].find((candidate) => CANVAS_IMAGE_MIME_TYPES.has(candidate.type))
      if (file) {
        event.preventDefault()
        const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
        await insertImageFile(file, { x: snap(point.x), y: snap(point.y) })
        return
      }
    }
    if (architectureTemplateDrag || event.dataTransfer.getData(TEMPLATE_DRAG_MIME)) {
      dropArchitectureTemplate(event)
      return
    }
    const ref = event.dataTransfer.getData(SHAPE_DRAG_MIME) || shapeDrag?.shapeRef
    if (!isCanvasShapeRef(ref)) {
      setShapeDrag(null)
      return
    }
    const shape = canvasShapeDefinition(ref)
    event.preventDefault()
    const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
    insertShape(shape, { x: snap(point.x), y: snap(point.y) })
    setShapeDrag(null)
  }

  function removeLanes() {
    commit(clearCanvasLanes(currentScene()))
  }

  function assignSelectionLane(laneId?: string) {
    commit(assignCanvasSelectionToLane(currentScene(), selectedIds, laneId))
  }

  function applyLayout(mode: CanvasLayoutMode) {
    commitGeometry(layoutCanvasScene(currentScene(), mode, GRID), true, undefined, true)
  }

  function applyLocalLayout(mode: CanvasLayoutMode) {
    const ids = selectedGroupId
      ? groupBounds.find((group) => group.id === selectedGroupId)?.memberIds ?? selectedIds
      : selectedIds
    if (ids.length < 2) return
    commitGeometry(layoutCanvasSelection(currentScene(), ids, mode, GRID), true, ids, true)
  }

  function selectGroup(groupId: string) {
    const frame = groupBounds.find((group) => group.id === groupId)
    if (!frame) return
    setSelectedGroupTarget(groupId)
    setSelectedIds(frame.memberIds)
    focusBoxes(frame.memberIds)
  }

  function focusBoxes(ids: string[]) {
    const live = currentScene()
    const targets = live.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && ids.includes(item.id))
    if (!targets.length) return
    const left = Math.min(...targets.map((item) => item.x))
    const top = Math.min(...targets.map((item) => item.y))
    const right = Math.max(...targets.map((item) => item.x + item.width))
    const bottom = Math.max(...targets.map((item) => item.y + item.height))
    const width = Math.max(280, right - left + 200)
    const height = Math.max(180, bottom - top + 160)
    const zoom = clamp(Math.min(live.width / width, live.height / height), 0.8, 2.6)
    const viewWidth = live.width / zoom
    const viewHeight = live.height / zoom
    setViewport({
      zoom,
      x: clamp((left + right) / 2 - viewWidth / 2, 0, Math.max(0, live.width - viewWidth)),
      y: clamp((top + bottom) / 2 - viewHeight / 2, 0, Math.max(0, live.height - viewHeight)),
    })
  }

  function enterArchitectureScope(scope: CanvasArchitectureScope) {
    const projected = canvasArchitectureScopeProjection(currentScene(), scope)
    setArchitectureScope(scope)
    setSelectedGroupTarget(null)
    setSelectedIds(scope.kind === 'node' ? [scope.id] : [])
    setTraceDirection(null)
    focusArchitectureScene(projected.scene)
  }

  function leaveArchitectureScope() {
    setArchitectureScope(null)
    setSelectedGroupTarget(null)
    setSelectedIds([])
    setViewport({ x: 0, y: 0, zoom: 1 })
  }

  function focusArchitectureScene(projected: CanvasScene) {
    const collapsed = canvasCollapsedOwners(projected)
    const boxes = projected.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && !collapsed.has(item.id))
    const collapsedFrames = canvasGroupFrames(projected).filter((group) => group.collapsed)
    const rects = [
      ...boxes.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
      ...collapsedFrames.map((group) => ({ x: group.x, y: group.y, width: group.width, height: group.height })),
    ]
    if (!rects.length) {
      setViewport({ x: 0, y: 0, zoom: 1 })
      return
    }
    const left = Math.min(...rects.map((item) => item.x))
    const top = Math.min(...rects.map((item) => item.y))
    const right = Math.max(...rects.map((item) => item.x + item.width))
    const bottom = Math.max(...rects.map((item) => item.y + item.height))
    const width = Math.max(360, right - left + 220)
    const height = Math.max(240, bottom - top + 190)
    const live = currentScene()
    const zoom = clamp(Math.min(live.width / width, live.height / height), 0.65, 2.3)
    const viewWidth = live.width / zoom
    const viewHeight = live.height / zoom
    setViewport({
      zoom,
      x: clamp((left + right) / 2 - viewWidth / 2, 0, Math.max(0, live.width - viewWidth)),
      y: clamp((top + bottom) / 2 - viewHeight / 2, 0, Math.max(0, live.height - viewHeight)),
    })
  }

  function revealAndFocus(ids: string[]) {
    const live = currentScene()
    const groups = new Map((live.groups ?? []).map((group) => [group.id, group]))
    const expand = new Set<string>()
    live.elements.forEach((item) => {
      if (item.type === 'arrow' || !ids.includes(item.id) || !item.groupId) return
      let groupId: string | undefined = item.groupId
      const seen = new Set<string>()
      while (groupId && !seen.has(groupId)) {
        seen.add(groupId)
        const group = groups.get(groupId)
        if (!group) break
        if (group.collapsed) expand.add(group.id)
        groupId = group.parentId
      }
    })
    if (expand.size) {
      commit({
        ...live,
        groups: live.groups?.map((group) => expand.has(group.id) ? { ...group, collapsed: undefined } : group),
      })
    }
    setSelectedGroupTarget(null)
    setSelectedIds(ids)
    focusBoxes(ids)
  }

  function reorderSelection(direction: 'front' | 'back' | 'forward' | 'backward') {
    commit(reorderCanvasSelection(currentScene(), selectedIds, direction))
    setContextMenu(null)
  }

  function toggleSelectionLock() {
    if (selectedBoxes.length === 0) return
    const shouldLock = selectedLocked.length !== selectedBoxes.length
    const ids = new Set(selectedBoxes.map((item) => item.id))
    const live = currentScene()
    commit({
      ...live,
      elements: live.elements.map((item) => item.type !== 'arrow' && ids.has(item.id) ? { ...item, locked: shouldLock || undefined } : item),
    })
    setContextMenu(null)
  }

  function updateSelectedBoxes(updater: (item: CanvasNode | CanvasNote) => CanvasNode | CanvasNote) {
    if (selectedBoxes.length === 0) return
    const ids = new Set(selectedBoxes.filter((item) => !item.locked).map((item) => item.id))
    if (ids.size === 0) return
    const live = currentScene()
    commit({ ...live, elements: live.elements.map((item) => item.type !== 'arrow' && ids.has(item.id) ? updater(item) : item) })
  }

  function openContextMenu(event: React.MouseEvent, id: string) {
    event.preventDefault()
    event.stopPropagation()
    editorRef.current?.focus({ preventScroll: true })
    setToolbarMenu(null)
    setInspectorMenuOpen(false)
    setSelectedGroupTarget(null)
    if (!selectedIds.includes(id)) setSelectedIds([id])
    const surface = editorRef.current?.getBoundingClientRect()
    setContextMenu({ x: event.clientX - (surface?.left ?? 0), y: event.clientY - (surface?.top ?? 0) })
  }

  function handleBoxClick(id: string, event: React.MouseEvent<SVGGElement>) {
    setToolbarMenu(null)
    setInspectorMenuOpen(false)
    setSelectedGroupTarget(null)
    if (tool === 'connect') {
      if (!connectFrom) {
        setConnectFrom(id)
        setSelectedIds([id])
        return
      }
      if (connectFrom === id) {
        setConnectFrom(null)
        return
      }
      const live = currentScene()
      const exists = live.elements.some((item) => item.type === 'arrow' && item.from === connectFrom && item.to === id)
      if (!exists) {
        const arrowId = nextCanvasElementId('arrow', live.elements)
        let next: CanvasScene = { ...live, elements: [...live.elements, { id: arrowId, type: 'arrow', from: connectFrom, to: id, ...(connectFromAnchor !== 'auto' ? { fromAnchor: connectFromAnchor } : {}) }] }
        if (next.architecture) next = routeArrowIds(next, [arrowId])
        commit(next)
      }
      setConnectFrom(null)
      setConnectPreviewPoint(null)
      setConnectFromAnchor('auto')
      setSelectedIds([id])
      setTool('select')
      return
    }
    if (tool !== 'select') return
  }

  function handleAnchorClick(event: React.MouseEvent<SVGCircleElement>, id: string, anchor: Exclude<CanvasAnchor, 'auto'>) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedGroupTarget(null)
    const live = currentScene()
    if (!connectFrom) {
      setConnectFrom(id)
      setConnectFromAnchor(anchor)
      setSelectedIds([id])
      setTool('connect')
      return
    }
    if (connectFrom === id) {
      setConnectFromAnchor(anchor)
      return
    }
    const exists = live.elements.some((item) => item.type === 'arrow' && item.from === connectFrom && item.to === id)
    if (!exists) {
      const arrowId = nextCanvasElementId('arrow', live.elements)
      let next: CanvasScene = {
        ...live,
        elements: [...live.elements, {
          id: arrowId,
          type: 'arrow',
          from: connectFrom,
          to: id,
          ...(connectFromAnchor !== 'auto' ? { fromAnchor: connectFromAnchor } : {}),
          toAnchor: anchor,
        }],
      }
      if (next.architecture) next = routeArrowIds(next, [arrowId])
      commit(next)
    }
    setConnectFrom(null)
    setConnectPreviewPoint(null)
    setConnectFromAnchor('auto')
    setSelectedIds([id])
    setTool('select')
  }

  function completeConnectionOnBlank(point: CanvasPoint) {
    if (!connectFrom) return false
    const live = currentScene()
    const sourceNode = live.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === connectFrom)
    if (!sourceNode) return false
    const nodeId = nextCanvasElementId('node', live.elements)
    const node: CanvasNode = {
      id: nodeId,
      type: 'node',
      x: clamp(snap(point.x - 110), 0, Math.max(0, live.width - 220)),
      y: clamp(snap(point.y - 48), 0, Math.max(0, live.height - 96)),
      width: 220,
      height: 96,
      text: '新节点',
      ...(sourceNode.groupId ? { groupId: sourceNode.groupId } : {}),
      ...(sourceNode.laneId ? { laneId: sourceNode.laneId } : {}),
    }
    const arrow: CanvasArrow = {
      id: nextCanvasElementId('arrow', [...live.elements, node]),
      type: 'arrow',
      from: connectFrom,
      to: nodeId,
      ...(connectFromAnchor !== 'auto' ? { fromAnchor: connectFromAnchor } : {}),
    }
    let next: CanvasScene = { ...live, elements: [...live.elements, node, arrow] }
    if (next.architecture) next = routeArrowIds(next, [arrow.id])
    commit(next)
    setConnectFrom(null)
    setConnectPreviewPoint(null)
    setConnectFromAnchor('auto')
    setSelectedIds([nodeId])
    setTool('select')
    window.setTimeout(() => { textInputRef.current?.focus(); textInputRef.current?.select() }, 0)
    return true
  }

  function startMove(event: React.PointerEvent<SVGGElement>, item: CanvasNode | CanvasNote) {
    if (tool !== 'select' || spacePanning) return
    moveStartedWithInspector.current = selected.length > 0 && !inspectorCollapsed
    event.stopPropagation()
    setSelectedGroupTarget(null)
    setContextMenu(null)
    editorRef.current?.focus({ preventScroll: true })
    const live = currentScene()
    let ids = selectedIds
    const groupIds = !event.altKey && item.groupId
      ? currentScene().elements.filter((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && candidate.groupId === item.groupId).map((candidate) => candidate.id)
      : [item.id]
    if (event.shiftKey && ids.includes(item.id)) {
      const removing = new Set(groupIds)
      setSelectedIds(ids.filter((id) => !removing.has(id)))
      return
    }
    if (!ids.includes(item.id)) {
      ids = event.shiftKey ? [...new Set([...ids, ...groupIds])] : groupIds
      setSelectedIds(ids)
    } else if (!event.altKey && item.groupId) {
      ids = [...new Set([...ids, ...groupIds])]
      setSelectedIds(ids)
    }
    if (item.locked) return
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const positions = new Map<string, { x: number; y: number }>()
    live.elements.forEach((candidate) => {
      if (candidate.type !== 'arrow' && ids.includes(candidate.id) && !candidate.locked) positions.set(candidate.id, { x: candidate.x, y: candidate.y })
    })
    if (positions.size === 0) return
    moveLabels.current = semanticLodLevel === 'detail' && largeSceneViewportCulling && renderArrows.length > 1000
      ? { scene: renderSceneBase, viewport, arrowIds: viewportRenderArrows.map((arrow) => arrow.id), labels: relationLabelLayouts }
      : null
    drag.current = { kind: 'move', pointerId: event.pointerId, startX: point.x, startY: point.y, before: sourceRef.current, positions }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveSelection(event: React.PointerEvent<SVGGElement>, item: CanvasNode | CanvasNote) {
    const active = drag.current
    if (!active || active.kind !== 'move' || active.pointerId !== event.pointerId || !active.positions.has(item.id)) return
    const live = currentScene()
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const rawDx = point.x - active.startX
    const rawDy = point.y - active.startY
    const movingIds = new Set(active.positions.keys())
    const moving = live.elements.filter((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && movingIds.has(candidate.id))
    const others = live.elements.filter((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow' && !movingIds.has(candidate.id))
    const referenceOrigin = active.positions.values().next().value as { x: number; y: number } | undefined
    let dx = event.altKey || !referenceOrigin ? rawDx : snap(referenceOrigin.x + rawDx) - referenceOrigin.x
    let dy = event.altKey || !referenceOrigin ? rawDy : snap(referenceOrigin.y + rawDy) - referenceOrigin.y
    let guides: SnapGuides = {}
    if (!event.altKey && moving.length) {
      const originRects = moving.map((candidate) => {
        const origin = active.positions.get(candidate.id)!
        return { x: origin.x, y: origin.y, width: candidate.width, height: candidate.height }
      })
      const originLeft = Math.min(...originRects.map((rect) => rect.x))
      const originTop = Math.min(...originRects.map((rect) => rect.y))
      const originRight = Math.max(...originRects.map((rect) => rect.x + rect.width))
      const originBottom = Math.max(...originRects.map((rect) => rect.y + rect.height))
      const proposed = {
        x: originLeft + dx,
        y: originTop + dy,
        width: originRight - originLeft,
        height: originBottom - originTop,
      }
      const threshold = Math.max(4, 8 / Math.max(viewport.zoom, 0.5))
      const snapFrames = groupBounds.filter((frame) => !frame.memberIds.some((id) => movingIds.has(id)))
      const extraXTargets = [live.width / 2, ...snapFrames.flatMap((frame) => [frame.x, frame.x + frame.width])]
      const extraYTargets = [live.height / 2, ...snapFrames.flatMap((frame) => [frame.y, frame.y + frame.height])]
      for (const lane of live.lanes ?? []) {
        if (lane.axis === 'vertical') extraXTargets.push(lane.start, lane.start + lane.size)
        else extraYTargets.push(lane.start, lane.start + lane.size)
      }
      const smartSnap = computeCanvasSmartSnap(proposed, others, threshold, extraXTargets, extraYTargets)
      dx += smartSnap.delta.x
      dy += smartSnap.delta.y
      guides = {
        ...(smartSnap.xGuide !== undefined ? { x: smartSnap.xGuide } : {}),
        ...(smartSnap.yGuide !== undefined ? { y: smartSnap.yGuide } : {}),
        ...(smartSnap.spacingGuides.length ? { spacing: smartSnap.spacingGuides } : {}),
      }
      if (moving.length === 1 && (smartSnap.sameWidth || smartSnap.sameHeight)) {
        const origin = active.positions.get(moving[0].id)!
        guides.sizeLabel = smartSnap.sameWidth && smartSnap.sameHeight ? '同宽 · 同高' : smartSnap.sameWidth ? '同宽' : '同高'
        guides.sizePoint = { x: origin.x + dx + moving[0].width, y: origin.y + dy - 12 }
      }
    }
    let insertCandidate: InsertTarget | null = null
    if (active.positions.size === 1) {
      const movingItem = moving[0]
      const origin = movingItem ? active.positions.get(movingItem.id) : undefined
      const candidateCenter = movingItem && origin
        ? { x: origin.x + dx + movingItem.width / 2, y: origin.y + dy + movingItem.height / 2 }
        : undefined
      insertCandidate = candidateCenter
        ? nearestArrowTarget(live, candidateCenter, movingIds, Math.max(12, 22 / Math.max(viewport.zoom, 0.5)))
        : null
    }
    const overrides: Record<string, CanvasPoint> = {}
    for (const candidate of moving) {
      const origin = active.positions.get(candidate.id)
      if (!origin) continue
      overrides[candidate.id] = {
        x: clamp(origin.x + dx, 0, live.width - candidate.width),
        y: clamp(origin.y + dy, 0, live.height - candidate.height),
      }
    }
    if (!event.altKey && !insertCandidate && boxes.length <= 260) {
      const previewScene: CanvasScene = {
        ...live,
        elements: live.elements.map((candidate) => {
          if (candidate.type === 'arrow') return candidate
          const position = overrides[candidate.id]
          return position ? { ...candidate, x: position.x, y: position.y } : candidate
        }),
      }
      const reflow = reflowCanvasNeighborhood(previewScene, movingIds, 24, GRID, 32)
      if (reflow.movedIds.length) {
        const reflowById = new Map(reflow.scene.elements.filter((candidate): candidate is CanvasNode | CanvasNote => candidate.type !== 'arrow').map((candidate) => [candidate.id, candidate]))
        reflow.movedIds.forEach((id) => {
          const candidate = reflowById.get(id)
          if (candidate) overrides[id] = { x: candidate.x, y: candidate.y }
        })
      }
    }
    gesturePositionOverridesRef.current = overrides
    insertTargetRef.current = insertCandidate
    scheduleGestureVisual({ positions: overrides, guides, insertTarget: insertCandidate })
  }

  function finishGesture(event: React.PointerEvent) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (active.kind === 'freehand-draw') {
      const points = freehandDraftRef.current?.points ?? []
      if (points.length >= 2) {
        const start = points[0]
        const end = points.at(-1)!
        if (Math.hypot(end.x - start.x, end.y - start.y) >= 6 || points.length >= 4) {
          const live = currentScene()
          const id = nextCanvasElementId('arrow', live.elements)
          const arrow: CanvasArrow = {
            id,
            type: 'arrow',
            from: '',
            to: '',
            start,
            end,
            points: points.slice(1, -1),
            markerEnd: 'none',
            strokeWidth: 2,
            freehand: true,
          }
          commit({ ...live, elements: [...live.elements, arrow] })
          setSelectedIds([id])
        }
      }
      freehandDraftRef.current = null
      setFreehandDraft(null)
      setTool('select')
    } else if (active.kind === 'line-draw') {
      const draft = lineDraftRef.current
      if (draft && Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) >= 8) {
        const live = currentScene()
        const id = nextCanvasElementId('arrow', live.elements)
        const arrow: CanvasArrow = {
          id,
          type: 'arrow',
          from: '',
          to: '',
          start: draft.start,
          end: draft.end,
          routing: 'straight',
          markerEnd: active.markerEnd,
        }
        commit({ ...live, elements: [...live.elements, arrow] })
        setSelectedIds([id])
      }
      lineDraftRef.current = null
      setLineDraft(null)
      setTool('select')
    } else if (active.kind === 'move') {
      moveLabels.current = null
      let next = currentScene()
      const changedNodeIds = new Set<string>(active.positions.keys())
      const overrides = gesturePositionOverridesRef.current
      if (overrides) Object.keys(overrides).forEach((id) => changedNodeIds.add(id))
      if (overrides) {
        next = {
          ...next,
          elements: next.elements.map((item) => {
            if (item.type === 'arrow') return item
            const position = overrides[item.id]
            return position ? { ...item, x: position.x, y: position.y } : item
          }),
        }
      }
      const dropTarget = insertTargetRef.current
      if (dropTarget && active.positions.size === 1) {
        const nodeId = active.positions.keys().next().value as string | undefined
        if (nodeId) next = insertCanvasNodeOnArrow(next, nodeId, dropTarget.arrowId).scene
      }
      const geometryChanged = Boolean(overrides || dropTarget)
      if (!event.altKey && overrides) {
        const reflow = reflowCanvasNeighborhood(next, changedNodeIds, 24, GRID, next.elements.length > 800 ? 24 : 48)
        next = reflow.scene
        reflow.movedIds.forEach((id) => changedNodeIds.add(id))
      }
      if (geometryChanged && next.architecture) next = routeArchitectureEdgesIncremental(next, changedNodeIds)
      if (geometryChanged) commit(next, false)
      recordGesture(active.before)
      clearGestureVisual()
    } else if (active.kind === 'resize' || active.kind === 'multi-resize' || active.kind === 'rotate') {
      const drafts = transformDraftsRef.current
      if (drafts) {
        const changedIds = Object.keys(drafts)
        let next: CanvasScene = {
          ...currentScene(),
          elements: currentScene().elements.map((item) => {
            if (item.type === 'arrow') return item
            const draft = drafts[item.id]
            return draft ? { ...item, x: draft.x, y: draft.y, width: draft.width, height: draft.height, rotation: draft.rotation } : item
          }),
        }
        if (next.architecture) next = routeArchitectureEdgesIncremental(next, changedIds)
        commit(next, false)
        recordGesture(active.before)
      }
      clearGeometryDrafts()
      setSnapGuides({})
    } else if (active.kind === 'arrow-point') {
      const draft = arrowPointDraftRef.current
      if (draft) {
        const next: CanvasScene = {
          ...currentScene(),
          elements: currentScene().elements.map((item) => item.type === 'arrow' && item.id === draft.id ? { ...item, points: draft.points, bundleKey: undefined } : item),
        }
        commit(next, false)
        recordGesture(active.before)
      }
      clearGeometryDrafts()
    } else if (active.kind === 'arrow-label') {
      const draft = arrowLabelDraftRef.current
      if (draft) {
        const next: CanvasScene = {
          ...currentScene(),
          elements: currentScene().elements.map((item) => item.type === 'arrow' && item.id === draft.id ? { ...item, labelPosition: draft.position } : item),
        }
        commit(next, false)
        recordGesture(active.before)
      }
      clearGeometryDrafts()
    }
    else if (active.kind === 'arrow-endpoint') {
      const preview = arrowEndpointPreviewRef.current
      const source = currentScene().elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === active.id)
      if (source?.start && source.end && preview) {
        const endpointPoint = preview.targetId
          ? preview.point
          : event.altKey
            ? preview.point
            : { x: snap(preview.point.x), y: snap(preview.point.y) }
        const next: CanvasScene = {
          ...currentScene(),
          elements: currentScene().elements.map((item) => item.type === 'arrow' && item.id === active.id
            ? { ...item, [active.endpoint === 'from' ? 'start' : 'end']: endpointPoint, points: undefined }
            : item),
        }
        commit(next, false)
        recordGesture(active.before)
      } else if (preview?.targetId && preview.targetAnchor) {
        let next = reconnectCanvasArrow(currentScene(), active.id, active.endpoint, preview.targetId, preview.targetAnchor)
        if (next.architecture) next = routeArrowIds(next, [active.id])
        commit(next, false)
        recordGesture(active.before)
      }
      arrowEndpointPreviewRef.current = null
      setArrowEndpointPreview(null)
    }
    if (active.kind === 'marquee' && selectionRect) {
      const rect = normalizeRect(selectionRect)
      const live = currentScene()
      setSelectedIds(live.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && intersects(rect, item)).map((item) => item.id))
      setSelectionRect(null)
    }
    drag.current = null
  }

  function cancelGesture() {
    moveLabels.current = null
    const active = drag.current
    if (!active) {
      clearGestureVisual()
      clearGeometryDrafts()
      arrowEndpointPreviewRef.current = null
      setArrowEndpointPreview(null)
      setSelectionRect(null)
      return
    }
    if (active.kind === 'line-draw') {
      lineDraftRef.current = null
      setLineDraft(null)
    }
    if (active.kind === 'freehand-draw') {
      freehandDraftRef.current = null
      setFreehandDraft(null)
    }
    if (active.kind === 'move') clearGestureVisual()
    if (active.kind === 'resize' || active.kind === 'multi-resize' || active.kind === 'rotate' || active.kind === 'arrow-point' || active.kind === 'arrow-label') clearGeometryDrafts()
    if (active.kind === 'resize' || active.kind === 'multi-resize' || active.kind === 'rotate') setSnapGuides({})
    if (active.kind === 'arrow-endpoint') {
      arrowEndpointPreviewRef.current = null
      setArrowEndpointPreview(null)
    }
    if (active.kind === 'marquee') setSelectionRect(null)
    drag.current = null
  }

  function beginBackgroundPointer(event: React.PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return
    setContextMenu(null)
    setToolbarMenu(null)
    setInspectorMenuOpen(false)
    editorRef.current?.focus({ preventScroll: true })
    const live = currentScene()
    const point = scenePoint(event.clientX, event.clientY, event.currentTarget, live, viewport)
    const shouldPan = tool === 'hand' || spacePanning || event.button === 1
    if (shouldPan) {
      drag.current = { kind: 'pan', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: viewport }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'line' || tool === 'arrow') {
      const anchor = event.altKey ? null : nearestNodeAnchor(live, point, new Set(), Math.max(14, 24 / Math.max(viewport.zoom, 0.5)))
      const snapped = anchor?.point ?? (event.altKey ? point : { x: snap(point.x), y: snap(point.y) })
      const draft = { start: snapped, end: snapped, markerEnd: tool === 'arrow' ? 'arrow' as const : 'none' as const }
      lineDraftRef.current = draft
      setLineDraft(draft)
      drag.current = { kind: 'line-draw', pointerId: event.pointerId, markerEnd: draft.markerEnd }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'pen') {
      const draft = { points: [point] }
      freehandDraftRef.current = draft
      setFreehandDraft(draft)
      drag.current = { kind: 'freehand-draw', pointerId: event.pointerId }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (tool === 'select') {
      if (!event.shiftKey) setSelectedIds([])
      drag.current = { kind: 'marquee', pointerId: event.pointerId, startX: point.x, startY: point.y }
      setSelectionRect({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function moveBackgroundPointer(event: React.PointerEvent<SVGSVGElement>) {
    const active = drag.current
    if (!active && connectFrom) {
      setConnectPreviewPoint(scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport))
      return
    }
    if (!active || active.pointerId !== event.pointerId) return
    const live = currentScene()
    if (active.kind === 'line-draw') {
      const point = scenePoint(event.clientX, event.clientY, event.currentTarget, live, viewport)
      const start = lineDraftRef.current?.start
      if (!start) return
      const anchor = event.altKey ? null : nearestNodeAnchor(live, point, new Set(), Math.max(14, 24 / Math.max(viewport.zoom, 0.5)))
      let end = anchor?.point ?? (event.altKey ? point : { x: snap(point.x), y: snap(point.y) })
      if (event.shiftKey) {
        if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) end = { x: end.x, y: start.y }
        else end = { x: start.x, y: end.y }
      }
      const draft = { start, end, markerEnd: active.markerEnd }
      lineDraftRef.current = draft
      setLineDraft(draft)
      return
    }
    if (active.kind === 'freehand-draw') {
      const point = scenePoint(event.clientX, event.clientY, event.currentTarget, live, viewport)
      const current = freehandDraftRef.current?.points ?? []
      const previous = current.at(-1)
      const minDistance = Math.max(1.5, 4 / Math.max(viewport.zoom, 0.5))
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minDistance) return
      const points = current.length < 480 ? [...current, point] : [...current.slice(0, -1), point]
      const draft = { points }
      freehandDraftRef.current = draft
      setFreehandDraft(draft)
      return
    }
    if (active.kind === 'pan') {
      const bounds = event.currentTarget.getBoundingClientRect()
      const worldPerPixelX = (live.width / active.start.zoom) / Math.max(1, bounds.width)
      const worldPerPixelY = (live.height / active.start.zoom) / Math.max(1, bounds.height)
      setViewport({
        ...active.start,
        x: active.start.x - (event.clientX - active.clientX) * worldPerPixelX,
        y: active.start.y - (event.clientY - active.clientY) * worldPerPixelY,
      })
      return
    }
    if (active.kind === 'marquee') {
      const point = scenePoint(event.clientX, event.clientY, event.currentTarget, live, viewport)
      setSelectionRect({ x1: active.startX, y1: active.startY, x2: point.x, y2: point.y })
    }
  }

  function beginResize(event: React.PointerEvent<SVGElement>, item: CanvasNode | CanvasNote, handle: CanvasResizeHandle) {
    if (item.locked) return
    event.stopPropagation()
    const box: CanvasTransformBox = { x: item.x, y: item.y, width: item.width, height: item.height, ...(item.rotation ? { rotation: item.rotation } : {}) }
    drag.current = { kind: 'resize', pointerId: event.pointerId, id: item.id, handle, box, before: sourceRef.current }
    transformDraftsRef.current = { [item.id]: box }
    setTransformDrafts({ [item.id]: box })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: React.PointerEvent<SVGElement>) {
    const active = drag.current
    if (!active || (active.kind !== 'resize' && active.kind !== 'multi-resize') || active.pointerId !== event.pointerId) return
    const live = currentScene()
    const rawPoint = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const rotatedSingle = active.kind === 'resize' && Boolean(active.box.rotation)
    const point = event.altKey || rotatedSingle ? rawPoint : { x: snap(rawPoint.x), y: snap(rawPoint.y) }
    if (active.kind === 'multi-resize') {
      const drafts = scaleCanvasTransformBoxes(active.boxes, active.bounds, active.handle, point, { center: event.altKey, preserveAspect: event.shiftKey })
      transformDraftsRef.current = Object.fromEntries(drafts)
      setSnapGuides({})
      scheduleGeometryDraftRender()
      return
    }
    let draft = resizeCanvasTransformBox(active.box, active.handle, point, { center: event.altKey, preserveAspect: event.shiftKey })
    let sameWidth = false
    let sameHeight = false
    if (!event.altKey && !event.shiftKey && !active.box.rotation) {
      const others = live.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id !== active.id)
      const threshold = Math.max(4, 8 / Math.max(viewport.zoom, 0.5))
      const widthTarget = nearestValue(draft.width, others.map((item) => item.width), threshold)
      const heightTarget = nearestValue(draft.height, others.map((item) => item.height), threshold)
      if (widthTarget !== undefined) {
        const delta = widthTarget - draft.width
        draft = { ...draft, width: widthTarget, x: active.handle.includes('w') ? draft.x - delta : draft.x }
        sameWidth = true
      }
      if (heightTarget !== undefined) {
        const delta = heightTarget - draft.height
        draft = { ...draft, height: heightTarget, y: active.handle.includes('n') ? draft.y - delta : draft.y }
        sameHeight = true
      }
    }
    setSnapGuides(sameWidth || sameHeight ? {
      sizeLabel: sameWidth && sameHeight ? '同宽 · 同高' : sameWidth ? '同宽' : '同高',
      sizePoint: { x: draft.x + draft.width, y: draft.y - 12 },
    } : {})
    transformDraftsRef.current = { [active.id]: draft }
    scheduleGeometryDraftRender()
  }

  function beginMultiResize(event: React.PointerEvent<SVGElement>, handle: CanvasResizeHandle) {
    if (architectureWorkbench || selectedBoxes.length < 2 || selectedBoxes.some((item) => item.locked)) return
    event.stopPropagation()
    const boxes = new Map(selectedBoxes.map((item) => [item.id, { x: item.x, y: item.y, width: item.width, height: item.height, ...(item.rotation ? { rotation: item.rotation } : {}) } satisfies CanvasTransformBox]))
    const bounds = canvasBoxesBounds([...boxes.values()])
    drag.current = { kind: 'multi-resize', pointerId: event.pointerId, handle, bounds, boxes, before: sourceRef.current }
    transformDraftsRef.current = Object.fromEntries(boxes)
    setTransformDrafts(Object.fromEntries(boxes))
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function beginRotate(event: React.PointerEvent<SVGElement>, item: CanvasNode | CanvasNote) {
    if (architectureWorkbench || item.locked) return
    event.stopPropagation()
    const live = currentScene()
    const start = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const center = { x: item.x + item.width / 2, y: item.y + item.height / 2 }
    drag.current = { kind: 'rotate', pointerId: event.pointerId, id: item.id, center, start, initialRotation: item.rotation ?? 0, before: sourceRef.current }
    const draft: CanvasTransformBox = { x: item.x, y: item.y, width: item.width, height: item.height, ...(item.rotation ? { rotation: item.rotation } : {}) }
    transformDraftsRef.current = { [item.id]: draft }
    setTransformDrafts({ [item.id]: draft })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveRotate(event: React.PointerEvent<SVGElement>) {
    const active = drag.current
    if (!active || active.kind !== 'rotate' || active.pointerId !== event.pointerId) return
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, currentScene(), viewport)
    const rotation = canvasRotationFromPointer(active.center, active.start, point, active.initialRotation, event.shiftKey ? 15 : 1)
    const source = currentScene().elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === active.id)
    if (!source) return
    const draft: CanvasTransformBox = { x: source.x, y: source.y, width: source.width, height: source.height, ...(rotation ? { rotation } : {}) }
    transformDraftsRef.current = { [active.id]: draft }
    setSnapGuides({ sizeLabel: `${Math.round(rotation)}°`, sizePoint: { x: source.x + source.width / 2, y: source.y - 34 } })
    scheduleGeometryDraftRender()
  }

  function beginArrowPointDrag(event: React.PointerEvent<SVGCircleElement>, arrow: CanvasArrow, index: number) {
    event.stopPropagation()
    drag.current = { kind: 'arrow-point', pointerId: event.pointerId, id: arrow.id, index, before: sourceRef.current }
    const draft = { id: arrow.id, points: [...(arrow.points ?? [])] }
    arrowPointDraftRef.current = draft
    setArrowPointDraft(draft)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveArrowPoint(event: React.PointerEvent<SVGCircleElement>) {
    const active = drag.current
    if (!active || active.kind !== 'arrow-point' || active.pointerId !== event.pointerId) return
    const live = currentScene()
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const source = live.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === active.id)
    if (!source) return
    const points = [...(source.points ?? [])]
    points[active.index] = { x: snap(point.x), y: snap(point.y) }
    const draft = { id: active.id, points }
    arrowPointDraftRef.current = draft
    scheduleGeometryDraftRender()
  }

  function beginArrowEndpointDrag(event: React.PointerEvent<SVGCircleElement>, arrow: CanvasArrow, endpoint: 'from' | 'to', fixedPoint: CanvasPoint, point: CanvasPoint) {
    event.stopPropagation()
    setSelectedIds([arrow.id])
    const preview = { id: arrow.id, endpoint, fixedPoint, point }
    arrowEndpointPreviewRef.current = preview
    setArrowEndpointPreview(preview)
    drag.current = { kind: 'arrow-endpoint', pointerId: event.pointerId, id: arrow.id, endpoint, before: sourceRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveArrowEndpoint(event: React.PointerEvent<SVGCircleElement>) {
    const active = drag.current
    if (!active || active.kind !== 'arrow-endpoint' || active.pointerId !== event.pointerId) return
    const live = currentScene()
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, live, viewport)
    const arrow = live.elements.find((item): item is CanvasArrow => item.type === 'arrow' && item.id === active.id)
    const currentPreview = arrowEndpointPreviewRef.current
    if (!arrow || !currentPreview) return
    if (arrow.start && arrow.end) {
      const target = event.altKey ? null : nearestNodeAnchor(live, point, new Set(), Math.max(18, 30 / Math.max(viewport.zoom, 0.5)))
      const nextPreview = {
        ...currentPreview,
        point: target?.point ?? (event.altKey ? point : { x: snap(point.x), y: snap(point.y) }),
        ...(target ? { targetId: target.nodeId, targetAnchor: target.anchor } : { targetId: undefined, targetAnchor: undefined }),
      }
      arrowEndpointPreviewRef.current = nextPreview
      setArrowEndpointPreview(nextPreview)
      return
    }
    const excluded = new Set([active.endpoint === 'from' ? arrow.to : arrow.from])
    const target = event.altKey ? null : nearestNodeAnchor(live, point, excluded, Math.max(18, 30 / Math.max(viewport.zoom, 0.5)))
    const nextPreview = {
      ...currentPreview,
      point: target?.point ?? point,
      ...(target ? { targetId: target.nodeId, targetAnchor: target.anchor } : { targetId: undefined, targetAnchor: undefined }),
    }
    arrowEndpointPreviewRef.current = nextPreview
    setArrowEndpointPreview(nextPreview)
  }

  function beginArrowLabelDrag(event: React.PointerEvent<SVGGElement>, arrow: CanvasArrow) {
    event.stopPropagation()
    setSelectedIds([arrow.id])
    drag.current = { kind: 'arrow-label', pointerId: event.pointerId, id: arrow.id, before: sourceRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveArrowLabel(event: React.PointerEvent<SVGGElement>) {
    const active = drag.current
    if (!active || active.kind !== 'arrow-label' || active.pointerId !== event.pointerId) return
    const point = scenePoint(event.clientX, event.clientY, svgRef.current!, currentScene(), viewport)
    const draft = { id: active.id, position: { x: snap(point.x), y: snap(point.y) } }
    arrowLabelDraftRef.current = draft
    scheduleGeometryDraftRender()
  }

  function addArrowPoint(arrow: CanvasArrow) {
    const live = currentScene()
    if (arrow.start && arrow.end) {
      const points = [...(arrow.points ?? []), { x: snap((arrow.start.x + arrow.end.x) / 2), y: snap((arrow.start.y + arrow.end.y) / 2) }]
      updateElement(arrow.id, (item) => item.type === 'arrow' ? { ...item, points } : item)
      return
    }
    const from = live.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === arrow.from)
    const to = live.elements.find((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && item.id === arrow.to)
    if (!from || !to) return
    const fromCenter = center(from)
    const toCenter = center(to)
    const start = anchorPoint(from, arrow.fromAnchor, arrow.points?.[0] ?? toCenter)
    const end = anchorPoint(to, arrow.toAnchor, arrow.points?.at(-1) ?? fromCenter)
    const points = [...(arrow.points ?? []), { x: snap((start.x + end.x) / 2), y: snap((start.y + end.y) / 2) }]
    updateElement(arrow.id, (item) => item.type === 'arrow' ? { ...item, points } : item)
  }

  function zoomAt(nextZoom: number, clientX?: number, clientY?: number) {
    const live = currentScene()
    const svg = svgRef.current
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    if (!svg || clientX === undefined || clientY === undefined) {
      setViewport((current) => ({ ...current, zoom: clamped }))
      return
    }
    const bounds = svg.getBoundingClientRect()
    const px = clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1)
    const py = clamp((clientY - bounds.top) / Math.max(1, bounds.height), 0, 1)
    const worldX = viewport.x + px * (live.width / viewport.zoom)
    const worldY = viewport.y + py * (live.height / viewport.zoom)
    setViewport({ x: worldX - px * (live.width / clamped), y: worldY - py * (live.height / clamped), zoom: clamped })
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      zoomAt(viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY)
      return
    }
    const live = currentScene()
    const bounds = event.currentTarget.getBoundingClientRect()
    setViewport((current) => ({
      ...current,
      x: current.x + event.deltaX * ((live.width / current.zoom) / Math.max(1, bounds.width)),
      y: current.y + event.deltaY * ((live.height / current.zoom) / Math.max(1, bounds.height)),
    }))
  }

  function fit() {
    if (scene.architecture) {
      focusArchitectureScene(renderScene)
      return
    }
    if (boxes.length) {
      focusBoxes(boxes.map((item) => item.id))
      return
    }
    setViewport({ x: 0, y: 0, zoom: 1 })
  }

  function readArchitectureClearly() {
    const live = currentScene()
    const bounds = svgRef.current?.getBoundingClientRect()
    if (!live.architecture || !bounds) return
    setViewport(recommendArchitectureReadingViewport(
      renderScene, bounds.width, bounds.height, viewport.zoom, 11.5, MAX_ZOOM))
  }

  function recenterFromMinimap(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const targetX = minimapViewBounds.x + ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * minimapViewBounds.width
    const targetY = minimapViewBounds.y + ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * minimapViewBounds.height
    setViewport((current) => {
      const width = scene.width / current.zoom
      const height = scene.height / current.zoom
      return {
        ...current,
        x: clamp(targetX - width / 2, 0, Math.max(0, scene.width - width)),
        y: clamp(targetY - height / 2, 0, Math.max(0, scene.height - height)),
      }
    })
  }

  const viewWidth = scene.width / viewport.zoom
  const viewHeight = scene.height / viewport.zoom
  const multiSelectionToolbarPosition = selectedBoxes.length > 1 && !gesturePositionOverrides ? (() => {
    const left = Math.min(...selectedBoxes.map((item) => item.x))
    const top = Math.min(...selectedBoxes.map((item) => item.y))
    const right = Math.max(...selectedBoxes.map((item) => item.x + item.width))
    return {
      left: `${clamp(((left + right) / 2 - viewport.x) / viewWidth * 100, 8, 92)}%`,
      top: `${clamp((top - viewport.y) / viewHeight * 100, 12, 92)}%`,
    }
  })() : null
  const insertToolLabel = tool === 'note' ? '备注' : tool === 'pen' ? '画笔' : tool === 'line' ? '直线' : tool === 'arrow' ? '箭头' : '插入'
  const insertToolActive = ['note', 'pen', 'line', 'arrow'].includes(tool)
  const architectureToolbarLabel = scene.architecture
    ? architectureScope
      ? `布局 · ${architectureScope.kind === 'node' ? '聚焦' : '下钻'}`
      : `布局 · ${architectureView === 'overview' ? '总览' : '详情'}`
    : '布局'
  const analysisToolbarLabel = traceDirection
    ? `分析 · ${traceDirection === 'upstream' ? '上游' : traceDirection === 'downstream' ? '下游' : '上下游'}`
    : '分析'
  const semanticLodLabel = semanticLodLevel === 'detail' ? '细节'
    : semanticLodLevel === 'compact' ? '紧凑'
      : semanticLodLevel === 'overview' ? '概览'
        : '区域'
  const draggedArchitectureTemplate = architectureTemplateDrag ? architectureNodeTemplate(architectureTemplateDrag.templateId) : undefined
  const draggedShape = shapeDrag ? canvasShapeDefinition(shapeDrag.shapeRef) : undefined

  function renderArchitectureTemplateTile(asset: ArchitectureNodeTemplate) {
    const favorite = favoriteTemplateIds.includes(asset.id)
    return (
      <div key={asset.id} className={`freeform-asset-tile${architectureTemplateDrag?.templateId === asset.id ? ' is-dragging' : ''}`}>
        <button
          type="button"
          className="freeform-asset-insert"
          title={`${asset.subtitle} · 点击插入，拖到画布定位`}
          draggable
          onClick={() => insertArchitectureAsset(asset)}
          onDragStart={(event) => beginArchitectureTemplateDrag(event, asset)}
          onDragEnd={() => setArchitectureTemplateDrag(null)}
        >
          <ArchitectureTemplateGlyph asset={asset} />
          <span>{asset.label}</span>
        </button>
        <button
          type="button"
          className={`freeform-asset-favorite${favorite ? ' is-selected' : ''}`}
          aria-label={`${favorite ? '取消收藏' : '收藏'} ${asset.label}`}
          aria-pressed={favorite}
          title={favorite ? '取消收藏' : '收藏'}
          onClick={(event) => { event.stopPropagation(); toggleArchitectureTemplateFavorite(asset.id) }}
        >
          <FavoriteGlyph active={favorite} />
        </button>
      </div>
    )
  }

  const secondaryTools = <>
          <span className="freeform-toolbar-separator" />
          {architectureWorkbench ? <Popover open={toolbarMenu === 'architecture'} onOpenChange={(open) => {
            setToolbarMenu(open ? 'architecture' : null)
            if (open) { setLayersOpen(false); setArchitecturePanel('settings') }
          }}>
            <div className="freeform-toolbar-menu-wrap">
            <PopoverTrigger asChild>
            <button
              type="button"
              className={`${toolbarMenu === 'architecture' ? 'is-active' : ''}${scene.architecture ? ' has-mode-state' : ''}`}
              aria-expanded={toolbarMenu === 'architecture'}
              title={scene.architecture ? `${architectureView === 'overview' ? '总览视图' : '详情视图'} · ${architectureDensity === 'auto' ? '自动密度' : architectureDensity}${architectureScope ? ' · 当前处于局部视图' : ''}` : '架构工具'}
            >
              {architectureToolbarLabel}<span className="freeform-toolbar-chevron">⌄</span>
            </button>
            </PopoverTrigger>
            {toolbarMenu === 'architecture' ? (
              <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu is-architecture" aria-label="架构设置">
                {scene.architecture && architecturePanel === 'assets' ? <>
                  <div className="freeform-asset-library-head">
                    <button type="button" aria-label="返回架构设置" onClick={() => setArchitecturePanel('settings')}>‹</button>
                    <strong>组件模板</strong>
                    <span>{architectureAssets.length}/{ARCHITECTURE_NODE_TEMPLATES.length}</span>
                  </div>
                  <div className="freeform-asset-filters">
                    <input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="搜索组件" aria-label="搜索架构组件" />
                    <div className="freeform-asset-provider-tabs" aria-label="组件来源">
                      {([['all', '全部'], ['builtin', '通用'], ['aws', 'AWS'], ['azure', 'Azure'], ['gcp', 'GCP']] as const).map(([value, label]) => (
                        <button key={value} type="button" className={assetProvider === value ? 'is-selected' : ''} onClick={() => setAssetProvider(value)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="freeform-asset-library">
                    {!assetNeedle && favoriteAssets.length ? (
                      <div className="freeform-asset-quick-section">
                        <em>收藏</em>
                        <div className="freeform-asset-grid">
                          {favoriteAssets.map(renderArchitectureTemplateTile)}
                        </div>
                      </div>
                    ) : null}
                    {!assetNeedle && recentAssets.length ? (
                      <div className="freeform-asset-quick-section">
                        <em>最近</em>
                        <div className="freeform-asset-grid">
                          {recentAssets.map(renderArchitectureTemplateTile)}
                        </div>
                      </div>
                    ) : null}
                    {(['应用', '数据', '消息', '平台', 'AI / 集成'] as const).map((category) => {
                      const categoryAssets = architectureAssets.filter((asset) => asset.category === category)
                      if (!categoryAssets.length) return null
                      return <div key={category}>
                        <em>{category}</em>
                        <div className="freeform-asset-grid">
                          {categoryAssets.map(renderArchitectureTemplateTile)}
                        </div>
                      </div>
                    })}
                    {!architectureAssets.length ? <p className="freeform-asset-empty">没有匹配组件</p> : null}
                  </div>
                </> : <>
                {scene.architecture ? <>
                  <section className="freeform-compact-control-row">
                    <span>视图</span>
                    <div className="freeform-menu-grid two">
                      <button type="button" aria-pressed={architectureView === 'overview'} className={architectureView === 'overview' ? 'is-selected' : ''} onClick={() => { setArchitectureView('overview'); updateArchitectureAppearance({ view: 'overview' }); setSelectedIds([]); setSelectedGroupTarget(null) }}>总览</button>
                      <button type="button" aria-pressed={architectureView === 'detail'} className={architectureView === 'detail' ? 'is-selected' : ''} onClick={() => { setArchitectureView('detail'); updateArchitectureAppearance({ view: 'detail' }); setSelectedIds([]); setSelectedGroupTarget(null) }}>详情</button>
                    </div>
                  </section>

                  <section className="freeform-compact-control-row">
                    <span>密度</span>
                    <div className="freeform-menu-grid four">
                      {([['auto', '自动'], ['comfortable', '舒适'], ['compact', '紧凑'], ['dense', '高密']] as const).map(([value, label]) => (
                        <button key={value} type="button" aria-pressed={architectureDensity === value} className={architectureDensity === value ? 'is-selected' : ''} onClick={() => applyArchitectureDensity(value)}>{label}</button>
                      ))}
                    </div>
                  </section>
                  {partitionFlow?.steps.length ? (
                    <section className="freeform-architecture-dependency-navigation">
                      <span>依赖分区 · {partitionFlow.crossPartitionRelations} 跨区关系</span>
                      <div className="freeform-menu-stack">
                        {partitionFlow.steps.map((step, index) => (
                          <button
                            type="button"
                            key={step.id}
                            aria-label={`查看分区 ${step.label}，${step.nodeCount} 个节点`}
                            aria-current={architectureScope?.kind === 'group' && architectureScope.id === step.id ? 'step' : undefined}
                            className={architectureScope?.kind === 'group' && architectureScope.id === step.id ? 'is-selected' : ''}
                            onClick={() => { enterArchitectureScope({ kind: 'group', id: step.id }); setToolbarMenu(null) }}
                          >
                            <span><strong>{index + 1}. {step.label}</strong><small>{step.nodeCount} 节点 · 入 {step.incoming} / 出 {step.outgoing}</small></span>
                            <b>›</b>
                          </button>
                        ))}
                      </div>
                      {architectureScope ? <button type="button" onClick={() => { leaveArchitectureScope(); setToolbarMenu(null) }}>返回全局</button> : null}
                    </section>
                  ) : null}
                  <section className="freeform-asset-library-entry">
                    <button type="button" onClick={() => setArchitecturePanel('assets')}>
                      <span><strong>组件模板</strong><small>通用、AWS、Azure、GCP</small></span>
                      <b>{ARCHITECTURE_NODE_TEMPLATES.length} ›</b>
                    </button>
                  </section>
                </> : (
                  <section className="freeform-architecture-entry">
                    <span>架构模式</span>
                    <p>识别节点角色与系统边界，并统一分区、层级、配色和连线。</p>
                    <button type="button" className="is-primary" onClick={() => { beautifyArchitecture(); setToolbarMenu(null) }}>转换并自动整理</button>
                  </section>
                )}
                <div className="freeform-architecture-actions">
                  <button type="button" onClick={() => { beautifyArchitecture(); setToolbarMenu(null) }}>{scene.architecture ? '重新整理' : '架构化整理'}</button>
                  <button type="button" onClick={() => { tidyArchitectureRoutes(); setToolbarMenu(null) }}>整理连线</button>
                </div>
                <details className="freeform-menu-more">
                  <summary>更多布局与模板</summary>
                  {scene.groups?.some((group) => Boolean(group.c4Type)) ? (
                    <section>
                      <span>C4 层级</span>
                      <div className="freeform-menu-grid three">
                        <button type="button" aria-pressed={c4CollapseLevel === 'expanded'} className={c4CollapseLevel === 'expanded' ? 'is-selected' : ''} onClick={() => applyC4CollapseLevel('expanded')}>展开</button>
                        <button type="button" aria-pressed={c4CollapseLevel === 'container'} className={c4CollapseLevel === 'container' ? 'is-selected' : ''} onClick={() => applyC4CollapseLevel('container')}>容器</button>
                        <button type="button" aria-pressed={c4CollapseLevel === 'system'} className={c4CollapseLevel === 'system' ? 'is-selected' : ''} onClick={() => applyC4CollapseLevel('system')}>系统</button>
                      </div>
                    </section>
                  ) : null}
                  <section>
                    <span>布局</span>
                    <div className="freeform-menu-grid three">
                      <button type="button" onClick={() => { applyLayout('horizontal'); setToolbarMenu(null) }}>左 → 右</button>
                      <button type="button" onClick={() => { applyLayout('vertical'); setToolbarMenu(null) }}>上 → 下</button>
                      <button type="button" onClick={() => { applyLayout('grid'); setToolbarMenu(null) }}>网格</button>
                    </div>
                  </section>
                  <section>
                    <span>泳道</span>
                    <div className="freeform-menu-grid three">
                      <button type="button" onClick={() => { applyLanePreset('horizontal'); setToolbarMenu(null) }}>水平</button>
                      <button type="button" onClick={() => { applyLanePreset('vertical'); setToolbarMenu(null) }}>垂直</button>
                      <button type="button" disabled={!scene.lanes?.length} onClick={() => { removeLanes(); setToolbarMenu(null) }}>移除</button>
                    </div>
                  </section>
                  <section>
                    <span>插入模板</span>
                    <div className="freeform-menu-stack">
                      <button type="button" onClick={() => { insertArchitectureTemplate('web-service'); setToolbarMenu(null) }}>Web / API / Service</button>
                      <button type="button" onClick={() => { insertArchitectureTemplate('event-driven'); setToolbarMenu(null) }}>事件驱动</button>
                      <button type="button" onClick={() => { insertArchitectureTemplate('cache-aside'); setToolbarMenu(null) }}>Cache Aside</button>
                    </div>
                  </section>
                </details>
                </>}
              </PopoverContent>
            ) : null}
            </div>
          </Popover> : null}
          {flowchartWorkbench ? (
            <Popover open={toolbarMenu === 'flowchart'} onOpenChange={(open) => {
              setToolbarMenu(open ? 'flowchart' : null)
              if (open) setLayersOpen(false)
            }}>
            <div className="freeform-toolbar-menu-wrap">
              <PopoverTrigger asChild>
              <button
                type="button"
                className={toolbarMenu === 'flowchart' ? 'is-active' : 'has-mode-state'}
                aria-expanded={toolbarMenu === 'flowchart'}
                title="流程图布局与泳道"
              >
                流程<span className="freeform-toolbar-chevron">⌄</span>
              </button>
              </PopoverTrigger>
              {toolbarMenu === 'flowchart' ? (
                <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu is-flowchart" aria-label="流程图工具">
                  <section>
                    <span>阅读方向</span>
                    <div className="freeform-menu-grid two">
                      <button type="button" onClick={() => { applyLayout('horizontal'); setToolbarMenu(null) }}>左 → 右</button>
                      <button type="button" onClick={() => { applyLayout('vertical'); setToolbarMenu(null) }}>上 → 下</button>
                    </div>
                  </section>
                  <section>
                    <span>泳道</span>
                    <div className="freeform-menu-grid three">
                      <button type="button" onClick={() => { applyLanePreset('horizontal'); setToolbarMenu(null) }}>水平</button>
                      <button type="button" onClick={() => { applyLanePreset('vertical'); setToolbarMenu(null) }}>垂直</button>
                      <button type="button" disabled={!scene.lanes?.length} onClick={() => { removeLanes(); setToolbarMenu(null) }}>移除</button>
                    </div>
                  </section>
                </PopoverContent>
              ) : null}
            </div>
            </Popover>
          ) : null}
          <Popover open={toolbarMenu === 'style'} onOpenChange={(open) => setToolbarMenu(open ? 'style' : null)}>
            <PopoverTrigger asChild><button type="button" className={toolbarMenu === 'style' ? 'is-active' : ''}>样式</button></PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu is-style" aria-label="画布样式设置">
              <label className="freeform-style-preset"><span>配色</span>
          <select className="freeform-visual-style" aria-label="画布样式" value={scene.style ?? ''} onChange={(event) => commit({ ...currentScene(), style: event.target.value ? event.target.value as DiagramVisualStyle : undefined })}>
            <option value="">原始样式</option>
            {diagramVisualStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
          </select>
              </label>
              {scene.architecture ? <>
                  <section className="freeform-theme-section">
                    <span>主题</span>
                    <div className="freeform-theme-grid">
                      {ARCHITECTURE_THEME_OPTIONS.map((item) => (
                        <button key={item.value} type="button" title={item.description} aria-pressed={architectureTheme === item.value} className={`freeform-theme-option theme-${item.value}${architectureTheme === item.value ? ' is-selected' : ''}`} onClick={() => applyArchitectureTheme(item.value)}>
                          <i aria-hidden="true"><b /><b /><b /></i>
                          <strong>{item.label}</strong>
                        </button>
                      ))}
                    </div>
                  </section>
              </> : null}
            </PopoverContent>
          </Popover>
          <button type="button" className={layersOpen ? 'is-active' : ''} aria-pressed={layersOpen} onClick={() => { setToolbarMenu(null); setMoreToolsOpen(false); setShapeLibraryOpen(false); setLayersOpen((value) => !value) }}>层级</button>
          {architectureWorkbench ? <Popover open={toolbarMenu === 'analysis'} onOpenChange={(open) => {
            setToolbarMenu(open ? 'analysis' : null)
            if (open) setLayersOpen(false)
          }}>
            <div className="freeform-toolbar-menu-wrap">
            <PopoverTrigger asChild>
            <button
              type="button"
              className={`${toolbarMenu === 'analysis' ? 'is-active' : ''}${traceDirection ? ' has-mode-state' : ''}`}
              aria-expanded={toolbarMenu === 'analysis'}
              title={traceDirection ? `正在追踪${traceDirection === 'upstream' ? '上游' : traceDirection === 'downstream' ? '下游' : '上下游'}依赖 · ${traceDepth} 跳` : '架构与代码分析'}
            >
              {analysisToolbarLabel}<span className="freeform-toolbar-chevron">⌄</span>
            </button>
            </PopoverTrigger>
            {toolbarMenu === 'analysis' ? (
              <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu is-analysis" aria-label="架构分析">
                {selectedBoxes.length ? (
                  <section>
                    <span>依赖追踪</span>
                    <div className="freeform-menu-grid three">
                      <button type="button" aria-pressed={traceDirection === 'upstream'} className={traceDirection === 'upstream' ? 'is-selected' : ''} onClick={() => { setTraceDirection('upstream'); setToolbarMenu(null) }}>上游</button>
                      <button type="button" aria-pressed={traceDirection === 'both'} className={traceDirection === 'both' ? 'is-selected' : ''} onClick={() => { setTraceDirection('both'); setToolbarMenu(null) }}>上下游</button>
                      <button type="button" aria-pressed={traceDirection === 'downstream'} className={traceDirection === 'downstream' ? 'is-selected' : ''} onClick={() => { setTraceDirection('downstream'); setToolbarMenu(null) }}>下游</button>
                    </div>
                    <label className="freeform-menu-depth"><span>深度</span><select value={traceDepth} onChange={(event) => setTraceDepth(Number(event.target.value))}><option value={1}>1 跳</option><option value={2}>2 跳</option><option value={3}>3 跳</option></select></label>
                  </section>
                ) : <p>选择节点后可追踪上下游依赖。</p>}
                {onAnalyzeGitImpact ? (
                  <section>
                    <span>代码分析</span>
                    <div className="freeform-menu-stack"><button type="button" onClick={() => { setToolbarMenu(null); void onAnalyzeGitImpact() }}>Git 改动影响</button></div>
                  </section>
                ) : null}
              </PopoverContent>
            ) : null}
            </div>
          </Popover> : null}
  </>

  return (
    <div ref={editorRef} className={`freeform-editor workbench-${workbench} architecture-view-${architectureProjection.view} architecture-density-${architectureProjection.density} architecture-theme-${architectureTheme} lod-${semanticLodLevel}${scene.architecture ? ' is-architecture-mode' : ''}${architectureScope ? ' has-architecture-scope' : ''}`} tabIndex={0} inert={!active || undefined} aria-label="自由画布编辑器" aria-busy={imageImporting || undefined} onPaste={handleEditorPaste}>
      <div ref={surfaceRef} className="freeform-surface">
        <input
          ref={imageInputRef}
          className="freeform-image-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void insertImageFile(file)
          }}
        />
        {imageImportError ? <div className="freeform-image-error" role="alert">{imageImportError}<button type="button" onClick={() => setImageImportError(null)}>关闭</button></div> : null}
        <div className="freeform-floating-toolbar" role="toolbar" aria-label="画布工具">
          <div className="freeform-tools">
          <ToolButton active={tool === 'select'} title="选择 (V)" onClick={() => { setTool('select'); setConnectFrom(null) }}><ToolbarGlyph icon={MousePointer2} /></ToolButton>
          <ToolButton active={tool === 'hand'} title="抓手 (H)" onClick={() => { setTool('hand'); setConnectFrom(null) }}><ToolbarGlyph icon={Hand} /></ToolButton>
          <ToolButton active={tool === 'node'} title={architectureWorkbench ? '组件 (N)' : `${canvasShapeDefinition(activeShapeRef).label} (N)`} onClick={() => { setTool('node'); setConnectFrom(null) }}>
            {architectureWorkbench ? <ToolbarGlyph icon={Shapes} /> : <span className="freeform-toolbar-shape"><ShapePreview shape={canvasShapeDefinition(activeShapeRef)} /></span>}
          </ToolButton>
          <ToolButton active={tool === 'text'} title="文字 (T)" onClick={() => { setTool('text'); setConnectFrom(null) }}><ToolbarGlyph icon={Type} /></ToolButton>
          <ToolButton active={tool === 'connect'} title="节点连接 (C)" onClick={() => { setTool('connect'); setConnectFrom(null) }}><ToolbarGlyph icon={Link2} /></ToolButton>
          <Popover open={toolbarMenu === 'insert'} onOpenChange={(open) => setToolbarMenu(open ? 'insert' : null)}>
            <PopoverTrigger asChild><button type="button" aria-label="插入图元" className={toolbarMenu === 'insert' || insertToolActive ? 'is-active' : ''}>{insertToolLabel}</button></PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu is-insert" aria-label="插入图元">
              <div className="freeform-menu-grid two">
                <button type="button" onClick={() => { setTool('note'); setConnectFrom(null); setToolbarMenu(null) }}>备注</button>
                <button type="button" onClick={() => { setTool('pen'); setConnectFrom(null); setToolbarMenu(null) }}>画笔</button>
                <button type="button" onClick={() => { setTool('line'); setConnectFrom(null); setToolbarMenu(null) }}>直线</button>
                <button type="button" onClick={() => { setTool('arrow'); setConnectFrom(null); setToolbarMenu(null) }}>箭头</button>
                <button type="button" disabled={imageImporting || !onImportImage} onClick={() => { imageInputRef.current?.click(); setToolbarMenu(null) }}>图片</button>
                {!architectureWorkbench ? <button type="button" onClick={() => { setShapeLibraryOpen(true); setLayersOpen(false); setToolbarMenu(null) }}>更多图形</button> : null}
                {!architectureWorkbench ? (flowchartWorkbench ? ['flowchart:process', 'flowchart:decision', 'flowchart:terminator'] : ['basic:rectangle', 'basic:ellipse', 'basic:diamond']).map((ref) => {
                  const shape = canvasShapeDefinition(ref as CanvasShapeRef)
                  return <button key={ref} type="button" onClick={() => { setActiveShapeRef(shape.ref); setTool('node'); setConnectFrom(null); setToolbarMenu(null) }}>{shape.label}</button>
                }) : null}
              </div>
            </PopoverContent>
          </Popover>
          {compactToolbar ? <Popover open={moreToolsOpen} onOpenChange={setMoreToolsOpen}>
            <PopoverTrigger asChild><button type="button" aria-label="更多画布工具" className={moreToolsOpen ? 'is-active' : ''}>更多</button></PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="freeform-toolbar-menu freeform-toolbar-overflow" aria-label="更多画布工具">{secondaryTools}</PopoverContent>
          </Popover> : secondaryTools}
          </div>
          <div className="freeform-tool-history">
          <span className="freeform-toolbar-separator" />
          <button type="button" title="撤销 ⌘Z" aria-label="撤销" disabled={undoStack.current.length === 0} onClick={undo}>↶</button>
          <button type="button" title="重做 ⇧⌘Z" aria-label="重做" disabled={redoStack.current.length === 0} onClick={redo}>↷</button>
          </div>
        </div>

        {!architectureWorkbench && shapeLibraryOpen ? (
          <ShapeLibrary
            packs={[...shapeLibraryPacks]}
            activeShape={activeShapeRef}
            draggingShape={shapeDrag?.shapeRef}
            onClose={() => setShapeLibraryOpen(false)}
            onInsert={insertShape}
            onDragStart={beginShapeDrag}
            onDragEnd={() => setShapeDrag(null)}
          />
        ) : null}

        {architectureScope ? (
          <nav className="freeform-architecture-breadcrumb" aria-label="架构导航路径">
            <span className="freeform-scope-label">{architectureScope.kind === 'node' ? 'FOCUS' : 'SCOPE'}</span>
            <button type="button" className="freeform-breadcrumb-root" onClick={leaveArchitectureScope}>全局</button>
            {architectureBreadcrumbs.map((item, index) => (
              <span key={`${item.kind}:${item.id}`}>
                <i>/</i>
                <button
                  type="button"
                  className={index === architectureBreadcrumbs.length - 1 ? 'is-current' : ''}
                  aria-current={index === architectureBreadcrumbs.length - 1 ? 'page' : undefined}
                  onClick={() => enterArchitectureScope({ kind: item.kind, id: item.id, ...(item.kind === 'node' ? { depth: architectureScope.depth ?? 1 } : {}) })}
                >{truncate(item.label, 26)}</button>
              </span>
            ))}
            {architectureScope.kind === 'node' ? (
              <span className="freeform-focus-depth" aria-label="聚焦深度">
                {[1, 2, 3].map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    className={(architectureScope.depth ?? 1) === depth ? 'is-current' : ''}
                    onClick={() => enterArchitectureScope({ kind: 'node', id: architectureScope.id, depth })}
                  >{depth} 跳</button>
                ))}
              </span>
            ) : null}
            <em>{visibleRenderBoxes.length} 节点 · {displayGroupBounds.filter((group) => group.collapsed).length} 区域 · {visibleRenderArrows.length} 关系</em>
          </nav>
        ) : null}
        {largeSceneViewportCulling || semanticLodLevel === 'overview' || semanticLodLevel === 'regions' ? (
          <div className="freeform-large-scene-hint">LOD {semanticLodLabel}{largeSceneViewportCulling ? ` · 视窗 ${visibleRenderBoxes.length}/${renderBoxes.length} 节点` : ''}{semanticLodProjection.hiddenNodes ? ` · 摘要 ${semanticLodProjection.hiddenNodes} 节点` : ''}</div>
        ) : null}

        {layersOpen ? (
          <aside className="freeform-layer-panel" aria-label="画布层级与搜索">
            <div className="freeform-layer-head">
              <strong>层级</strong>
              <button type="button" onClick={() => setLayersOpen(false)}>关闭</button>
            </div>
            <input value={layerQuery} onChange={(event) => setLayerQuery(event.target.value)} placeholder="搜索节点、标签、源码" aria-label="搜索画布节点" />
            {(scene.groups ?? []).length ? (
              <section>
                <span>边界</span>
                {(scene.groups ?? [])
                  .filter((group) => !layerNeedle || [group.id, group.label, group.description, group.c4Type].some((value) => value?.toLocaleLowerCase().includes(layerNeedle)))
                  .map((group) => (
                    <button key={group.id} type="button" className={selectedGroupId === group.id ? 'is-active' : ''} style={{ paddingLeft: 8 + groupDepth(group.id, scene.groups ?? []) * 12 }} onClick={() => selectGroup(group.id)}>
                      <span>{group.collapsed ? '▸' : '▾'}</span>
                      <strong>{group.label || group.id}</strong>
                      <small>{group.c4Type ? c4Label(group.c4Type) : group.kind === 'boundary' ? 'Boundary' : 'Group'}</small>
                    </button>
                  ))}
              </section>
            ) : null}
            {(scene.lanes ?? []).length ? (
              <section>
                <span>泳道</span>
                {(scene.lanes ?? []).filter((lane) => !layerNeedle || lane.label.toLocaleLowerCase().includes(layerNeedle)).map((lane) => (
                  <button key={lane.id} type="button" onClick={() => {
                    const ids = boxes.filter((item) => item.laneId === lane.id).map((item) => item.id)
                    setSelectedGroupTarget(null)
                    setSelectedIds(ids)
                    focusBoxes(ids)
                  }}>
                    <strong>{lane.label}</strong><small>{lane.axis === 'horizontal' ? 'Horizontal' : 'Vertical'}</small>
                  </button>
                ))}
              </section>
            ) : null}
            <section>
              <span>节点 · {layerBoxes.length}</span>
              {layerBoxes.slice(0, 120).map((item) => (
                <button key={item.id} type="button" className={selectedIds.includes(item.id) ? 'is-active' : ''} onClick={() => revealAndFocus([item.id])}>
                  <strong>{item.text}</strong>
                  <small>{item.c4Type ? c4Label(item.c4Type) : item.stencil ? canvasStencilLabel(item.stencil) : item.icon ? canvasIconLabel(item.icon) : item.type}</small>
                </button>
              ))}
              {layerBoxes.length > 120 ? <em>只显示前 120 个结果，请继续缩小搜索范围。</em> : null}
            </section>
          </aside>
        ) : null}

        <svg
          ref={svgRef}
          className={`freeform-svg tool-${spacePanning ? 'hand' : tool}`}
          viewBox={`${viewport.x} ${viewport.y} ${viewWidth} ${viewHeight}`}

          role="img"
          aria-label="自由画布"
          onWheel={handleWheel}
          onDragOver={moveExternalDrag}
          onDrop={dropExternalDrag}
          onPointerDown={beginBackgroundPointer}
          onPointerMove={moveBackgroundPointer}
          onPointerUp={finishGesture}
          onPointerCancel={cancelGesture}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return
            if (drag.current) return
            const point = scenePoint(event.clientX, event.clientY, event.currentTarget, currentScene(), viewport)
            if (connectFrom && completeConnectionOnBlank(point)) return
            if (tool === 'node' || tool === 'note') addBox(tool, point.x, point.y)
            if (tool === 'text') addText(point.x, point.y)
          }}
        >
          <defs>
            <pattern id="canvas-grid" width={GRID * 2} height={GRID * 2} patternUnits="userSpaceOnUse">
              <path d={`M${GRID * 2} 0H0V${GRID * 2}`} className="freeform-grid-line" fill="none" />
            </pattern>
            <marker id="canvas-arrow" markerUnits={scene.architecture ? 'userSpaceOnUse' : 'strokeWidth'} markerWidth="12" markerHeight="12" refX={scene.architecture ? 10 : 9} refY="4" orient="auto">
              <path d="M0,0 L0,8 L10,4 z" fill="context-stroke" />
            </marker>
          </defs>
          <rect width={scene.width} height={scene.height} className="freeform-background" style={visualSkin ? { fill: visualSkin.background } : undefined} pointerEvents="none" />
          <rect width={scene.width} height={scene.height} fill="url(#canvas-grid)" pointerEvents="none" />
          {draggedArchitectureTemplate && architectureTemplateDrag?.point ? (() => {
            const width = draggedArchitectureTemplate.width ?? 188
            const height = draggedArchitectureTemplate.height ?? 80
            const x = clamp(architectureTemplateDrag.point.x - width / 2, 0, Math.max(0, scene.width - width))
            const y = clamp(architectureTemplateDrag.point.y - height / 2, 0, Math.max(0, scene.height - height))
            return (
              <g className={`freeform-template-drop-preview${architectureTemplateDrag.groupId ? ' is-in-boundary' : ''}`} transform={`translate(${x} ${y})`} pointerEvents="none">
                <rect width={width} height={height} rx="8" />
                <text x={14} y={height / 2 + 4}>{truncate(draggedArchitectureTemplate.label, 24)}</text>
              </g>
            )
          })() : null}
          {draggedShape && shapeDrag?.point ? (() => {
            const geometry = canvasShapeGeometry(draggedShape.ref, draggedShape.width, draggedShape.height)
            const x = clamp(shapeDrag.point.x - draggedShape.width / 2, 0, Math.max(0, scene.width - draggedShape.width))
            const y = clamp(shapeDrag.point.y - draggedShape.height / 2, 0, Math.max(0, scene.height - draggedShape.height))
            return (
              <g className="freeform-shape-drop-preview" transform={`translate(${x} ${y})`} pointerEvents="none">
                <path d={geometry.bodyPath} />
                {geometry.detailPaths.map((path, index) => <path key={index} d={path} className="is-detail" />)}
              </g>
            )
          })() : null}
          {snapGuides.x !== undefined ? <path className="freeform-snap-guide" d={`M ${snapGuides.x} 0 V ${scene.height}`} /> : null}
          {snapGuides.y !== undefined ? <path className="freeform-snap-guide" d={`M 0 ${snapGuides.y} H ${scene.width}`} /> : null}
          {snapGuides.spacing?.map((guide, index) => guide.axis === 'x' ? (
            <g key={`spacing-x-${index}`} className="freeform-spacing-guide" pointerEvents="none">
              <path d={`M ${guide.from} ${guide.cross} H ${guide.to} M ${guide.from} ${guide.cross - 5} V ${guide.cross + 5} M ${guide.to} ${guide.cross - 5} V ${guide.cross + 5}`} />
              <text x={(guide.from + guide.to) / 2} y={guide.cross - 7} textAnchor="middle">{guide.distance}</text>
            </g>
          ) : (
            <g key={`spacing-y-${index}`} className="freeform-spacing-guide" pointerEvents="none">
              <path d={`M ${guide.cross} ${guide.from} V ${guide.to} M ${guide.cross - 5} ${guide.from} H ${guide.cross + 5} M ${guide.cross - 5} ${guide.to} H ${guide.cross + 5}`} />
              <text x={guide.cross + 8} y={(guide.from + guide.to) / 2 + 4}>{guide.distance}</text>
            </g>
          ))}
          {snapGuides.sizeLabel && snapGuides.sizePoint ? <text className="freeform-size-guide" x={snapGuides.sizePoint.x + 8} y={snapGuides.sizePoint.y} pointerEvents="none">{snapGuides.sizeLabel}</text> : null}
          {architectureHeader ? (
            <g className="freeform-architecture-header" pointerEvents="none">
              <rect width={scene.width} height={architectureHeader.height} />
              <path className="freeform-architecture-header-rule" d={`M 28 ${architectureHeader.height - 1} H ${scene.width - 28}`} />
              <text className="freeform-architecture-eyebrow" x="32" y="24">{architectureHeader.eyebrow}</text>
              <text className="freeform-architecture-title" x="32" y="52">{truncate(architectureHeader.title, 42)}</text>
              <text className="freeform-architecture-subtitle" x="32" y="72">{architectureHeader.subtitle}</text>
              {architectureHeader.legend.map((item, index) => {
                const x = architectureLegendStart + index * 92
                return (
                  <g key={item.kind} className={`freeform-architecture-legend kind-${item.kind}`} transform={`translate(${x} 50)`}>
                    <path d="M 0 0 H 26" />
                    <text x="34" y="4">{item.label}</text>
                  </g>
                )
              })}
            </g>
          ) : null}
          {(renderScene.lanes ?? []).map((lane) => {
            const x = lane.axis === 'vertical' ? lane.start : 0
            const y = lane.axis === 'horizontal' ? lane.start : architectureHeader?.height ?? 0
            const width = lane.axis === 'vertical' ? lane.size : scene.width
            const height = lane.axis === 'horizontal' ? lane.size : scene.height - (architectureHeader?.height ?? 0)
            return (
              <g key={lane.id} className={`freeform-lane tone-${lane.tone ?? 'muted'}`} pointerEvents="none">
                <rect className="freeform-lane-body" x={x} y={y} width={width} height={height} rx="14" />
                <rect
                  className="freeform-lane-head is-navigable"
                  x={x}
                  y={y}
                  width={width}
                  height={34}
                  rx="14"
                  pointerEvents="all"
                  onClick={(event) => {
                    event.stopPropagation()
                    const ids = boxes.filter((item) => item.laneId === lane.id).map((item) => item.id)
                    setSelectedGroupTarget(null)
                    setSelectedIds(ids)
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    if (scene.architecture) enterArchitectureScope({ kind: 'lane', id: lane.id })
                    else focusBoxes(boxes.filter((item) => item.laneId === lane.id).map((item) => item.id))
                  }}
                />
                <text x={x + 14} y={y + 22}>{truncate(lane.label, 32)}</text>
              </g>
            )
          })}
          {viewportGroupBounds.filter((group) => (
            !groupHiddenByCollapsedAncestor(group.id, renderScene.groups ?? [])
          )).map((group) => (
            <g
              key={group.id}
              className={`freeform-group-frame kind-${group.kind ?? 'group'} c4-${group.c4Type ?? 'none'}${group.parentId ? ' has-parent' : ''}${group.collapsed ? ' is-collapsed' : ''}${autoCollapsedGroupIds.has(group.id) ? ' is-lod-summary' : ''} tone-${group.tone ?? 'muted'}${selectedGroupId === group.id || selectedGroupIds.includes(group.id) ? ' is-selected' : ''}${traceResult ? group.memberIds.some((id) => tracedNodeIds.has(id)) ? ' is-traced' : ' is-trace-dimmed' : ''}`}
              pointerEvents="none"
            >
              {group.description ? <title>{group.description}</title> : null}
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={scene.architecture ? group.c4Type === 'software-system' ? 10 : 8 : 20}
                pointerEvents={group.collapsed ? 'all' : 'none'}
                onClick={group.collapsed ? (event) => {
                  event.stopPropagation()
                  if (autoCollapsedGroupIds.has(group.id)) {
                    setSelectedIds([])
                    setSelectedGroupTarget(group.id)
                  } else selectGroup(group.id)
                } : undefined}
                onDoubleClick={group.collapsed ? (event) => {
                  event.stopPropagation()
                  if (scene.architecture) enterArchitectureScope({ kind: 'group', id: group.id })
                  else if (autoCollapsedGroupIds.has(group.id)) revealAndFocus(group.memberIds)
                  else {
                    commit(updateCanvasGroup(currentScene(), group.id, { collapsed: false }))
                    setSelectedGroupTarget(group.id)
                  }
                } : undefined}
              />
              {group.c4Type === 'software-system' && !group.collapsed ? <rect className="freeform-group-header" x={group.x} y={group.y} width={group.width} height="34" rx={scene.architecture ? 10 : 20} /> : null}
              {!group.collapsed ? (
                <rect
                  className={`freeform-group-navigation-hit${scene.architecture ? ' is-drillable' : ''}`}
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height="34"
                  rx="12"
                  pointerEvents="all"
                  onClick={(event) => { event.stopPropagation(); selectGroup(group.id) }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    if (scene.architecture) enterArchitectureScope({ kind: 'group', id: group.id })
                  }}
                />
              ) : null}
              {group.label ? <text x={group.x + 14} y={group.y + 22}>{truncate(group.label, 28)}{autoCollapsedGroupIds.has(group.id) ? ` · ${group.memberIds.length} 节点` : !scene.architecture && group.c4Type ? ` · ${c4Label(group.c4Type)}` : ''}{group.collapsed ? scene.architecture ? ' · 双击下钻' : autoCollapsedGroupIds.has(group.id) ? ' · 双击进入' : ' · 双击展开' : ''}</text> : null}
            </g>
          ))}
          {relationBundleTrunks.map((bundle) => (
            <path
              key={bundle.id}
              d={bundle.path}
              className={`freeform-bundle-trunk emphasis-${bundle.emphasis ?? 'secondary'}${bundle.id.startsWith('group:') ? ' is-group-bus' : ''}`}
              pointerEvents="none"
            />
          ))}
          {visibleRenderArrows.map((arrow) => {
            const gestureArrow = arrowPointDraft?.id === arrow.id ? { ...arrow, points: arrowPointDraft.points } : arrow
            const displayArrow = gestureArrow
            const standalone = Boolean(displayArrow.start && displayArrow.end)
            const fromRaw = standalone ? undefined : projectedBoxLookup.get(displayArrow.from)
            const toRaw = standalone ? undefined : projectedBoxLookup.get(displayArrow.to)
            const from = fromRaw ? fromRaw : undefined
            const to = toRaw ? toRaw : undefined
            if (!standalone && (!from || !to)) return null
            const route = standalone
              ? canvasArrowRoutePoints(displayArrow.start!, displayArrow.end!, displayArrow)
              : canvasArrowBoxRoute(from!, to!, displayArrow, displayArrow.from === displayArrow.to)
            const start = route[0]
            const end = route.at(-1)!
            const path = canvasArrowRoutePath(route, displayArrow.freehand)
            const fallbackLabelPoint = displayArrow.labelPosition ?? pathLabelPoint(route[0], route.at(-1)!, route.slice(1, -1))
            const automaticLabelLayout = relationLabelLayouts.get(arrow.id)
            const labelLayout = arrowLabelDraft?.id === arrow.id && displayArrow.label
              ? {
                  id: arrow.id,
                  x: arrowLabelDraft.position.x,
                  y: arrowLabelDraft.position.y,
                  ...canvasArrowLabelText(displayArrow.label),
                }
              : automaticLabelLayout
            const moveOrigins = frozenMoveLabels && drag.current?.kind === 'move' ? drag.current.positions : null
            const fromOrigin = moveOrigins?.get(arrow.from)
            const toOrigin = moveOrigins?.get(arrow.to)
            const fromMove = fromOrigin && gesturePositionOverrides?.[arrow.from]
            const toMove = toOrigin && gesturePositionOverrides?.[arrow.to]
            const movingLabel = !displayArrow.labelPosition && (fromMove || toMove)
              ? { x: ((fromMove ? fromMove.x - fromOrigin!.x : 0) + (toMove ? toMove.x - toOrigin!.x : 0)) / 2,
                  y: ((fromMove ? fromMove.y - fromOrigin!.y : 0) + (toMove ? toMove.y - toOrigin!.y : 0)) / 2 }
              : null
            return (
              <g key={arrow.id} data-element-id={arrow.id} className={`freeform-arrow emphasis-${displayArrow.emphasis ?? 'secondary'}${standalone ? ' is-free-line' : ''}${displayArrow.freehand ? ' is-freehand' : ''}${displayArrow.bundleKey ? ' is-bundled' : ''}${displayArrow.bundleKey?.startsWith('group:') ? ' is-group-bundle' : ''}${selectedIds.includes(arrow.id) ? ' is-selected' : ''}${insertTarget?.arrowId === arrow.id ? ' is-insert-target' : ''}${displayArrow.lineStyle === 'dashed' ? ' is-dashed' : displayArrow.lineStyle === 'dotted' ? ' is-dotted' : ''}${traceResult ? tracedArrowIds.has(arrow.id) ? ' is-traced' : ' is-trace-dimmed' : ''}${highlightedIds.has(arrow.id) ? ' is-updated' : ''}`} style={displayArrow.opacity !== undefined ? { opacity: displayArrow.opacity } : undefined} onContextMenu={(event) => openContextMenu(event, arrow.id)} onPointerDown={(event) => { event.stopPropagation(); setContextMenu(null); setSelectedGroupTarget(null); editorRef.current?.focus({ preventScroll: true }); setSelectedIds(event.shiftKey ? toggleId(selectedIds, arrow.id) : [arrow.id]) }}>
                <CanvasArrowInk label={displayArrow.label} path={path} markerEnd={displayArrow.markerEnd === 'none' ? undefined : 'url(#canvas-arrow)'} strokeColor={displayArrow.strokeColor || visualSkin ? displayArrow.strokeColor ?? visualSkin?.edge : undefined} strokeWidth={displayArrow.strokeWidth} />
                {displayArrow.label && labelLayout ? (
                  <g
                    className={`freeform-arrow-label${displayArrow.labelPosition || arrowLabelDraft?.id === arrow.id ? ' is-manual' : ''}`}
                    transform={movingLabel ? `translate(${movingLabel.x} ${movingLabel.y})` : undefined}
                    pointerEvents={selectedIds.includes(arrow.id) ? 'all' : 'none'}
                    onPointerDown={selectedIds.includes(arrow.id) ? (event) => beginArrowLabelDrag(event, arrow) : undefined}
                    onPointerMove={selectedIds.includes(arrow.id) ? moveArrowLabel : undefined}
                    onPointerUp={selectedIds.includes(arrow.id) ? finishGesture : undefined}
                    onPointerCancel={selectedIds.includes(arrow.id) ? cancelGesture : undefined}
                    onDoubleClick={selectedIds.includes(arrow.id) ? (event) => { event.stopPropagation(); updateElement(arrow.id, (item) => item.type === 'arrow' ? { ...item, labelPosition: undefined } : item) } : undefined}
                  >
                    <rect style={visualSkin ? { fill: visualSkin.background } : undefined} x={labelLayout.x - labelLayout.width / 2} y={labelLayout.y - labelLayout.height / 2} width={labelLayout.width} height={labelLayout.height} rx={8} />
                    <text x={labelLayout.x} y={labelLayout.y + 4 - (labelLayout.lines.length - 1) * 8} textAnchor="middle">{labelLayout.lines.map((line, index) => <tspan key={index} x={labelLayout.x} dy={index ? 16 : 0}>{line}</tspan>)}</text>
                  </g>
                ) : null}
                {selectedIds.includes(arrow.id) && !displayArrow.freehand ? displayArrow.points?.map((point, index) => (
                  <circle
                    key={`${arrow.id}-point-${index}`}
                    className="freeform-arrow-point"
                    cx={point.x}
                    cy={point.y}
                    r="8"
                    onPointerDown={(event) => beginArrowPointDrag(event, arrow, index)}
                    onPointerMove={moveArrowPoint}
                    onPointerUp={finishGesture}
                    onPointerCancel={cancelGesture}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      updateElement(arrow.id, (item) => item.type === 'arrow' ? { ...item, points: item.points?.filter((_, pointIndex) => pointIndex !== index) } : item)
                    }}
                  />
                )) : null}
                {selectedIds.includes(arrow.id) && !displayArrow.freehand ? <>
                  <circle className="freeform-arrow-endpoint" cx={start.x} cy={start.y} r="7" onPointerDown={(event) => beginArrowEndpointDrag(event, arrow, 'from', end, start)} onPointerMove={moveArrowEndpoint} onPointerUp={finishGesture} onPointerCancel={cancelGesture} />
                  <circle className="freeform-arrow-endpoint" cx={end.x} cy={end.y} r="7" onPointerDown={(event) => beginArrowEndpointDrag(event, arrow, 'to', start, end)} onPointerMove={moveArrowEndpoint} onPointerUp={finishGesture} onPointerCancel={cancelGesture} />
                </> : null}
              </g>
            )
          })}
          {collapsedConnections.map((connection) => {
            const fromCenter = center(connection.fromBox)
            const toCenter = center(connection.toBox)
            const start = anchorPoint(connection.fromBox, connection.fromAnchor, toCenter)
            const end = anchorPoint(connection.toBox, connection.toAnchor, fromCenter)
            const path = canvasArrowPath(start, end, connection)
            const label = connection.labels.slice(0, 2).join(' · ')
            return (
              <g key={connection.id} className={`freeform-arrow is-collapsed-summary${connection.lineStyle === 'dashed' ? ' is-dashed' : ''}`} pointerEvents="none">
                <path d={path} markerEnd="url(#canvas-arrow)" />
                {label || connection.count > 1 ? <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 10} textAnchor="middle">{truncate(`${label}${connection.count > 1 ? ` ×${connection.count}` : ''}`, 36)}</text> : null}
              </g>
            )
          })}
          {connectPreviewStart && connectPreviewPoint ? (
            <g className="freeform-connect-preview" pointerEvents="none">
              <path d={`M ${connectPreviewStart.x} ${connectPreviewStart.y} L ${connectPreviewPoint.x} ${connectPreviewPoint.y}`} />
              <circle cx={connectPreviewPoint.x} cy={connectPreviewPoint.y} r="6" />
            </g>
          ) : null}
          {lineDraft ? (
            <g className="freeform-line-draw-preview" pointerEvents="none">
              <path d={`M ${lineDraft.start.x} ${lineDraft.start.y} L ${lineDraft.end.x} ${lineDraft.end.y}`} markerEnd={lineDraft.markerEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined} />
            </g>
          ) : null}
          {freehandDraft?.points.length ? (
            <g className="freeform-freehand-preview" pointerEvents="none">
              <path d={canvasArrowPath(
                freehandDraft.points[0],
                freehandDraft.points.at(-1)!,
                { points: freehandDraft.points.slice(1, -1), freehand: true },
              )} />
            </g>
          ) : null}
          {arrowEndpointPreview ? (
            <g className="freeform-arrow-reconnect-preview" pointerEvents="none">
              <path d={arrowEndpointPreview.endpoint === 'from'
                ? `M ${arrowEndpointPreview.point.x} ${arrowEndpointPreview.point.y} L ${arrowEndpointPreview.fixedPoint.x} ${arrowEndpointPreview.fixedPoint.y}`
                : `M ${arrowEndpointPreview.fixedPoint.x} ${arrowEndpointPreview.fixedPoint.y} L ${arrowEndpointPreview.point.x} ${arrowEndpointPreview.point.y}`} />
              <circle cx={arrowEndpointPreview.point.x} cy={arrowEndpointPreview.point.y} r="7" />
            </g>
          ) : null}
          {visibleRenderBoxes.map((item) => {
            const originalItem = item
            const skin = canvasVisualSkin(originalItem.type === 'note' ? undefined : scene.style, darkTheme, originalItem.tone, originalItem.emphasis === 'primary' && !scene.architecture)
            const displayItem = scene.architecture && originalItem.type === 'node' ? originalItem : canvasStyledBox(originalItem, skin)
            const displayX = displayItem.x
            const displayY = displayItem.y
            const imagePath = displayItem.type === 'note' ? displayItem.imagePath : undefined
            const imageSource = imagePath ? imageSources[imagePath] : undefined
            const architectureCard = displayItem.type === 'node' && Boolean(displayItem.iconRef || displayItem.icon || displayItem.stencil || displayItem.c4Type)
            const cardTemplate = canvasArchitectureCardTemplate(displayItem)
            const architectureMark = Boolean(scene.architecture && architectureCard && (displayItem.iconRef || displayItem.stencil || displayItem.icon))
            const selectedForLod = selectedIdSet.has(item.id)
            const showAnchorPoints = !imagePath && !(displayItem.type === 'note' && displayItem.textOnly) && (selectedForLod || tool === 'connect' || connectFrom === item.id)
            return (
            <g
              key={item.id}
              data-element-id={item.id}
              className={`freeform-box freeform-${displayItem.type} tone-${displayItem.tone ?? 'default'} shape-${displayItem.shape ?? 'rounded'} emphasis-${displayItem.emphasis ?? 'secondary'}${displayItem.type === 'note' && displayItem.textOnly ? ' is-text-only' : ''}${imagePath ? ' is-image' : ''}${architectureCard ? ` is-architecture-card card-kind-${cardTemplate.kind}` : ''}${architectureMark ? ' is-architecture-mark' : ''}${displayItem.iconRef ? ' has-icon-ref' : displayItem.stencil ? ' has-stencil-logo' : ''}${displayItem.fillColor ? ' has-custom-fill' : ''}${displayItem.strokeColor ? ' has-custom-stroke' : ''}${displayItem.strokeWidth ? ' has-custom-stroke-width' : ''}${displayItem.locked ? ' is-locked' : ''}${selectedIds.includes(item.id) ? ' is-selected' : ''}${dragCollisionIds.has(item.id) ? ' is-collision' : ''}${connectFrom === item.id ? ' is-connect-source' : ''}${arrowEndpointPreview?.targetId === item.id ? ' is-reconnect-target' : ''}${traceResult ? tracedNodeIds.has(item.id) ? ` is-traced trace-depth-${Math.min(3, traceResult.distanceById[item.id] ?? 0)}` : ' is-trace-dimmed' : ''}${highlightedIds.has(item.id) ? ' is-updated' : ''}`}
              style={{ ...canvasBoxVisualStyle(displayItem), ...(skin && displayItem.type === 'node' ? { filter: skin.shadow, ...(selectedIds.includes(item.id) ? { '--canvas-box-stroke': 'var(--accent)' } : {}) } : {}) }}
              transform={`translate(${displayX} ${displayY})${displayItem.rotation ? ` rotate(${displayItem.rotation} ${displayItem.width / 2} ${displayItem.height / 2})` : ''}`}
              onContextMenu={(event) => openContextMenu(event, item.id)}
              onPointerDown={(event) => startMove(event, item)}
              onClick={(event) => { event.stopPropagation(); handleBoxClick(item.id, event) }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                if (scene.architecture && architectureProjection.view === 'overview') {
                  enterArchitectureScope({ kind: 'node', id: item.id, depth: 1 })
                  return
                }
                setSelectedGroupTarget(null)
                setSelectedIds([item.id])
                if (!item.locked) window.setTimeout(() => { textInputRef.current?.focus(); textInputRef.current?.select() }, 0)
              }}
              onPointerMove={(event) => moveSelection(event, item)}
              onPointerUp={finishGesture}
              onPointerCancel={cancelGesture}
            >
              <CanvasBoxArtwork item={originalItem} visualStyle={scene.style} darkTheme={darkTheme} architecture={Boolean(scene.architecture)} architectureTheme={scene.architecture?.theme} density={architectureProjection.density} titleScale={scene.architecture?.titleScale} level={semanticLodLevel} selected={selectedForLod} imageSource={imageSource} />
              {showAnchorPoints ? <g className="freeform-anchor-points">
                  <circle cx={displayItem.width / 2} cy={0} r="7" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => handleAnchorClick(event, item.id, 'top')} />
                  <circle cx={displayItem.width} cy={displayItem.height / 2} r="7" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => handleAnchorClick(event, item.id, 'right')} />
                  <circle cx={displayItem.width / 2} cy={displayItem.height} r="7" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => handleAnchorClick(event, item.id, 'bottom')} />
                  <circle cx={0} cy={displayItem.height / 2} r="7" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => handleAnchorClick(event, item.id, 'left')} />
              </g> : null}
              {selectedIds.length === 1 && selectedIds[0] === item.id && !item.locked ? architectureWorkbench ? (
                <rect
                  className="freeform-resize-handle"
                  data-handle="se"
                  x={displayItem.width - 7}
                  y={displayItem.height - 7}
                  width="14"
                  height="14"
                  rx="3"
                  onPointerDown={(event) => beginResize(event, item, 'se')}
                  onPointerMove={moveResize}
                  onPointerUp={finishGesture}
                  onPointerCancel={cancelGesture}
                />
              ) : <>
                {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((handle) => {
                  const point = canvasResizeHandlePoint(handle, displayItem.width, displayItem.height)
                  return <rect
                    key={handle}
                    className="freeform-resize-handle"
                    data-handle={handle}
                    x={point.x - 6}
                    y={point.y - 6}
                    width="12"
                    height="12"
                    rx="3"
                    onPointerDown={(event) => beginResize(event, item, handle)}
                    onPointerMove={moveResize}
                    onPointerUp={finishGesture}
                    onPointerCancel={cancelGesture}
                  />
                })}
                <path className="freeform-rotate-stem" d={`M ${displayItem.width / 2} 0 V -26`} />
                <circle
                  className="freeform-rotate-handle"
                  cx={displayItem.width / 2}
                  cy={-32}
                  r="7"
                  onPointerDown={(event) => beginRotate(event, item)}
                  onPointerMove={moveRotate}
                  onPointerUp={finishGesture}
                  onPointerCancel={cancelGesture}
                />
              </> : null}
            </g>
          )})}
          {multiTransformBounds ? (
            <g className="freeform-multi-transform" pointerEvents="none">
              <rect x={multiTransformBounds.x} y={multiTransformBounds.y} width={multiTransformBounds.width} height={multiTransformBounds.height} />
              {(['nw', 'ne', 'se', 'sw'] as const).map((handle) => {
                const local = canvasResizeHandlePoint(handle, multiTransformBounds.width, multiTransformBounds.height)
                return <rect
                  key={handle}
                  className="freeform-resize-handle"
                  data-handle={handle}
                  x={multiTransformBounds.x + local.x - 7}
                  y={multiTransformBounds.y + local.y - 7}
                  width="14"
                  height="14"
                  rx="3"
                  pointerEvents="all"
                  onPointerDown={(event) => beginMultiResize(event, handle)}
                  onPointerMove={moveResize}
                  onPointerUp={finishGesture}
                  onPointerCancel={cancelGesture}
                />
              })}
            </g>
          ) : null}
          {insertTarget ? (
            <g className="freeform-insert-target" transform={`translate(${insertTarget.point.x} ${insertTarget.point.y})`} pointerEvents="none">
              <circle r="11" />
              <path d="M -4 0 H 4 M 0 -4 V 4" />
              <text x="16" y="4">释放插入关系</text>
            </g>
          ) : null}
          {selectionRect ? (() => {
            const rect = normalizeRect(selectionRect)
            return <rect className="freeform-marquee" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
          })() : null}
        </svg>

        {multiSelectionToolbarPosition ? (
          <div className="freeform-selection-toolbar" style={multiSelectionToolbarPosition} aria-label="多选快捷操作">
            <button type="button" title="保持当前位置，只整理选区及一跳邻域" aria-label="智能整理邻域" onClick={smartLocalLayout}>整理</button>
            <button type="button" title="垂直对齐" aria-label="垂直对齐" onClick={() => alignSelection('x')}>│</button>
            <button type="button" title="水平对齐" aria-label="水平对齐" onClick={() => alignSelection('y')}>─</button>
            <button type="button" title="水平等距分布" aria-label="水平等距分布" onClick={() => distributeSelection('x')}>↔</button>
            <button type="button" title="垂直等距分布" aria-label="垂直等距分布" onClick={() => distributeSelection('y')}>↕</button>
            {selectedHasOverlap ? <button type="button" title="自动避让重叠节点" aria-label="自动避让" onClick={separateSelection}>避让</button> : null}
            <span />
            <button type="button" title="组合选中元素" disabled={selectedBoxes.length < 2} onClick={groupSelection}>组合</button>
          </div>
        ) : null}

        {contextMenu ? (
          <div className="freeform-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {selectedSingle?.type === 'arrow' ? <>
              {selectedSingle.start && selectedSingle.end ? null : <button type="button" role="menuitem" onClick={() => { insertNodeIntoArrow(selectedSingle); setContextMenu(null) }}>插入中间节点</button>}
              <button type="button" role="menuitem" onClick={() => { reverseSelectedArrow(selectedSingle.id); setContextMenu(null) }}>反转关系方向</button>
              {selectedSingle.start && selectedSingle.end ? null : <button type="button" role="menuitem" onClick={() => { rerouteSelectedArrow(selectedSingle.id); setContextMenu(null) }}>重新路由</button>}
              {selectedSingle.labelPosition ? <button type="button" role="menuitem" onClick={() => { updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, labelPosition: undefined } : item); setContextMenu(null) }}>标签恢复自动位置</button> : null}
              <span />
            </> : null}
            {selected.length ? <button type="button" role="menuitem" onClick={() => { copySelection(); pasteSelection(); setContextMenu(null) }}>复制一份</button> : null}
            {selectedBox?.sourcePaths?.[0] && onOpenSource ? <button type="button" role="menuitem" onClick={() => { onOpenSource(selectedBox.sourcePaths![0]); setContextMenu(null) }}>打开关联源码</button> : null}
            {selectedBoxes.length > 1 ? <button type="button" role="menuitem" onClick={() => { groupSelection(); setContextMenu(null) }}>组合</button> : null}
            {selectedGroupIds.length > 0 ? <button type="button" role="menuitem" onClick={() => { ungroupSelection(); setContextMenu(null) }}>取消组合</button> : null}
            {selectedBoxes.length > 0 ? <button type="button" role="menuitem" onClick={toggleSelectionLock}>{selectedLocked.length === selectedBoxes.length ? '解锁' : '锁定'}</button> : null}
            {selectedBoxes.length > 0 ? <button type="button" role="menuitem" onClick={() => reorderSelection('front')}>移到最前</button> : null}
            {selectedBoxes.length > 0 ? <button type="button" role="menuitem" onClick={() => reorderSelection('back')}>移到最后</button> : null}
            <span />
            <button type="button" role="menuitem" className="is-danger" disabled={selectedBoxes.length > 0 && selectedLocked.length === selectedBoxes.length} onClick={deleteSelected}>删除</button>
          </div>
        ) : null}

        <div className="freeform-status">
          <span>{scene.elements.length} 个元素</span>
          {selected.length > 0 && inspectorCollapsed ? <button type="button" onClick={() => setInspectorCollapsed(false)}>属性</button> : null}
          {insertTarget ? <span className="is-action">释放后插入关系</span>
            : arrowEndpointPreview?.targetId ? <span className="is-action">释放后重挂到 {truncate(boxes.find((item) => item.id === arrowEndpointPreview.targetId)?.text ?? arrowEndpointPreview.targetId, 18)}</span>
              : arrowEndpointPreview ? <span className="is-action">拖到节点锚点以重挂端点</span>
                : connectFrom ? <span className="is-action">连接中 · 点击节点，或点击空白创建新节点</span>
                  : gestureAutoReflowCount > 0 ? <span className="is-action">智能腾位 {gestureAutoReflowCount} 节点 · Alt 关闭</span>
                    : dragCollisionIds.size > 0 ? <span className="is-action">释放后自动腾位 · Alt 保留重叠</span>
                  : selectedIds.length > 0 ? <span>已选 {selectedIds.length}</span> : <span className="freeform-shortcuts">Space 拖动画布 · ⇧ 多选</span>}
        </div>
        <div className="freeform-zoom-controls" aria-label="画布缩放">
          <button type="button" aria-label="缩小画布" onClick={() => zoomAt(viewport.zoom / 1.15)}>−</button>
          <button type="button" className="zoom-value" aria-label="恢复 100%" onClick={() => setViewport((current) => ({ ...current, zoom: 1 }))}>{Math.round(viewport.zoom * 100)}%</button>
          <button type="button" aria-label="放大画布" onClick={() => zoomAt(viewport.zoom * 1.15)}>+</button>
          <span />
          <button type="button" aria-pressed={minimapVisible} onClick={() => setMinimapOpen(!minimapVisible)}>缩略图</button>
          {scene.architecture ? <button type="button" aria-label="清晰阅读架构图主链" title="聚焦真实主业务链并放大节点文字；适配可返回全图" onClick={readArchitectureClearly}>主链</button> : null}
          <button type="button" aria-label="适配画布" onClick={fit}>适配</button>
        </div>
        {minimapVisible ? <svg className={`freeform-minimap${architectureScope ? ' is-scoped' : ''}`} aria-label={architectureScope ? '当前架构范围缩略图' : '画布缩略图'} viewBox={`${minimapViewBounds.x} ${minimapViewBounds.y} ${minimapViewBounds.width} ${minimapViewBounds.height}`} onPointerDown={recenterFromMinimap}>
          <rect x={minimapViewBounds.x} y={minimapViewBounds.y} width={minimapViewBounds.width} height={minimapViewBounds.height} className="freeform-minimap-bg" />
          {canvasPresentationGroupFrames(renderScene, displayGroupBounds).filter((group) => (
            group.collapsed
            && !groupHiddenByCollapsedAncestor(group.id, renderScene.groups ?? [])
          )).map((group) => <rect key={`group-${group.id}`} x={group.x} y={group.y} width={group.width} height={group.height} rx="12" className="freeform-minimap-group" />)}
          {compactMinimap ? <>
            {minimapNodeCloudPath ? <path d={minimapNodeCloudPath} className="freeform-minimap-node-cloud" /> : null}
            {renderBoxes.filter((item) => selectedIdSet.has(item.id)).map((item) => <rect key={item.id} x={item.x} y={item.y} width={item.width} height={item.height} rx="10" className="freeform-minimap-node is-selected" />)}
          </> : renderBoxes.map((item) => <rect key={item.id} x={item.x} y={item.y} width={item.width} height={item.height} rx="10" className={`freeform-minimap-node${selectedIdSet.has(item.id) ? ' is-selected' : ''}`} />)}
          <rect x={viewport.x} y={viewport.y} width={viewWidth} height={viewHeight} className="freeform-minimap-viewport" />
        </svg> : null}
      </div>
        {selected.length > 0 && !inspectorCollapsed && (drag.current?.kind !== 'move' || moveStartedWithInspector.current) ? (
          <div className={`freeform-inspector${detailsExpanded ? ' is-expanded' : ''}`} aria-label="选中元素属性">
            <div className="freeform-inspector-head">
              <div className="freeform-inspector-title">
                <strong>{selectedGroup ? selectedGroup.label || '边界' : selected.length === 1 ? elementLabel(selected[0]) : `${selected.length} 个元素`}</strong>
                {selectedBox?.locked ? <span className="freeform-inspector-badge">已锁定</span> : null}
                {selectedGroup?.c4Type ? <span className="freeform-inspector-badge">{c4Label(selectedGroup.c4Type)}</span> : selectedBox?.c4Type ? <span className="freeform-inspector-badge">{c4Label(selectedBox.c4Type)}</span> : null}
              </div>
              <div className="freeform-inspector-actions">
                {scene.architecture && selectedBox ? <button type="button" title="只查看当前节点及邻域" onClick={() => enterArchitectureScope({ kind: 'node', id: selectedBox.id, depth: 1 })}>聚焦</button> : null}
                {scene.architecture && selectedGroupId ? <button type="button" title="进入当前边界查看内部结构" onClick={() => enterArchitectureScope({ kind: 'group', id: selectedGroupId })}>下钻</button> : null}
                {selectedBox || selectedGroup ? <button type="button" aria-pressed={detailsExpanded} onClick={() => setDetailsExpanded((value) => !value)}>{detailsExpanded ? '收起详情' : '更多属性'}</button> : null}
                <div className="freeform-inspector-more">
                  <button type="button" title="更多操作" aria-label="更多操作" aria-expanded={inspectorMenuOpen} onClick={() => setInspectorMenuOpen((value) => !value)}>⋯</button>
                  {inspectorMenuOpen ? (
                    <div className="freeform-inspector-more-menu" role="menu">
                      {selectedBoxes.length ? <button type="button" role="menuitem" onClick={() => { smartLocalLayout(); setInspectorMenuOpen(false) }}>智能整理邻域</button> : null}
                      {selectedBoxes.length ? <button type="button" role="menuitem" onClick={() => { copySelection(); pasteSelection(); setInspectorMenuOpen(false) }}>复制一份</button> : null}
                      {selectedBoxes.length ? <button type="button" role="menuitem" onClick={() => { toggleSelectionLock(); setInspectorMenuOpen(false) }}>{selectedLocked.length === selectedBoxes.length ? '解锁' : '锁定'}</button> : null}
                      {selectedBoxes.length ? <button type="button" role="menuitem" onClick={() => { reorderSelection('front'); setInspectorMenuOpen(false) }}>移到最前</button> : null}
                      {selectedBoxes.length ? <button type="button" role="menuitem" onClick={() => { reorderSelection('back'); setInspectorMenuOpen(false) }}>移到最后</button> : null}
                      {selectedGroupIds.length ? <button type="button" role="menuitem" onClick={() => { ungroupSelection(); setInspectorMenuOpen(false) }}>取消组合</button> : null}
                      <span />
                      <button type="button" role="menuitem" className="is-danger" disabled={selectedBoxes.length > 0 && selectedLocked.length === selectedBoxes.length} onClick={() => { deleteSelected(); setInspectorMenuOpen(false) }}>删除选中</button>
                    </div>
                  ) : null}
                </div>
                <button type="button" aria-label="收起属性" title="收起属性" onClick={() => setInspectorCollapsed(true)}>×</button>
              </div>
            </div>
            {traceResult ? <div className="freeform-inspector-trace-status">依赖追踪 · {traceResult.nodeIds.length} 节点 · {traceResult.arrowIds.length} 关系 <button type="button" onClick={() => setTraceDirection(null)}>清除</button></div> : null}
            {selectedSingle?.type === 'arrow' ? (
              <>
                <label>
                  <span>连线文字</span>
                  <input aria-label="连线文字" value={selectedSingle.label ?? ''} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, label: event.target.value || undefined } : item)} />
                </label>
                <div className="freeform-section-caption">{selectedSingle.freehand ? '画笔' : '线条'}</div>
                <StyleColorControl label="颜色" value={selectedSingle.strokeColor} onChange={(value) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, strokeColor: value } : item)} />
                <div className="freeform-property-row">
                  <label><span>线型</span><select aria-label="连线线型" value={selectedSingle.lineStyle ?? 'solid'} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, lineStyle: event.target.value as CanvasLineStyle } : item)}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
                  <label><span>宽度</span><select aria-label="连线宽度" value={selectedSingle.strokeWidth ?? 2} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, strokeWidth: Number(event.target.value) } : item)}><option value={1}>细</option><option value={2}>标准</option><option value={3}>粗</option><option value={5}>强调</option></select></label>
                </div>
                {!selectedSingle.freehand ? <div className="freeform-property-row">
                  <label><span>路由</span><select aria-label="连线路由" value={selectedSingle.routing ?? 'straight'} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, routing: event.target.value as CanvasRouting } : item)}><option value="straight">直线</option><option value="orthogonal">折线</option></select></label>
                  <label><span>终点</span><select aria-label="连线终点样式" value={selectedSingle.markerEnd ?? (selectedSingle.start && selectedSingle.end ? 'none' : 'arrow')} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, markerEnd: event.target.value as 'none' | 'arrow' } : item)}><option value="none">无箭头</option><option value="arrow">箭头</option></select></label>
                </div> : null}
                <label className="freeform-style-range"><span>透明度</span><input aria-label="连线透明度" type="range" min="10" max="100" value={Math.round((selectedSingle.opacity ?? 1) * 100)} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, opacity: Number(event.target.value) / 100 } : item)} /><b>{Math.round((selectedSingle.opacity ?? 1) * 100)}</b></label>
                {selectedSingle.start && selectedSingle.end ? null : <div className="freeform-property-row">
                  <label><span>起点</span><select aria-label="连线起点锚点" value={selectedSingle.fromAnchor ?? 'auto'} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, fromAnchor: event.target.value as CanvasAnchor } : item)}>{anchorOptions()}</select></label>
                  <label><span>终点</span><select aria-label="连线终点锚点" value={selectedSingle.toAnchor ?? 'auto'} onChange={(event) => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, toAnchor: event.target.value as CanvasAnchor } : item)}>{anchorOptions()}</select></label>
                </div>}
                {!selectedSingle.freehand ? <div className="freeform-align-row">
                  <button type="button" onClick={() => addArrowPoint(selectedSingle)}>添加折点</button>
                  <button type="button" disabled={!selectedSingle.points?.length} onClick={() => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, points: undefined } : item)}>清除折点</button>
                </div> : null}
                {!selectedSingle.freehand ? <div className="freeform-align-row">
                  <button type="button" onClick={() => reverseSelectedArrow(selectedSingle.id)}>反转方向</button>
                  {selectedSingle.start && selectedSingle.end ? <button type="button" onClick={() => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, markerEnd: item.markerEnd === 'arrow' ? 'none' : 'arrow' } : item)}>切换箭头</button> : <button type="button" onClick={() => rerouteSelectedArrow(selectedSingle.id)}>重新路由</button>}
                </div> : null}
                {selectedSingle.start && selectedSingle.end ? null : <button type="button" onClick={() => insertNodeIntoArrow(selectedSingle)}>插入中间节点</button>}
                {selectedSingle.labelPosition ? <button type="button" onClick={() => updateElement(selectedSingle.id, (item) => item.type === 'arrow' ? { ...item, labelPosition: undefined } : item)}>标签恢复自动位置</button> : null}
              </>
            ) : null}
            {selectedBox ? (
              <>
                <div className="freeform-section-caption">基本</div>
                <label>
                  <span>{selectedImageBox ? '名称' : '文字'}</span>
                  <input
                    ref={textInputRef}
                    aria-label="选中元素文字"
                    value={selectedBox.text}
                    disabled={selectedBox.locked}
                    onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, text: event.target.value })}
                  />
                </label>
                {architectureWorkbench ? <label><span>副标题</span><input aria-label="节点副标题" disabled={selectedBox.locked} value={selectedBox.subtitle ?? ''} placeholder="例如：Spring Boot 4" onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, subtitle: event.target.value || undefined })} /></label> : null}
                {architectureWorkbench ? <>
                  <div className="freeform-section-caption">架构</div>

                  <label>
                    <span>节点角色</span>
                    <select aria-label="节点角色图标" disabled={selectedBox.locked} value={selectedBox.icon ?? ''} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, icon: (event.target.value || undefined) as CanvasIcon | undefined }))}>
                      <option value="">无</option><option value="user">用户</option><option value="web">Web / 前端</option><option value="api">API / 网关</option><option value="gateway">网关 / Proxy</option><option value="service">服务</option><option value="worker">Worker / Processor</option><option value="database">数据库</option><option value="cache">缓存</option><option value="queue">消息队列</option><option value="search">搜索 / 索引</option><option value="vector">向量检索</option><option value="cloud">云 / 平台</option><option value="file">文件 / 对象</option><option value="auth">认证 / 身份</option><option value="ai">AI / 模型</option><option value="mcp">MCP</option><option value="scheduler">调度 / 定时</option><option value="external">外部系统</option>
                    </select>
                  </label>
                  <label>
                    <span>技术栈</span>
                    <select aria-label="节点技术栈" disabled={selectedBox.locked} value={selectedBox.stencil ?? ''} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, stencil: (event.target.value || undefined) as CanvasStencil | undefined }))}>
                      <option value="">无</option><option value="spring">Spring</option><option value="react">React</option><option value="vue">Vue</option><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="redis">Redis</option><option value="kafka">Kafka</option><option value="rabbitmq">RabbitMQ</option><option value="docker">Docker</option><option value="kubernetes">Kubernetes</option><option value="qdrant">Qdrant</option><option value="opensearch">OpenSearch</option><option value="elasticsearch">Elasticsearch</option><option value="mongodb">MongoDB</option><option value="minio">MinIO / S3</option><option value="nginx">Nginx</option><option value="grpc">gRPC</option><option value="oidc">OIDC</option><option value="openai">LLM / OpenAI-compatible</option><option value="mcp">MCP</option>
                    </select>
                  </label>
                  <details className="freeform-optional-field">
                    <summary>图标 <span>{selectedBox.iconRef ? canvasIconRefLabel(selectedBox.iconRef) : '自动'}</span></summary>
                  <div className="freeform-icon-field">
                    <span>显示图标</span>
                    <button
                      type="button"
                      className="freeform-icon-field-trigger"
                      aria-expanded={iconPickerOpen}
                      disabled={selectedBox.locked}
                      onClick={() => setIconPickerOpen((value) => !value)}
                    >
                      {selectedBox.iconRef ? <IconRefGlyph refValue={selectedBox.iconRef} /> : <i className="is-auto">A</i>}
                      <strong>{selectedBox.iconRef ? canvasIconRefLabel(selectedBox.iconRef) : '自动（技术栈 / 角色）'}</strong>
                      <b>⌄</b>
                    </button>
                    {iconPickerOpen ? (
                      <div className="freeform-icon-picker" role="dialog" aria-label="选择节点图标">
                        <div className="freeform-icon-picker-search">
                          <input autoFocus value={iconPickerQuery} onChange={(event) => setIconPickerQuery(event.target.value)} placeholder="搜索图标" aria-label="搜索节点图标" />
                          <button type="button" className={!selectedBox.iconRef ? 'is-selected' : ''} onClick={() => { updateSelectedBoxes((item) => ({ ...item, iconRef: undefined })); setIconPickerOpen(false) }}>自动</button>
                        </div>
                        <div className="freeform-icon-source-tabs" aria-label="图标来源">
                          {ICON_SOURCE_OPTIONS.map(([value, label]) => (
                            <button key={value} type="button" className={iconPickerSource === value ? 'is-selected' : ''} onClick={() => setIconPickerSource(value)}>{label}</button>
                          ))}
                        </div>
                        <div className="freeform-icon-grid">
                          {iconPickerEntries.map((entry) => (
                            <button
                              key={entry.ref}
                              type="button"
                              title={`${entry.source === 'role' ? '语义' : entry.source === 'simple' ? '品牌' : entry.source === 'lucide' ? 'Lucide' : entry.source.toUpperCase()} · ${entry.label}`}
                              className={selectedBox.iconRef === entry.ref ? 'is-selected' : ''}
                              onClick={() => { updateSelectedBoxes((item) => ({ ...item, iconRef: entry.ref })); setIconPickerOpen(false) }}
                            >
                              <IconRefGlyph refValue={entry.ref} />
                              <span>{entry.label}</span>
                            </button>
                          ))}
                          {!iconPickerEntries.length ? <p>没有匹配图标</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>                  </details>
                </> : null}
                {!architectureWorkbench ? <>
                  <div className="freeform-size-row">
                    <label><span>W</span><input aria-label="元素宽度" type="number" min="100" disabled={selectedBox.locked} value={Math.round(selectedBox.width)} onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, width: Math.max(100, Number(event.target.value) || 100) })} /></label>
                    <label><span>H</span><input aria-label="元素高度" type="number" min="60" disabled={selectedBox.locked} value={Math.round(selectedBox.height)} onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, height: Math.max(60, Number(event.target.value) || 60) })} /></label>
                  </div>
                  <label><span>旋转</span><input aria-label="元素旋转角度" type="number" min="-180" max="180" disabled={selectedBox.locked} value={Math.round(selectedBox.rotation ?? 0)} onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, rotation: clamp(Number(event.target.value) || 0, -180, 180) || undefined })} /></label>
                  {selectedImageBox ? <>
                    <div className="freeform-section-caption">图片</div>
                    <label><span>适配</span><select aria-label="图片适配方式" disabled={selectedImageBox.locked} value={selectedImageBox.imageFit ?? 'contain'} onChange={(event) => updateElement(selectedImageBox.id, (item) => item.type === 'note' ? { ...item, imageFit: event.target.value as 'contain' | 'cover' } : item)}><option value="contain">完整显示</option><option value="cover">铺满裁切</option></select></label>
                    <StyleColorControl label="边框" value={selectedImageBox.strokeColor} onChange={(value) => updateElement(selectedImageBox.id, (item) => item.type === 'note' ? { ...item, strokeColor: value } : item)} />
                    <div className="freeform-property-row">
                      <label><span>边框宽度</span><select aria-label="图片边框宽度" disabled={selectedImageBox.locked} value={selectedImageBox.strokeWidth ?? 1} onChange={(event) => updateElement(selectedImageBox.id, (item) => item.type === 'note' ? { ...item, strokeWidth: Number(event.target.value) } : item)}><option value={1}>细</option><option value={2}>标准</option><option value={3}>粗</option><option value={5}>强调</option></select></label>
                      <label><span>圆角</span><input aria-label="图片圆角" type="number" min="0" max="80" disabled={selectedImageBox.locked} value={selectedImageBox.cornerRadius ?? 8} onChange={(event) => updateElement(selectedImageBox.id, (item) => item.type === 'note' ? { ...item, cornerRadius: Math.max(0, Math.min(80, Number(event.target.value) || 0)) } : item)} /></label>
                    </div>
                    <label className="freeform-style-range"><span>透明度</span><input aria-label="元素透明度" type="range" min="10" max="100" disabled={selectedImageBox.locked} value={Math.round((selectedImageBox.opacity ?? 1) * 100)} onChange={(event) => updateElement(selectedImageBox.id, (item) => item.type === 'note' ? { ...item, opacity: Number(event.target.value) / 100 } : item)} /><b>{Math.round((selectedImageBox.opacity ?? 1) * 100)}</b></label>
                  </> : selectedTextBox ? <>
                    <div className="freeform-section-caption">文字样式</div>
                    <StyleColorControl label="文字颜色" value={selectedTextBox.textColor} onChange={(value) => updateElement(selectedTextBox.id, (item) => item.type === 'note' ? { ...item, textColor: value } : item)} />
                    <div className="freeform-property-row">
                      <label><span>字号</span><input aria-label="文字字号" type="number" min="8" max="96" disabled={selectedTextBox.locked} value={selectedTextBox.fontSize ?? 20} onChange={(event) => updateElement(selectedTextBox.id, (item) => item.type === 'note' ? { ...item, fontSize: Math.max(8, Math.min(96, Number(event.target.value) || 20)) } : item)} /></label>
                      <label><span>字重</span><select aria-label="文字字重" disabled={selectedTextBox.locked} value={selectedTextBox.fontWeight ?? 500} onChange={(event) => updateElement(selectedTextBox.id, (item) => item.type === 'note' ? { ...item, fontWeight: Number(event.target.value) as 400 | 500 | 600 | 700 } : item)}><option value={400}>常规</option><option value={500}>中等</option><option value={600}>半粗</option><option value={700}>粗体</option></select></label>
                    </div>
                    <label className="freeform-style-range"><span>透明度</span><input aria-label="元素透明度" type="range" min="10" max="100" disabled={selectedTextBox.locked} value={Math.round((selectedTextBox.opacity ?? 1) * 100)} onChange={(event) => updateElement(selectedTextBox.id, (item) => item.type === 'note' ? { ...item, opacity: Number(event.target.value) / 100 } : item)} /><b>{Math.round((selectedTextBox.opacity ?? 1) * 100)}</b></label>
                  </> : <>
                    <div className="freeform-property-row">
                      <label><span>色调</span><select aria-label="元素色调" disabled={selectedBox.locked} value={selectedBox.tone ?? 'default'} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, tone: event.target.value as CanvasTone }))}><option value="default">默认</option><option value="accent">强调</option><option value="success">成功</option><option value="warning">警告</option><option value="danger">危险</option><option value="muted">弱化</option></select></label>
                      <label><span>图形</span><select aria-label="元素图形" disabled={selectedBox.locked} value={selectedBox.shapeRef ?? ''} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, shapeRef: (event.target.value || undefined) as CanvasShapeRef | undefined, shape: event.target.value ? undefined : item.shape }))}><option value="">兼容旧形状</option>{CANVAS_SHAPE_CATALOG.filter((shape) => shapeLibraryPacks.includes(shape.pack)).map((shape) => <option key={shape.ref} value={shape.ref}>{shape.label}</option>)}</select></label>
                    </div>
                    <div className="freeform-section-caption">样式</div>
                    <StyleColorControl label="填充" value={selectedBox.fillColor} onChange={(value) => updateSelectedBoxes((item) => ({ ...item, fillColor: value }))} />
                    <StyleColorControl label="描边" value={selectedBox.strokeColor} onChange={(value) => updateSelectedBoxes((item) => ({ ...item, strokeColor: value }))} />
                    <div className="freeform-property-row">
                      <label><span>描边宽度</span><select aria-label="元素描边宽度" disabled={selectedBox.locked} value={selectedBox.strokeWidth ?? 1.6} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, strokeWidth: Number(event.target.value) }))}><option value={1}>细</option><option value={1.6}>标准</option><option value={2.5}>粗</option><option value={4}>强调</option></select></label>
                      <label><span>圆角</span><input aria-label="元素圆角" type="number" min="0" max="80" disabled={selectedBox.locked || !(!selectedBox.shapeRef || selectedBox.shapeRef === 'basic:rectangle' || selectedBox.shapeRef === 'basic:rounded' || selectedBox.shapeRef === 'flowchart:process')} value={selectedBox.cornerRadius ?? (selectedBox.shapeRef === 'basic:rounded' ? 16 : 0)} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, cornerRadius: Math.max(0, Math.min(80, Number(event.target.value) || 0)) }))} /></label>
                    </div>
                    <label className="freeform-style-range"><span>透明度</span><input aria-label="元素透明度" type="range" min="10" max="100" disabled={selectedBox.locked} value={Math.round((selectedBox.opacity ?? 1) * 100)} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, opacity: Number(event.target.value) / 100 }))} /><b>{Math.round((selectedBox.opacity ?? 1) * 100)}</b></label>
                  </>}
                  <div className="freeform-style-layer-row" aria-label="图层">
                    <span>图层</span>
                    <div><button type="button" title="置底" onClick={() => reorderSelection('back')}>置底</button><button type="button" title="下移一层" onClick={() => reorderSelection('backward')}>下移</button><button type="button" title="上移一层" onClick={() => reorderSelection('forward')}>上移</button><button type="button" title="置顶" onClick={() => reorderSelection('front')}>置顶</button></div>
                  </div>
                </> : null}
                {detailsExpanded ? (
                  <>
                    {architectureWorkbench ? <>
                  <label>
                    <span>C4 语义</span>
                    <select aria-label="C4 语义" disabled={selectedBox.locked} value={selectedBox.c4Type ?? ''} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, c4Type: (event.target.value || undefined) as CanvasC4Type | undefined }))}>
                      <option value="">未指定</option><option value="person">Person</option><option value="software-system">Software System</option><option value="container">Container</option><option value="component">Component</option>
                    </select>
                  </label>
                    </> : null}
                    {!architectureWorkbench ? <label><span>副标题</span><input aria-label="节点副标题" disabled={selectedBox.locked} value={selectedBox.subtitle ?? ''} placeholder="例如：Spring Boot 4" onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, subtitle: event.target.value || undefined })} /></label> : null}
                    <label>
                      <span>说明</span>
                      <textarea aria-label="节点说明" disabled={selectedBox.locked} value={selectedBox.description ?? ''} placeholder="职责、边界、风险或实现备注" onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, description: event.target.value || undefined })} />
                    </label>
                    <label>
                      <span>标签</span>
                      <input aria-label="节点标签" disabled={selectedBox.locked} value={selectedBox.tags?.join(', ') ?? ''} placeholder="核心, 外部, 异步" onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, tags: splitTags(event.target.value) })} />
                    </label>
                    {scene.lanes?.length ? (
                      <label>
                        <span>泳道</span>
                        <select aria-label="节点泳道" disabled={selectedBox.locked} value={selectedBox.laneId ?? ''} onChange={(event) => assignSelectionLane(event.target.value || undefined)}>
                          <option value="">未分配</option>
                          {scene.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {selectedLane ? (
                      <div className="freeform-lane-inspector">
                        <div className="freeform-section-caption">当前泳道</div>
                        <label><span>名称</span><input value={selectedLane.label} onChange={(event) => commit(updateCanvasLane(currentScene(), selectedLane.id, { label: event.target.value || selectedLane.label }))} /></label>
                        <label><span>色调</span><select value={selectedLane.tone ?? 'muted'} onChange={(event) => commit(updateCanvasLane(currentScene(), selectedLane.id, { tone: event.target.value as CanvasTone }))}><option value="default">默认</option><option value="accent">强调</option><option value="success">成功</option><option value="warning">警告</option><option value="danger">危险</option><option value="muted">弱化</option></select></label>
                      </div>
                    ) : null}
                    <label>
                      <span>关联源码</span>
                      <div className="freeform-source-picker">
                        <input
                          aria-label="搜索关联源码"
                          disabled={selectedBox.locked}
                          value={sourceLinkQuery}
                          placeholder="搜索当前工作区源码"
                          onChange={(event) => setSourceLinkQuery(event.target.value)}
                        />
                        {sourceLinkError ? <div className="freeform-source-error" role="alert">{sourceLinkError}</div> : null}
                        {sourceLinkLoading || sourceLinkOptions.length ? (
                          <div className="freeform-source-options">
                            {sourceLinkLoading ? <span>搜索中…</span> : null}
                            {!sourceLinkLoading ? sourceLinkOptions.map((path) => (
                              <button
                                type="button"
                                key={path}
                                title={path}
                                onClick={() => {
                                  updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, sourcePaths: [...new Set([...(item.sourcePaths ?? []), path])] })
                                  setSourceLinkQuery('')
                                  setSourceLinkOptions([])
                                }}
                              >{shortSourcePath(path)}</button>
                            )) : null}
                          </div>
                        ) : null}
                      </div>
                    </label>
                    {selectedBox.sourcePaths?.length ? (
                      <div className="freeform-source-links">
                        {selectedBox.sourcePaths.map((path) => (
                          <span key={path} className="freeform-source-link">
                            <button type="button" title={path} onClick={() => onOpenSource?.(path)}>{shortSourcePath(path)}</button>
                            {!selectedBox.locked ? <button type="button" aria-label={`移除 ${path}`} onClick={() => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, sourcePaths: item.sourcePaths?.filter((candidate) => candidate !== path) })}>×</button> : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {scene.architecture ? <>
                      <div className="freeform-section-caption">外观</div>
                      <div className="freeform-size-row">
                        <label><span>W</span><input aria-label="元素宽度" type="number" min="100" disabled={selectedBox.locked} value={Math.round(selectedBox.width)} onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, width: Math.max(100, Number(event.target.value) || 100) })} /></label>
                        <label><span>H</span><input aria-label="元素高度" type="number" min="60" disabled={selectedBox.locked} value={Math.round(selectedBox.height)} onChange={(event) => updateElement(selectedBox.id, (item) => item.type === 'arrow' || item.locked ? item : { ...item, height: Math.max(60, Number(event.target.value) || 60) })} /></label>
                      </div>
                      <div className="freeform-property-row">
                        <label><span>色调</span><select aria-label="元素色调" disabled={selectedBox.locked} value={selectedBox.tone ?? 'default'} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, tone: event.target.value as CanvasTone }))}><option value="default">默认</option><option value="accent">强调</option><option value="success">成功</option><option value="warning">警告</option><option value="danger">危险</option><option value="muted">弱化</option></select></label>
                        <label><span>形状</span><select aria-label="元素形状" disabled={selectedBox.locked} value={selectedBox.shape ?? 'rounded'} onChange={(event) => updateSelectedBoxes((item) => ({ ...item, shape: event.target.value as CanvasShape }))}><option value="rounded">圆角</option><option value="square">方形</option><option value="pill">胶囊</option></select></label>
                      </div>
                    </> : null}
                  </>
                ) : null}
              </>
            ) : null}
            {selectedGroup ? (
              <div className="freeform-group-inspector">
                <div className="freeform-section-caption">边界</div>
                <label>
                  <span>名称</span>
                  <input aria-label="组合名称" value={selectedGroup.label ?? ''} placeholder="例如：订单域" onChange={(event) => updateSelectedGroup({ label: event.target.value || undefined })} />
                </label>
                <div className="freeform-property-row">
                  <label>
                    <span>类型</span>
                    <select aria-label="组合边界类型" value={selectedGroup.kind ?? 'group'} onChange={(event) => updateSelectedGroup({ kind: event.target.value as 'group' | 'boundary' })}>
                      <option value="group">普通容器</option><option value="boundary">系统边界</option>
                    </select>
                  </label>
                  <label>
                    <span>C4 层级</span>
                    <select aria-label="容器 C4 层级" value={selectedGroup.c4Type ?? ''} onChange={(event) => updateSelectedGroup({ c4Type: (event.target.value || undefined) as 'software-system' | 'container' | undefined })}>
                      <option value="">未指定</option><option value="software-system">Software System</option><option value="container">Container</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>父边界</span>
                  <select aria-label="父边界" value={selectedGroup.parentId ?? ''} onChange={(event) => {
                    if (!selectedGroupId) return
                    commit(setCanvasGroupParent(currentScene(), selectedGroupId, event.target.value || undefined))
                  }}>
                    <option value="">顶层</option>
                    {(scene.groups ?? []).filter((group) => group.id !== selectedGroup.id).map((group) => <option key={group.id} value={group.id}>{group.label || group.id}</option>)}
                  </select>
                </label>
                {detailsExpanded ? (
                  <>
                    <label>
                      <span>边界说明</span>
                      <textarea aria-label="边界说明" value={selectedGroup.description ?? ''} placeholder="系统职责、边界约束或部署范围" onChange={(event) => updateSelectedGroup({ description: event.target.value || undefined })} />
                    </label>
                    <div className="freeform-section-caption">外观</div>
                    <label>
                      <span>色调</span>
                      <select aria-label="组合色调" value={selectedGroup.tone ?? 'muted'} onChange={(event) => updateSelectedGroup({ tone: event.target.value as CanvasTone })}>
                        <option value="default">默认</option><option value="accent">强调</option><option value="success">成功</option><option value="warning">警告</option><option value="danger">危险</option><option value="muted">弱化</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <div className="freeform-property-row">
                  <select aria-label="容器局部布局" defaultValue="" onChange={(event) => { const value = event.target.value as CanvasLayoutMode | ''; if (value === 'horizontal' || value === 'vertical') applyLocalLayout(value); event.currentTarget.value = '' }}>
                    <option value="">局部布局…</option><option value="horizontal">横向</option><option value="vertical">纵向</option>
                  </select>
                  <button type="button" onClick={toggleSelectedGroupCollapsed}>{selectedGroup.collapsed ? '展开容器' : '折叠容器'}</button>
                </div>
              </div>
            ) : null}
            {selected.length > 1 && !selectedGroup ? (
              <>
                {!architectureWorkbench && batchStyleBoxes.length > 1 ? <>
                  <div className="freeform-section-caption">批量样式</div>
                  <StyleColorControl
                    label="填充"
                    value={batchFillColor}
                    mixed={batchFillValues.size > 1}
                    onChange={(value) => updateSelectedBoxes((item) => item.type === 'note' && item.textOnly ? item : { ...item, fillColor: value })}
                  />
                  <StyleColorControl
                    label="描边"
                    value={batchStrokeColor}
                    mixed={batchStrokeValues.size > 1}
                    onChange={(value) => updateSelectedBoxes((item) => item.type === 'note' && item.textOnly ? item : { ...item, strokeColor: value })}
                  />
                  <div className="freeform-property-row">
                    <label><span>描边宽度{batchStrokeWidth === undefined ? ' · 混合' : ''}</span><select aria-label="批量描边宽度" value={batchStrokeWidth ?? ''} onChange={(event) => updateSelectedBoxes((item) => item.type === 'note' && item.textOnly ? item : { ...item, strokeWidth: Number(event.target.value) })}><option value="" disabled>混合</option><option value={1}>细</option><option value={1.6}>标准</option><option value={2.5}>粗</option><option value={4}>强调</option></select></label>
                    <label className="freeform-style-range"><span>透明度</span><input aria-label="批量透明度" type="range" min="10" max="100" value={Math.round((batchOpacity ?? 1) * 100)} onChange={(event) => updateSelectedBoxes((item) => item.type === 'note' && item.textOnly ? item : { ...item, opacity: Number(event.target.value) / 100 })} /><b>{batchOpacity === undefined ? '混合' : Math.round(batchOpacity * 100)}</b></label>
                  </div>
                </> : null}
                <div className="freeform-multi-actions">
                  <select aria-label="对齐选中元素" defaultValue="" onChange={(event) => { const value = event.target.value; if (value === 'x') alignSelection('x'); if (value === 'y') alignSelection('y'); event.currentTarget.value = '' }}>
                    <option value="">对齐…</option><option value="x">垂直对齐</option><option value="y">水平对齐</option>
                  </select>
                  <select aria-label="分布选中元素" defaultValue="" onChange={(event) => { const value = event.target.value; if (value === 'x') distributeSelection('x'); if (value === 'y') distributeSelection('y'); event.currentTarget.value = '' }}>
                    <option value="">分布…</option><option value="x">水平分布</option><option value="y">垂直分布</option>
                  </select>
                  <select aria-label="局部布局" defaultValue="" onChange={(event) => { const value = event.target.value as CanvasLayoutMode | ''; if (value === 'horizontal' || value === 'vertical') applyLocalLayout(value); event.currentTarget.value = '' }}>
                    <option value="">布局…</option><option value="horizontal">局部横向</option><option value="vertical">局部纵向</option>
                  </select>
                </div>
                <div className="freeform-align-row">
                  <button type="button" disabled={selectedBoxes.length < 2} onClick={groupSelection}>组合</button>
                  <button type="button" disabled={selectedGroupIds.length === 0} onClick={ungroupSelection}>取消组合</button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

    </div>
  )
}

function ToolButton({ active, title, disabled = false, onClick, children }: { active: boolean; title: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={active ? 'is-active' : ''} title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button>
}

function center(item: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 }
}

function canvasBoxesBounds(items: Array<Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>>): CanvasTransformBox {
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const right = Math.max(...items.map((item) => item.x + item.width))
  const bottom = Math.max(...items.map((item) => item.y + item.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function canvasResizeHandlePoint(handle: CanvasResizeHandle, width: number, height: number): CanvasPoint {
  return {
    x: handle.includes('w') ? 0 : handle.includes('e') ? width : width / 2,
    y: handle.includes('n') ? 0 : handle.includes('s') ? height : height / 2,
  }
}

function pathLabelPoint(start: CanvasPoint, end: CanvasPoint, points?: CanvasPoint[]): CanvasPoint {
  if (!points?.length) return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const path = [start, ...points, end]
  const middle = Math.floor((path.length - 1) / 2)
  return { x: (path[middle].x + path[middle + 1].x) / 2, y: (path[middle].y + path[middle + 1].y) / 2 }
}

function groupDepth(groupId: string, groups: CanvasGroup[]): number {
  const byId = new Map(groups.map((group) => [group.id, group]))
  let depth = 0
  let current = byId.get(groupId)?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    depth += 1
    current = byId.get(current)?.parentId
  }
  return Math.min(depth, 6)
}

function groupHiddenByCollapsedAncestor(groupId: string, groups: CanvasGroup[]): boolean {
  const byId = new Map(groups.map((group) => [group.id, group]))
  let current = byId.get(groupId)?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const group = byId.get(current)
    if (!group) return false
    if (group.collapsed) return true
    current = group.parentId
  }
  return false
}

function anchorOptions() {
  return <>
    <option value="auto">自动</option>
    <option value="top">上</option>
    <option value="right">右</option>
    <option value="bottom">下</option>
    <option value="left">左</option>
  </>
}

function shortSourcePath(value: string) {
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
}

function splitTags(value: string): string[] | undefined {
  const tags = [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12)
  return tags.length ? tags : undefined
}

function scenePoint(clientX: number, clientY: number, svg: SVGSVGElement, scene: CanvasScene, viewport: Viewport) {
  const matrix = svg.getScreenCTM()
  if (matrix) {
    // viewBox 比例恒等于画布比例，面板比例不同时 SVG 会按 xMidYMid meet 留出黑边，
    // 线性换算会忽略这段偏移。用屏幕矩阵反算才能得到真实画布坐标。
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }
  const bounds = svg.getBoundingClientRect()
  return {
    x: viewport.x + ((clientX - bounds.left) / Math.max(1, bounds.width)) * (scene.width / viewport.zoom),
    y: viewport.y + ((clientY - bounds.top) / Math.max(1, bounds.height)) * (scene.height / viewport.zoom),
  }
}

function normalizeRect(value: SelectionRect) {
  const x = Math.min(value.x1, value.x2)
  const y = Math.min(value.y1, value.y2)
  return { x, y, width: Math.abs(value.x2 - value.x1), height: Math.abs(value.y2 - value.y1) }
}

function intersects(rect: { x: number; y: number; width: number; height: number }, item: { x: number; y: number; width: number; height: number }) {
  return item.x < rect.x + rect.width && item.x + item.width > rect.x && item.y < rect.y + rect.height && item.y + item.height > rect.y
}

function rectanglesOverlapWithPadding(
  left: Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>,
  right: Pick<CanvasNode | CanvasNote, 'x' | 'y' | 'width' | 'height'>,
  padding: number,
) {
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y
}

function semanticLodAllowsArrowLabel(level: CanvasSemanticLodLevel, arrow: CanvasArrow, selected: Set<string>): boolean {
  if (level === 'detail' || selected.has(arrow.id)) return true
  if (level === 'compact') return arrow.emphasis !== 'muted' || Boolean(arrow.labelPosition)
  if (level === 'overview') return arrow.emphasis === 'primary' || Boolean(arrow.labelPosition)
  return false
}

function nearestValue(value: number, targets: number[], threshold: number): number | undefined {
  let best: { value: number; distance: number } | undefined
  for (const target of targets) {
    const distance = Math.abs(target - value)
    if (distance > threshold || (best && distance >= best.distance)) continue
    best = { value: target, distance }
  }
  return best?.value
}

function nearestNodeAnchor(
  scene: CanvasScene,
  point: CanvasPoint,
  excludedIds: Set<string>,
  threshold: number,
): { nodeId: string; anchor: Exclude<CanvasAnchor, 'auto'>; point: CanvasPoint } | null {
  let best: { nodeId: string; anchor: Exclude<CanvasAnchor, 'auto'>; point: CanvasPoint; distance: number } | null = null
  for (const node of scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && !excludedIds.has(item.id))) {
    const toward = center(node)
    const anchors: Array<{ anchor: Exclude<CanvasAnchor, 'auto'>; point: CanvasPoint }> = [
      { anchor: 'top', point: anchorPoint(node, 'top', toward) },
      { anchor: 'right', point: anchorPoint(node, 'right', toward) },
      { anchor: 'bottom', point: anchorPoint(node, 'bottom', toward) },
      { anchor: 'left', point: anchorPoint(node, 'left', toward) },
    ]
    for (const candidate of anchors) {
      const distance = Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y)
      if (distance > threshold || (best && distance >= best.distance)) continue
      best = { nodeId: node.id, anchor: candidate.anchor, point: candidate.point, distance }
    }
  }
  return best ? { nodeId: best.nodeId, anchor: best.anchor, point: best.point } : null
}

function nearestArrowTarget(scene: CanvasScene, point: CanvasPoint, excludedNodeIds: Set<string>, threshold: number): { arrowId: string; point: CanvasPoint } | null {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  let best: { arrowId: string; point: CanvasPoint; distance: number } | null = null
  for (const arrow of scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')) {
    if (excludedNodeIds.has(arrow.from) || excludedNodeIds.has(arrow.to)) continue
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    if (!from || !to) continue
    const fromCenter = center(from)
    const toCenter = center(to)
    const start = anchorPoint(from, arrow.fromAnchor, arrow.points?.[0] ?? toCenter)
    const end = anchorPoint(to, arrow.toAnchor, arrow.points?.at(-1) ?? fromCenter)
    const route = canvasArrowRoutePoints(start, end, arrow)
    for (let index = 0; index < route.length - 1; index += 1) {
      const closest = closestPointOnSegment(point, route[index], route[index + 1])
      const distance = Math.hypot(closest.x - point.x, closest.y - point.y)
      if (distance > threshold || (best && distance >= best.distance)) continue
      best = { arrowId: arrow.id, point: closest, distance }
    }
  }
  return best ? { arrowId: best.arrowId, point: best.point } : null
}

function closestPointOnSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint): CanvasPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 0.0001) return start
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1)
  return { x: start.x + dx * t, y: start.y + dy * t }
}

function polylineMidpoint(points: CanvasPoint[]): CanvasPoint {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1]
    return { point, next, length: Math.hypot(next.x - point.x, next.y - point.y) }
  })
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (total <= 0.0001) return points[0]
  let remaining = total / 2
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length <= 0.0001 ? 0 : remaining / segment.length
      return {
        x: segment.point.x + (segment.next.x - segment.point.x) * ratio,
        y: segment.point.y + (segment.next.y - segment.point.y) * ratio,
      }
    }
    remaining -= segment.length
  }
  return points.at(-1)!
}

function snap(value: number) {
  return Math.round(value / GRID) * GRID
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

function truncate(value: string, max: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function elementLabel(item: CanvasElement) {
  if (item.type === 'arrow') {
    if (item.freehand) return '笔迹'
    if (item.start && item.end) return item.markerEnd === 'arrow' ? '箭头' : '直线'
    return '连接'
  }
  if (item.type === 'note') return item.imagePath ? '图片' : item.textOnly ? '文字' : '备注'
  return '节点'
}
