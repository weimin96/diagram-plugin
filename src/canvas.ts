import { canvasVisualSkin, canvasStyledBox, canvasFillTextColor, isDiagramVisualStyle, type DiagramVisualStyle } from './diagramVisualStyles.js'
import { hexLuminance } from './colors.js'
import { canvasArrowLabelText } from './canvasLabelText.js'
import { CanvasRectIndex } from './canvasRectIndex.js'
import {
  CANVAS_ROLE_ICON_IDS,
  CANVAS_STENCIL_IDS,
  canvasIconRefLabel as registryIconRefLabel,
  canvasLucideIcon,
  canvasSimpleIcon,
  isCanvasIconRef,
  type CanvasIconRef as RegistryIconRef,
  type CanvasLucideIconId,
  type CanvasRoleIconId,
  type CanvasStencilId,
} from './iconRegistry.js'
import { cloudArchitectureIconData } from './cloudIconPacks.js'
import { canvasShapeGeometry, isCanvasShapeRef, type CanvasShapeRef } from './shapeRegistry.js'

export type CanvasElement = CanvasNode | CanvasNote | CanvasArrow
export type CanvasTone = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'
export type CanvasShape = 'rounded' | 'square' | 'pill'
export type CanvasLineStyle = 'solid' | 'dashed' | 'dotted'
export type CanvasMarkerEnd = 'none' | 'arrow'
export type CanvasImageFit = 'contain' | 'cover'
export type CanvasEmphasis = 'primary' | 'secondary' | 'muted'
export type CanvasRouting = 'straight' | 'orthogonal'
export type CanvasAnchor = 'auto' | 'top' | 'right' | 'bottom' | 'left'
export type CanvasArchitectureTheme = 'enterprise' | 'technical' | 'presentation' | 'cloud' | 'editorial' | 'sketch'
export type CanvasArchitectureView = 'overview' | 'detail'
export type CanvasArchitectureDensity = 'auto' | 'comfortable' | 'compact' | 'dense'
export type CanvasArchitectureScenario = 'enterprise-system' | 'microservices' | 'data-platform' | 'ai-agent' | 'deployment'
export type CanvasWorkbenchMode = 'freeform' | 'architecture' | 'flowchart'
export type CanvasArchitectureCardKind = 'actor' | 'entry' | 'compute' | 'messaging' | 'data' | 'external' | 'generic'
export type CanvasArchitectureScopeKind = 'group' | 'lane' | 'node'
export type CanvasIcon = CanvasRoleIconId
export type CanvasStencil = CanvasStencilId
export type CanvasIconRef = RegistryIconRef
export type CanvasGroupKind = 'group' | 'boundary'
export type CanvasLaneAxis = 'horizontal' | 'vertical'
export type CanvasC4Type = 'person' | 'software-system' | 'container' | 'component'
export interface CanvasPoint { x: number; y: number }

export interface CanvasGroup {
  id: string
  label?: string
  tone?: CanvasTone
  kind?: CanvasGroupKind
  collapsed?: boolean
  parentId?: string
  c4Type?: 'software-system' | 'container'
  description?: string
}

export interface CanvasLane {
  id: string
  label: string
  axis: CanvasLaneAxis
  start: number
  size: number
  tone?: CanvasTone
}

/** 写入磁盘的 Canvas 文档类型。 */
export const CANVAS_DOCUMENT_TYPE = 'diagram-plugin-canvas'
/** 改名前的文档类型；只用于读取，保证旧图仍能打开。 */
export const LEGACY_CANVAS_DOCUMENT_TYPE = 'codex-diagram-canvas'

export interface CanvasScene {
  type: typeof CANVAS_DOCUMENT_TYPE
  version: 1
  title: string
  width: number
  height: number
  elements: CanvasElement[]
  workbench?: CanvasWorkbenchMode
  style?: DiagramVisualStyle
  groups?: CanvasGroup[]
  lanes?: CanvasLane[]
  architecture?: {
    theme: CanvasArchitectureTheme
    presentation?: boolean
    view?: CanvasArchitectureView
    density?: CanvasArchitectureDensity
    /** Optional font boost for generated architecture diagrams; legacy files remain unchanged. */
    titleScale?: number
    /** Explicit author intent; distinct from the geometry engine's layout choice. */
    scenario?: CanvasArchitectureScenario
  }
}

export interface CanvasNode {
  id: string
  type: 'node'
  x: number
  y: number
  width: number
  height: number
  text: string
  tone?: CanvasTone
  shape?: CanvasShape
  shapeRef?: CanvasShapeRef
  locked?: boolean
  groupId?: string
  sourcePaths?: string[]
  icon?: CanvasIcon
  stencil?: CanvasStencil
  iconRef?: CanvasIconRef
  subtitle?: string
  description?: string
  tags?: string[]
  laneId?: string
  c4Type?: CanvasC4Type
  emphasis?: CanvasEmphasis
  fillColor?: string
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
  cornerRadius?: number
  rotation?: number
}

export interface CanvasNote {
  id: string
  type: 'note'
  x: number
  y: number
  width: number
  height: number
  text: string
  tone?: CanvasTone
  shape?: CanvasShape
  shapeRef?: CanvasShapeRef
  locked?: boolean
  groupId?: string
  sourcePaths?: string[]
  icon?: CanvasIcon
  stencil?: CanvasStencil
  iconRef?: CanvasIconRef
  subtitle?: string
  description?: string
  tags?: string[]
  laneId?: string
  c4Type?: CanvasC4Type
  emphasis?: CanvasEmphasis
  fillColor?: string
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
  cornerRadius?: number
  rotation?: number
  textOnly?: boolean
  fontSize?: number
  fontWeight?: 400 | 500 | 600 | 700
  textColor?: string
  imagePath?: string
  imageFit?: CanvasImageFit
}

export interface CanvasArrow {
  id: string
  type: 'arrow'
  from: string
  to: string
  label?: string
  lineStyle?: CanvasLineStyle
  routing?: CanvasRouting
  fromAnchor?: CanvasAnchor
  toAnchor?: CanvasAnchor
  points?: CanvasPoint[]
  labelPosition?: CanvasPoint
  emphasis?: CanvasEmphasis
  bundleKey?: string
  start?: CanvasPoint
  end?: CanvasPoint
  markerEnd?: CanvasMarkerEnd
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
  freehand?: boolean
}

export interface CanvasGroupFrame extends CanvasGroup {
  x: number
  y: number
  width: number
  height: number
  memberIds: string[]
}

export interface CanvasCollapsedConnection {
  id: string
  fromKey: string
  toKey: string
  fromBox: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>
  toBox: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>
  count: number
  labels: string[]
  lineStyle?: CanvasLineStyle
  routing?: CanvasRouting
  fromAnchor?: CanvasAnchor
  toAnchor?: CanvasAnchor
}

export interface CanvasBundleTrunk {
  id: string
  path: string
  emphasis?: CanvasEmphasis
  count: number
}

/**
 * The genuinely shared prefix of two orthogonal routes from the same source.
 * The remainder is returned separately so callers can reject routes that
 * split and then unexpectedly overlap again.
 */
export function canvasSharedSourceStem(left: CanvasPoint[], right: CanvasPoint[]): {
  trunk: CanvasPoint[]
  leftTail: CanvasPoint[]
  rightTail: CanvasPoint[]
} | undefined {
  if (left.length < 3 || right.length < 3
    || left[0].x !== right[0].x || left[0].y !== right[0].y) return undefined
  let i = 1
  let j = 1
  let current = left[0]
  const trunk = [current]
  let totalLength = 0
  while (i < left.length && j < right.length) {
    const a = left[i], b = right[j]
    const deltaA = { x: a.x - current.x, y: a.y - current.y }
    const deltaB = { x: b.x - current.x, y: b.y - current.y }
    const lengthA = Math.abs(deltaA.x) + Math.abs(deltaA.y)
    const lengthB = Math.abs(deltaB.x) + Math.abs(deltaB.y)
    if (!lengthA) { i += 1; continue }
    if (!lengthB) { j += 1; continue }
    if ((deltaA.x && deltaA.y) || (deltaB.x && deltaB.y)) break
    const signA = [Math.sign(deltaA.x), Math.sign(deltaA.y)]
    const signB = [Math.sign(deltaB.x), Math.sign(deltaB.y)]
    if (signA[0] !== signB[0] || signA[1] !== signB[1]) break
    const distance = Math.min(lengthA, lengthB)
    current = { x: current.x + signA[0] * distance, y: current.y + signA[1] * distance }
    trunk.push(current)
    totalLength += distance
    if (distance === lengthA) i += 1
    if (distance === lengthB) j += 1
  }
  if (totalLength < 12 || i >= left.length || j >= right.length) return undefined
  return { trunk, leftTail: [current, ...left.slice(i)], rightTail: [current, ...right.slice(j)] }
}

export interface CanvasArrowLabelLayout {
  lines: string[]
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasArchitectureHeader {
  height: number
  eyebrow: string
  title: string
  subtitle: string
  legend: Array<{ kind: 'primary' | 'secondary' | 'async'; label: string }>
}

export interface CanvasArchitectureProjection {
  scene: CanvasScene
  view: CanvasArchitectureView
  density: Exclude<CanvasArchitectureDensity, 'auto'>
  hiddenNodes: number
  hiddenArrows: number
}

export type CanvasSemanticLodLevel = 'detail' | 'compact' | 'overview' | 'regions'

export interface CanvasSemanticLodProjection {
  scene: CanvasScene
  level: CanvasSemanticLodLevel
  autoCollapsedGroupIds: string[]
  hiddenNodes: number
  hiddenArrows: number
}

export interface CanvasArchitectureScope {
  kind: CanvasArchitectureScopeKind
  id: string
  depth?: number
}

export interface CanvasArchitectureBreadcrumb {
  kind: CanvasArchitectureScopeKind
  id: string
  label: string
}

export interface CanvasArchitectureScopeProjection {
  scene: CanvasScene
  scope: CanvasArchitectureScope
  breadcrumbs: CanvasArchitectureBreadcrumb[]
  hiddenNodes: number
  hiddenArrows: number
}

export interface CanvasArchitectureCardTemplate {
  kind: CanvasArchitectureCardKind
  label: string
}

export function createCanvasSource(title: string, workbench: CanvasWorkbenchMode = 'freeform'): string {
  return serializeCanvasScene({
    type: CANVAS_DOCUMENT_TYPE,
    version: 1,
    title: title.trim() || 'Canvas',
    width: 1600,
    height: 1000,
    workbench,
    elements: [],
    ...(workbench === 'architecture' ? { architecture: { theme: 'enterprise', view: 'detail', density: 'auto' } as const } : {}),
  })
}

export function parseCanvasScene(source: string): CanvasScene {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('自由画布 JSON 格式无效。')
  }
  if (!value || typeof value !== 'object') throw new Error('自由画布内容无效。')
  const scene = value as Partial<CanvasScene>
  const acceptedType = scene.type === CANVAS_DOCUMENT_TYPE || scene.type === LEGACY_CANVAS_DOCUMENT_TYPE
  if (!acceptedType || scene.version !== 1 || !Array.isArray(scene.elements)) {
    throw new Error('不是受支持的 Diagram Plugin Canvas 文档。')
  }
  if (scene.style !== undefined && !isDiagramVisualStyle(scene.style)) throw new Error('不支持的画布样式，请从内置样式中选择。')
  const architecture = normalizeArchitectureAppearance(scene.architecture)
  const workbench = normalizeCanvasWorkbench(scene.workbench, Boolean(architecture))
  return {
    type: CANVAS_DOCUMENT_TYPE,
    version: 1,
    title: typeof scene.title === 'string' ? scene.title : 'Canvas',
    width: positive(scene.width, 1600),
    height: positive(scene.height, 1000),
    elements: scene.elements.filter(isCanvasElement).map(normalizeCanvasElement),
    workbench,
    ...(isDiagramVisualStyle(scene.style) ? { style: scene.style } : {}),
    ...(Array.isArray(scene.groups) ? { groups: normalizeCanvasGroups(scene.groups) } : {}),
    ...(Array.isArray(scene.lanes) ? { lanes: normalizeCanvasLanes(scene.lanes, positive(scene.width, 1600), positive(scene.height, 1000)) } : {}),
    ...(architecture ? { architecture } : {}),
  }
}

function normalizeCanvasWorkbench(value: unknown, architecture: boolean): CanvasWorkbenchMode {
  if (architecture) return 'architecture'
  if (value === 'freeform' || value === 'architecture' || value === 'flowchart') return value
  return 'freeform'
}

export function serializeCanvasScene(scene: CanvasScene): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}

export function canvasSceneToSvg(scene: CanvasScene, colors?: { background?: string; panel?: string; text?: string; border?: string; note?: string; imageSources?: Readonly<Record<string, string>> }): string {
  const sourceScene = scene
  const architectureMode = Boolean(sourceScene.architecture)
  const architectureTheme = sourceScene.architecture?.theme ?? 'enterprise'
  const architectureProfile = canvasArchitectureThemeProfile(architectureTheme)
  const projection = canvasArchitectureProjection(scene)
  scene = projection.scene
  const baseBackground = colors?.background || '#ffffff'
  const visualSkin = canvasVisualSkin(scene.style, hexLuminance(baseBackground) < 0.18)
  const background = visualSkin?.background ?? (architectureMode && architectureTheme === 'technical'
    ? hexLuminance(baseBackground) < 0.18 ? '#111827' : '#f5f8fc'
    : baseBackground)
  const panel = colors?.panel || '#f8f8f8'
  const text = colors?.text || '#171717'
  const border = colors?.border || '#8a8a8a'
  const note = colors?.note || '#fff7cc'
  const darkArchitecture = architectureMode && hexLuminance(background) < 0.18
  const architectureBorder = colors?.border ?? (darkArchitecture ? '#9bafc6' : '#53677d')
  const allNodes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const groupFrames = canvasGroupFrames(scene)
  const collapsedOwners = canvasCollapsedOwners(scene)
  const nodes = new Map([...allNodes.values()].filter((item) => !collapsedOwners.has(item.id)).map((item) => [item.id, item]))
  const labelLayouts = canvasArrowLabelLayouts(scene)
  const architectureHeader = canvasArchitectureHeader(sourceScene)
  const bundleTrunks = canvasBundleTrunks(scene).map((bundle) => {
    const groupBus = architectureMode && bundle.id.startsWith('group:')
    const opacity = architectureMode
      ? groupBus
        ? bundle.emphasis === 'primary' ? darkArchitecture ? '0.40' : '0.34' : bundle.emphasis === 'muted' ? darkArchitecture ? '0.18' : '0.16' : darkArchitecture ? '0.30' : '0.24'
        : bundle.emphasis === 'primary' ? '0.14' : bundle.emphasis === 'muted' ? '0.05' : '0.09'
      : bundle.emphasis === 'primary' ? '0.24' : bundle.emphasis === 'muted' ? '0.10' : '0.16'
    const width = architectureMode
      ? (groupBus ? bundle.emphasis === 'primary' ? 4.1 : 3.4 : bundle.emphasis === 'primary' ? 3.4 : 2.7) * architectureProfile.edgeScale
      : bundle.emphasis === 'primary' ? 7 : 5.5
    return `<path d="${bundle.path}" fill="none" stroke="${escapeXml(architectureMode ? architectureBorder : border)}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`
  }).join('')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow').map((arrow) => {
    const standalone = Boolean(arrow.start && arrow.end)
    const from = standalone ? undefined : nodes.get(arrow.from)
    const to = standalone ? undefined : nodes.get(arrow.to)
    if (!standalone && (!from || !to)) return ''
    const route = standalone
      ? canvasArrowRoutePoints(arrow.start!, arrow.end!, arrow)
      : canvasArrowBoxRoute(from!, to!, arrow, arrow.from === arrow.to)
    const dash = arrow.lineStyle === 'dotted'
      ? ' stroke-dasharray="2 5" stroke-linecap="round"'
      : arrow.lineStyle === 'dashed' || (architectureMode && architectureProfile.sketchEdges) ? ' stroke-dasharray="8 6"' : ''
    const geometry = canvasArrowRoutePath(route, arrow.freehand)
    const strokeWidth = arrow.strokeWidth ?? (architectureMode
      ? (arrow.emphasis === 'primary' ? 2.6 : arrow.emphasis === 'muted' ? 1.7 : 2.1) * architectureProfile.edgeScale
      : arrow.emphasis === 'primary' ? 3.2 : arrow.emphasis === 'muted' ? 1.35 : 2)
    const groupBundle = architectureMode && arrow.bundleKey?.startsWith('group:')
    const opacity = arrow.opacity ?? (architectureMode
      ? groupBundle
        ? arrow.emphasis === 'muted' ? darkArchitecture ? '0.24' : '0.20' : arrow.emphasis === 'secondary' ? darkArchitecture ? '0.56' : '0.48' : darkArchitecture ? '0.84' : '0.78'
        : arrow.emphasis === 'muted' ? '0.62' : arrow.emphasis === 'secondary' ? '0.90' : '1'
      : arrow.emphasis === 'muted' ? '0.48' : arrow.emphasis === 'secondary' ? '0.78' : '1')
    const stroke = arrow.strokeColor ?? visualSkin?.edge ?? (architectureMode ? architectureBorder : border)
    const visibleLabel = architectureMode && arrow.label && !canvasArchitectureRelationLabelVisible(arrow) ? undefined : arrow.label
    const label = visibleLabel ? labelLayouts.get(arrow.id) : undefined
    const labelText = label ? `<text x="${label.x}" y="${label.y + 4 - (label.lines.length - 1) * 8}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="600" fill="${escapeXml(text)}"${architectureMode ? ` stroke="${escapeXml(background)}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : ''}>${label.lines.map((line, index) => `<tspan x="${label.x}" dy="${index ? 16 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>` : ''
    const labelMarkup = visibleLabel && label
      ? `<g class="canvas-arrow-label"><title>${escapeXml(visibleLabel)}</title>${architectureMode ? '' : `<rect x="${label.x - label.width / 2}" y="${label.y - label.height / 2}" width="${label.width}" height="${label.height}" rx="8" fill="${escapeXml(background)}" stroke="${escapeXml(border)}" stroke-opacity="0.28"/>`}${labelText}</g>`
      : ''
    const markerEnd = arrow.markerEnd === 'none' ? '' : ' marker-end="url(#arrow)"'
    return `<g opacity="${opacity}"><path d="${geometry}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"${dash}${markerEnd}/>${labelMarkup}</g>`
  }).join('')
  const collapsedConnections = canvasCollapsedConnections(scene, groupFrames).map((connection) => {
    const fromCenter = centerOfCanvasBox(connection.fromBox)
    const toCenter = centerOfCanvasBox(connection.toBox)
    const start = anchorPoint(connection.fromBox, connection.fromAnchor, toCenter)
    const end = anchorPoint(connection.toBox, connection.toAnchor, fromCenter)
    const geometry = canvasArrowPath(start, end, connection)
    const dash = connection.lineStyle === 'dashed' ? ' stroke-dasharray="8 6"' : ''
    const label = connection.labels.length ? connection.labels.slice(0, 2).join(' · ') : ''
    const suffix = connection.count > 1 ? ` ×${connection.count}` : ''
    return `<g><path d="${geometry}" fill="none" stroke="${escapeXml(architectureMode ? architectureBorder : border)}" stroke-width="${architectureMode ? 2.4 : 2.2}"${dash} marker-end="url(#arrow)"/>${label || suffix ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle" font-size="13" fill="${escapeXml(text)}">${escapeXml(`${label}${suffix}`)}</text>` : ''}</g>`
  }).join('')
  const shapes = [...nodes.values()].map((rawItem) => {
    const skin = canvasVisualSkin(rawItem.type === 'note' ? undefined : scene.style, hexLuminance(baseBackground) < 0.18, rawItem.tone, rawItem.emphasis === 'primary' && !architectureMode)
    // Style presets are color guidance in architecture mode, not persisted
    // per-node fill overrides. This mirrors CanvasEditor card CSS semantics.
    const item = architectureMode && rawItem.type === 'node' ? rawItem : canvasStyledBox(rawItem, skin)
    const wrapRotation = (markup: string) => item.rotation
      ? `<g transform="rotate(${item.rotation} ${item.x + item.width / 2} ${item.y + item.height / 2})">${markup}</g>`
      : markup
    const architectureMark = architectureMode && item.type === 'node' && Boolean(item.iconRef || item.stencil || item.icon)
    const palette = skin && item.type === 'node'
      ? { fill: item.fillColor ?? skin.fill, text: architectureMark && !rawItem.fillColor ? text : canvasFillTextColor(item.fillColor, skin.text), stroke: item.strokeColor ?? skin.stroke }
      : architectureMode
        ? canvasArchitectureTonePalette(item.tone, { panel, text, border, note }, item.type)
        : canvasTonePalette(item.tone, { panel, text, border, note }, item.type)
    if (item.type === 'node' && !skin && item.fillColor) palette.text = canvasFillTextColor(item.fillColor, palette.text)
    if (item.type === 'note' && item.textOnly) {
      const fontSize = item.fontSize ?? 20
      const fontWeight = item.fontWeight ?? 500
      const textFill = item.textColor ?? text
      const opacity = item.opacity ?? 1
      const lineHeight = Math.round(fontSize * 1.35)
      const lines = item.text.split('\n').slice(0, 8)
      return wrapRotation(`<g opacity="${opacity}">${lines.map((line, index) => `<text x="${item.x}" y="${item.y + fontSize + index * lineHeight}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(textFill)}">${escapeXml(line)}</text>`).join('')}</g>`)
    }
    if (item.type === 'note' && item.imagePath) {
      const imageSource = colors?.imageSources?.[item.imagePath]
      const radius = item.cornerRadius ?? 10
      const content = imageSource
        ? `<image x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" href="${escapeXml(imageSource)}" preserveAspectRatio="${item.imageFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}"/>`
        : `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${radius}" fill="${escapeXml(panel)}"/><text x="${item.x + item.width / 2}" y="${item.y + item.height / 2 + 4}" text-anchor="middle" font-size="13" fill="${escapeXml(text)}">${escapeXml(truncateCanvasText(item.text || '图片', 28))}</text>`
      return wrapRotation(`<g opacity="${item.opacity ?? 1}"><clipPath id="clip-${escapeXml(item.id)}"><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${radius}"/></clipPath><g clip-path="url(#clip-${escapeXml(item.id)})">${content}</g><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${radius}" fill="none" stroke="${escapeXml(item.strokeColor ?? border)}" stroke-width="${item.strokeWidth ?? 1}"/></g>`)
    }
    const architectureCard = item.type === 'node' && Boolean(item.iconRef || item.icon || item.stencil || item.c4Type)
    if (architectureMode && architectureCard) return wrapRotation(renderArchitectureCanvasNode(item,
      { ...palette, text: item.fillColor ? palette.text : darkArchitecture ? '#f8fafc' : '#243247' },
      projection.density, architectureTheme, skin?.font, scene.architecture?.titleScale ?? 1,
      darkArchitecture ? '#222d3c' : '#f8fafc'))
    const cardTemplate = canvasArchitectureCardTemplate(item)
    const showSubtitle = Boolean(item.subtitle && (!architectureCard || projection.density !== 'dense'))
    const cardTitleLimit = projection.density === 'dense' ? 22 : projection.density === 'compact' ? 26 : 30
    const lines = item.text.split('\n').slice(0, 6)
    const texts = architectureCard
      ? `<text x="${item.x + 16}" y="${item.y + (showSubtitle ? 55 : Math.max(54, item.height / 2 + 5))}" font-size="15" font-weight="650" fill="${escapeXml(palette.text)}">${escapeXml(truncateCanvasText(lines.join(' '), cardTitleLimit))}</text>`
      : lines.map((line, index) => `<text x="${item.x + item.width / 2}" y="${item.y + item.height / 2 + (index - (lines.length - 1) / 2) * 19}" text-anchor="middle" dominant-baseline="middle" font-size="15" fill="${escapeXml(palette.text)}">${escapeXml(line)}</text>`).join('')
    const rolePaths = item.icon ? canvasIconPaths(item.icon) : []
    const icon = item.iconRef
      ? `<g transform="translate(${item.x + 8} ${item.y + 8}) scale(.8333)">${canvasIconRefMarkup(item.iconRef, hexLuminance(palette.text) > 0.62, palette.stroke)}</g>`
      : rolePaths.length ? `<g transform="translate(${item.x + 8} ${item.y + 8})"><circle cx="10" cy="10" r="10" fill="${escapeXml(palette.stroke)}" fill-opacity="0.10" stroke="${escapeXml(palette.stroke)}" stroke-opacity="0.38"/><g transform="translate(3 3) scale(.5833)" fill="none" stroke="${escapeXml(palette.stroke)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${rolePaths.map((d) => `<path d="${d}"/>`).join('')}</g></g>` : ''
    const cardMeta = item.iconRef ? canvasIconRefLabel(item.iconRef) : item.stencil ? canvasStencilLabel(item.stencil) : architectureCard ? cardTemplate.label : item.icon ? canvasIconLabel(item.icon) : ''
    const stencil = cardMeta ? `<text x="${item.x + (item.iconRef || item.icon ? 34 : 14)}" y="${item.y + 21}" font-size="10" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-weight="700" letter-spacing="0.3" fill="${escapeXml(palette.stroke)}">${escapeXml(cardMeta)}</text>` : ''
    const c4 = item.c4Type ? `<text x="${item.x + item.width - 12}" y="${item.y + 20}" text-anchor="end" font-size="10" font-weight="600" fill="${escapeXml(palette.stroke)}">${escapeXml(c4Label(item.c4Type))}</text>` : ''
    const subtitle = showSubtitle ? `<text x="${architectureCard ? item.x + 16 : item.x + item.width / 2}" y="${item.y + item.height - 16}"${architectureCard ? '' : ' text-anchor="middle"'} font-size="11" fill="${escapeXml(palette.stroke)}">${escapeXml(truncateCanvasText(item.subtitle!, 34))}</text>` : ''
    const fillColor = item.fillColor ?? palette.fill
    const strokeColor = item.strokeColor ?? palette.stroke
    const strokeWidth = item.strokeWidth ?? (item.emphasis === 'primary' ? 2.4 : item.emphasis === 'muted' ? 1.1 : 1.5)
    const opacity = item.opacity ?? (item.emphasis === 'muted' ? '0.72' : '1')
    const accent = !skin && item.emphasis === 'primary' && !item.shapeRef ? `<rect x="${item.x}" y="${item.y}" width="5" height="${item.height}" rx="${Math.min(5, shapeRadius(item.shape, item.height))}" fill="${escapeXml(palette.stroke)}"/>` : ''
    const cardBand = architectureCard ? `<rect x="${item.x + 12}" y="${item.y + item.height - 4}" width="${Math.max(24, item.width - 24)}" height="2" rx="1" fill="${escapeXml(architectureCardBandColor(cardTemplate.kind, palette.stroke, border))}" fill-opacity="0.72"/>` : ''
    const dash = cardTemplate.kind === 'external' || cardTemplate.kind === 'messaging' ? ' stroke-dasharray="7 5"' : ''
    const shapeMarkup = item.shapeRef
      ? (() => {
          const geometry = canvasShapeGeometry(item.shapeRef, item.width, item.height, item.cornerRadius)
          return `<g transform="translate(${item.x} ${item.y})"><path d="${geometry.bodyPath}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${strokeWidth}"${architectureCard ? dash : ''}/>${geometry.detailPaths.map((path) => `<path d="${path}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${Math.max(1, strokeWidth * 0.86)}"/>`).join('')}</g>`
        })()
      : `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${item.cornerRadius ?? shapeRadius(item.shape, item.height)}" fill="${escapeXml(fillColor)}" stroke="${escapeXml(strokeColor)}" stroke-width="${strokeWidth}"${architectureCard ? dash : ''}/>`
    return wrapRotation(`<g opacity="${opacity}"${skin ? ` style="filter:${skin.shadow};font-family:${skin.font}"` : ''}>${shapeMarkup}${accent}${cardBand}${icon}${stencil}${c4}${texts}${subtitle}</g>`)
  }).join('')
  const groups = canvasPresentationGroupFrames(scene, groupFrames)
    .filter((group) => !isInsideCollapsedAncestor(group.id, scene.groups ?? [])).map((group) => {
    const palette = architectureMode
      ? canvasArchitectureTonePalette(group.tone, { panel, text, border, note }, 'node')
      : canvasTonePalette(group.tone, { panel, text, border, note }, 'node')
    const softwareSystem = group.c4Type === 'software-system'
    const container = group.c4Type === 'container'
    const dash = architectureMode
      ? architectureProfile.groupSolid ? '' : softwareSystem ? '10 7' : container ? '8 6' : group.kind === 'boundary' ? '6 5' : '5 5'
      : softwareSystem ? '' : container ? '10 6' : group.kind === 'boundary' ? '12 6' : '8 6'
    const strokeWidth = architectureMode ? (softwareSystem ? 1.35 : container ? 1.15 : 1) * architectureProfile.groupScale : softwareSystem ? 2.4 : container ? 1.7 : 1.4
    const fillOpacity = architectureMode
      ? group.collapsed ? '0.34' : String(architectureProfile.groupFillOpacity)
      : group.collapsed ? '0.5' : softwareSystem ? '0.10' : container ? '0.05' : '0'
    const collapsed = group.collapsed ? ' · 已折叠' : ''
    const fill = architectureMode || group.collapsed || softwareSystem || container ? escapeXml(palette.fill) : 'none'
    if (architectureMode) {
      if (group.collapsed && group.id.startsWith('arch-')) {
        // Generated overview summaries are readable cards, not the faded,
        // empty dashed boundaries used around expanded architecture regions.
        return `<g><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="12" fill="${fill}" fill-opacity="0.96" stroke="${escapeXml(palette.stroke)}" stroke-opacity="0.88" stroke-width="1.7"/><rect x="${group.x}" y="${group.y + 9}" width="4" height="${Math.max(12, group.height - 18)}" rx="2" fill="${escapeXml(palette.stroke)}"/><text x="${group.x + 16}" y="${group.y + 35}" font-size="14" font-weight="730" fill="${escapeXml(text)}">${escapeXml(truncateCanvasText(group.label || group.id, 12))}</text><text x="${group.x + group.width - 14}" y="${group.y + 35}" font-size="11" font-weight="600" text-anchor="end" fill="${escapeXml(palette.stroke)}">${group.memberIds.length} 个组件</text></g>`
      }
      const groupStrokeOpacity = softwareSystem ? 0.55 : 0.78
      const frameFillOpacity = group.collapsed ? fillOpacity : '0.07'
      return `<g><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${architectureProfile.groupRadius}" fill="${fill}" fill-opacity="${frameFillOpacity}" stroke="${escapeXml(softwareSystem ? architectureBorder : palette.stroke)}" stroke-opacity="${groupStrokeOpacity}" stroke-width="${Math.max(1.35, strokeWidth)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${group.label ? `<text x="${group.x + 10}" y="${group.y + 18}" font-size="11.5" font-weight="650" fill="${escapeXml(text)}" opacity="0.90">${escapeXml(`${group.label}${collapsed}`)}</text>` : ''}</g>`
    }
    const c4 = group.c4Type ? ` · ${c4Label(group.c4Type)}` : ''
    const header = group.label && softwareSystem
      ? `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="34" rx="18" fill="${escapeXml(palette.fill)}" fill-opacity="0.62"/>`
      : ''
    return `<g><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="18" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${escapeXml(palette.stroke)}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${header}${group.label ? `<text x="${group.x + 14}" y="${group.y + 22}" font-size="${softwareSystem ? 13 : 12}" font-weight="${softwareSystem ? 760 : 650}" fill="${escapeXml(palette.text)}">${escapeXml(`${group.label}${c4}${collapsed}`)}</text>` : ''}</g>`
  }).join('')
  const lanes = (scene.lanes ?? []).map((lane) => {
    const palette = canvasTonePalette(lane.tone ?? 'muted', { panel, text, border, note }, 'node')
    const x = lane.axis === 'vertical' ? lane.start : 0
    const y = lane.axis === 'horizontal' ? lane.start : architectureHeader?.height ?? 0
    const width = lane.axis === 'vertical' ? lane.size : scene.width
    const height = lane.axis === 'horizontal' ? lane.size : scene.height - (architectureHeader?.height ?? 0)
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${escapeXml(palette.fill)}" fill-opacity="0.42" stroke="${escapeXml(palette.stroke)}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="4 6"/><rect x="${x}" y="${y}" width="${width}" height="34" rx="14" fill="${escapeXml(palette.fill)}" fill-opacity="0.86"/><text x="${x + 14}" y="${y + 22}" font-size="12" font-weight="700" fill="${escapeXml(palette.text)}">${escapeXml(lane.label)}</text></g>`
  }).join('')
  const header = architectureHeader ? architectureHeaderToSvg(scene, architectureHeader, { background, text, border }) : ''
  const marker = architectureMode
    ? '<marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto"><path d="M0,0 L0,8 L10,4 z" fill="context-stroke"/></marker>'
    : '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}"><defs>${marker}</defs><rect width="100%" height="100%" fill="${escapeXml(background)}"/>${header}${lanes}${groups}${bundleTrunks}${arrows}${collapsedConnections}${shapes}</svg>`
}

export function canvasBundleTrunks(scene: CanvasScene): CanvasBundleTrunk[] {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const collapsedOwners = canvasCollapsedOwners(scene)
  const groups = new Map<string, CanvasArrow[]>()
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow' || !item.bundleKey) return
    if (collapsedOwners.has(item.from) || collapsedOwners.has(item.to)) return
    groups.set(item.bundleKey, [...(groups.get(item.bundleKey) ?? []), item])
  })
  const result: CanvasBundleTrunk[] = []
  for (const [bundleKey, arrows] of groups) {
    if (arrows.length < 2) continue
    if (bundleKey.startsWith('from:')) {
      // Generated source bundles are disjoint pairs. Derive the drawable trunk
      // from both *resolved routes*, not arrow.points[0]: that waypoint may be
      // absent or differ between arrows sharing only a short first segment.
      if (arrows.length === 2) {
        const [left, right] = arrows
        const source = boxes.get(left.from)
        const firstTarget = boxes.get(left.to)
        const secondTarget = boxes.get(right.to)
        if (left.from === right.from && source && firstTarget && secondTarget) {
          const stem = canvasSharedSourceStem(
            canvasArrowBoxRoute(source, firstTarget, left),
            canvasArrowBoxRoute(source, secondTarget, right),
          )
          if (stem) result.push({
            id: bundleKey,
            path: stem.trunk.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
            emphasis: strongestEmphasis(arrows),
            count: arrows.length,
          })
        }
        continue
      }
      const clusters = new Map<string, CanvasArrow[]>()
      arrows.forEach((arrow) => {
        const point = arrow.points?.[0]
        if (!point) return
        const key = `${arrow.fromAnchor ?? 'auto'}:${Math.round(point.x)}:${Math.round(point.y)}`
        clusters.set(key, [...(clusters.get(key) ?? []), arrow])
      })
      for (const [clusterKey, members] of clusters) {
        if (members.length < 2) continue
        const first = members[0]
        const box = boxes.get(first.from)
        const end = first.points?.[0]
        if (!box || !end) continue
        const start = anchorPoint(box, first.fromAnchor, end)
        result.push({ id: `${bundleKey}:${clusterKey}`,
          path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
          emphasis: strongestEmphasis(members), count: members.length })
      }
    } else if (bundleKey.startsWith('to:')) {
      const clusters = new Map<string, CanvasArrow[]>()
      arrows.forEach((arrow) => {
        const point = arrow.points?.at(-1)
        if (!point) return
        const key = `${arrow.toAnchor ?? 'auto'}:${Math.round(point.x)}:${Math.round(point.y)}`
        clusters.set(key, [...(clusters.get(key) ?? []), arrow])
      })
      for (const [clusterKey, members] of clusters) {
        if (members.length < 2) continue
        const first = members[0]
        const box = boxes.get(first.to)
        const start = first.points?.at(-1)
        if (!box || !start) continue
        const end = anchorPoint(box, first.toAnchor, start)
        result.push({ id: `${bundleKey}:${clusterKey}`, path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, emphasis: strongestEmphasis(members), count: members.length })
      }
    } else if (bundleKey.startsWith('group:')) {
      const shared = new Map<string, Array<{ start: number; end: number; arrow: CanvasArrow }>>()
      for (const arrow of arrows) {
        const from = boxes.get(arrow.from)
        const to = boxes.get(arrow.to)
        if (!from || !to) continue
        const start = anchorPoint(from, arrow.fromAnchor, centerOfCanvasBox(to))
        const end = anchorPoint(to, arrow.toAnchor, centerOfCanvasBox(from))
        const route = canvasArrowRoutePoints(start, end, arrow)
        for (let index = 0; index < route.length - 1; index += 1) {
          const a = route[index]
          const b = route[index + 1]
          const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
          if (length < 36 || a.x !== b.x && a.y !== b.y) continue
          const horizontal = a.y === b.y
          const key = horizontal ? `h:${Math.round(a.y)}` : `v:${Math.round(a.x)}`
          const start = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
          const end = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
          shared.set(key, [...(shared.get(key) ?? []), { start, end, arrow }])
        }
      }
      for (const [axisKey, segments] of shared) {
        const coordinates = [...new Set(segments.flatMap((segment) => [segment.start, segment.end]))].sort((left, right) => left - right)
        for (let index = 0; index < coordinates.length - 1; index += 1) {
          const start = coordinates[index]
          const end = coordinates[index + 1]
          if (end - start < 24) continue
          const members = segments.filter((segment) => segment.start <= start && segment.end >= end).map((segment) => segment.arrow)
          const uniqueMembers = [...new Map(members.map((arrow) => [arrow.id, arrow])).values()]
          if (uniqueMembers.length < 2) continue
          const [axis, coordinate] = axisKey.split(':')
          const fixed = Number(coordinate)
          const path = axis === 'h'
            ? `M ${start} ${fixed} L ${end} ${fixed}`
            : `M ${fixed} ${start} L ${fixed} ${end}`
          result.push({
            id: `${bundleKey}:${axisKey}:${Math.round(start)}:${Math.round(end)}`,
            path,
            emphasis: strongestEmphasis(uniqueMembers),
            count: uniqueMembers.length,
          })
        }
      }
    }
  }
  return result
}

export function canvasArchitectureProjection(scene: CanvasScene): CanvasArchitectureProjection {
  const view = scene.architecture?.view ?? 'detail'
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const density = resolveCanvasArchitectureDensity(scene, boxes.length)
  if (view === 'detail') {
    return { scene, view, density, hiddenNodes: 0, hiddenArrows: 0 }
  }

  const projectedGroups = architectureOverviewGroups(scene, boxes)
  const overviewScene = projectedGroups === scene.groups ? scene : { ...scene, groups: projectedGroups }
  const collapsedOwners = canvasCollapsedOwners(overviewScene)
  const collapsedNodeIds = new Set(collapsedOwners.keys())
  const explicitBoxes = boxes.filter((item) => !collapsedNodeIds.has(item.id))
  if (!collapsedNodeIds.size && boxes.length <= overviewNodeLimit(density)) {
    return { scene, view, density, hiddenNodes: 0, hiddenArrows: 0 }
  }

  const boxById = new Map(boxes.map((item) => [item.id, item]))

  const degree = new Map<string, number>(explicitBoxes.map((item) => [item.id, 0]))
  arrows.forEach((arrow) => {
    if (collapsedNodeIds.has(arrow.from) || collapsedNodeIds.has(arrow.to)) return
    degree.set(arrow.from, (degree.get(arrow.from) ?? 0) + 1)
    degree.set(arrow.to, (degree.get(arrow.to) ?? 0) + 1)
  })
  const visible = new Set<string>()
  explicitBoxes.forEach((item) => {
    if (item.emphasis === 'primary') visible.add(item.id)
  })
  arrows.forEach((arrow) => {
    if (arrow.emphasis !== 'primary') return
    if (collapsedNodeIds.has(arrow.from) || collapsedNodeIds.has(arrow.to)) return
    visible.add(arrow.from)
    visible.add(arrow.to)
  })

  // Keep at least one representative for every architecture lane and group so
  // overview mode still communicates the full system shape rather than only a path.
  const buckets = new Map<string, Array<CanvasNode | CanvasNote>>()
  explicitBoxes.forEach((item) => {
    const key = item.laneId ? `lane:${item.laneId}` : item.groupId ? `group:${item.groupId}` : 'ungrouped'
    buckets.set(key, [...(buckets.get(key) ?? []), item])
  })
  buckets.forEach((members) => {
    const representative = members.slice().sort((left, right) => architectureOverviewScore(right, degree) - architectureOverviewScore(left, degree))[0]
    if (representative) visible.add(representative.id)
  })

  const limit = Math.max(visible.size, overviewNodeLimit(density))
  explicitBoxes
    .filter((item) => !visible.has(item.id))
    .sort((left, right) => architectureOverviewScore(right, degree) - architectureOverviewScore(left, degree) || left.x - right.x || left.y - right.y)
    .slice(0, Math.max(0, limit - visible.size))
    .forEach((item) => visible.add(item.id))

  const visibleArrows = arrows.filter((arrow) => {
    if (collapsedNodeIds.has(arrow.from) || collapsedNodeIds.has(arrow.to)) {
      const otherId = collapsedNodeIds.has(arrow.from) ? arrow.to : arrow.from
      return collapsedNodeIds.has(otherId) || visible.has(otherId)
    }
    if (!visible.has(arrow.from) || !visible.has(arrow.to)) return false
    if (arrow.emphasis !== 'muted') return true
    return boxById.get(arrow.from)?.emphasis === 'primary' || boxById.get(arrow.to)?.emphasis === 'primary'
  })
  const visibleArrowIds = new Set(visibleArrows.map((arrow) => arrow.id))
  const elements = scene.elements.filter((item) => item.type === 'arrow'
    ? visibleArrowIds.has(item.id)
    : collapsedNodeIds.has(item.id) || visible.has(item.id))
  const explicitVisibleArrows = visibleArrows.filter((arrow) => !collapsedNodeIds.has(arrow.from) && !collapsedNodeIds.has(arrow.to)).length
  return {
    scene: { ...overviewScene, elements },
    view,
    density,
    hiddenNodes: boxes.length - visible.size,
    hiddenArrows: arrows.length - explicitVisibleArrows,
  }
}

function architectureOverviewGroups(scene: CanvasScene, boxes: Array<CanvasNode | CanvasNote>): CanvasGroup[] | undefined {
  const groups = scene.groups
  if (!groups?.length) return groups
  const frames = canvasGroupFrames(scene)
  const severeOverlapGroups = new Set<string>()
  if (scene.architecture && boxes.length >= 16) {
    let totalArea = 0
    const overlaps: Array<[string, string]> = []
    for (let i = 0; i < frames.length; i += 1) for (let j = i + 1; j < frames.length; j += 1) {
      const a = frames[i], b = frames[j]
      if (!/^arch-(external|experience|application|processing|data)$/.test(a.id)
        || !/^arch-(external|experience|application|processing|data)$/.test(b.id)) continue
      const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      if (width <= 5 || height <= 5) continue
      totalArea += width * height
      overlaps.push([a.id, b.id])
    }
    if (overlaps.length >= 2 && totalArea >= scene.width * scene.height * 0.12) {
      for (const [a, b] of overlaps) { severeOverlapGroups.add(a); severeOverlapGroups.add(b) }
    }
  }
  const eligible = new Set(frames.flatMap((frame) => {
    const group = groups.find((item) => item.id === frame.id)
    if (!group || group.collapsed || group.c4Type === 'software-system') return []
    if (group.kind !== 'boundary' && group.c4Type !== 'container') return []
    // Preserve the usual 5-node threshold. Only a severely overlapped,
    // generated region may collapse with two members, so its long bounding
    // rectangle doesn't dominate the initial overview.
    if (frame.memberIds.length < (severeOverlapGroups.has(frame.id) ? 2 : 5)) return []
    if (groups.length === 1 && frame.memberIds.length >= boxes.length * 0.8) return []
    return [group.id]
  }))
  if (!eligible.size) return groups

  const groupById = new Map(groups.map((group) => [group.id, group]))
  const collapsed = new Set<string>()
  for (const id of eligible) {
    let parentId = groupById.get(id)?.parentId
    let hasEligibleAncestor = false
    while (parentId) {
      if (eligible.has(parentId)) {
        hasEligibleAncestor = true
        break
      }
      parentId = groupById.get(parentId)?.parentId
    }
    if (!hasEligibleAncestor) collapsed.add(id)
  }
  return groups.map((group) => collapsed.has(group.id) ? { ...group, collapsed: true } : group)
}

export function canvasArchitectureScopeProjection(scene: CanvasScene, scope: CanvasArchitectureScope): CanvasArchitectureScopeProjection {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const boxById = new Map(boxes.map((item) => [item.id, item]))
  const groupById = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const visible = new Set<string>()
  const breadcrumbs: CanvasArchitectureBreadcrumb[] = []

  if (scope.kind === 'group') {
    const target = groupById.get(scope.id)
    if (!target) return { scene, scope, breadcrumbs, hiddenNodes: 0, hiddenArrows: 0 }
    for (const entry of architectureGroupBreadcrumbs(target.id, groupById)) breadcrumbs.push(entry)
    boxes.forEach((item) => {
      if (item.groupId && groupContains(target.id, item.groupId, groupById)) visible.add(item.id)
    })
  } else if (scope.kind === 'lane') {
    const lane = scene.lanes?.find((item) => item.id === scope.id)
    if (!lane) return { scene, scope, breadcrumbs, hiddenNodes: 0, hiddenArrows: 0 }
    breadcrumbs.push({ kind: 'lane', id: lane.id, label: lane.label })
    boxes.forEach((item) => {
      if (item.laneId === lane.id) visible.add(item.id)
    })
  } else {
    const target = boxById.get(scope.id)
    if (!target) return { scene, scope, breadcrumbs, hiddenNodes: 0, hiddenArrows: 0 }
    if (target.groupId) breadcrumbs.push(...architectureGroupBreadcrumbs(target.groupId, groupById))
    breadcrumbs.push({ kind: 'node', id: target.id, label: target.text })
    const depth = Math.max(1, Math.min(3, scope.depth ?? 1))
    const adjacency = new Map<string, Set<string>>()
    boxes.forEach((item) => adjacency.set(item.id, new Set()))
    arrows.forEach((arrow) => {
      adjacency.get(arrow.from)?.add(arrow.to)
      adjacency.get(arrow.to)?.add(arrow.from)
    })
    let frontier = new Set([target.id])
    visible.add(target.id)
    for (let level = 0; level < depth; level += 1) {
      const next = new Set<string>()
      frontier.forEach((id) => adjacency.get(id)?.forEach((neighbor) => {
        if (visible.has(neighbor)) return
        visible.add(neighbor)
        next.add(neighbor)
      }))
      frontier = next
    }
  }

  // Region focus keeps one-hop boundary dependencies so a local view does not
  // lose the contracts entering or leaving the selected subsystem.
  if (scope.kind !== 'node') {
    arrows.forEach((arrow) => {
      const fromVisible = visible.has(arrow.from)
      const toVisible = visible.has(arrow.to)
      if (fromVisible !== toVisible) visible.add(fromVisible ? arrow.to : arrow.from)
    })
  }

  const density = resolveCanvasArchitectureDensity(scene, boxes.length)
  const focusLimit = density === 'dense' ? 56 : density === 'compact' ? 48 : 42
  const hasImmediateChildGroups = scope.kind === 'group' && (scene.groups ?? []).some((group) => group.parentId === scope.id)
  if (visible.size > focusLimit && !hasImmediateChildGroups) {
    const degree = new Map<string, number>(boxes.map((item) => [item.id, 0]))
    arrows.forEach((arrow) => {
      degree.set(arrow.from, (degree.get(arrow.from) ?? 0) + 1)
      degree.set(arrow.to, (degree.get(arrow.to) ?? 0) + 1)
    })
    const mustKeep = new Set<string>()
    if (scope.kind === 'node') mustKeep.add(scope.id)
    boxes.forEach((item) => {
      if (!visible.has(item.id)) return
      if (item.emphasis === 'primary') mustKeep.add(item.id)
    })
    const laneBuckets = new Map<string, Array<CanvasNode | CanvasNote>>()
    boxes.forEach((item) => {
      if (!visible.has(item.id) || !item.laneId) return
      laneBuckets.set(item.laneId, [...(laneBuckets.get(item.laneId) ?? []), item])
    })
    laneBuckets.forEach((members) => {
      const representative = members.slice().sort((left, right) => architectureOverviewScore(right, degree) - architectureOverviewScore(left, degree))[0]
      if (representative) mustKeep.add(representative.id)
    })
    const trimmed = new Set(mustKeep)
    boxes
      .filter((item) => visible.has(item.id) && !trimmed.has(item.id))
      .sort((left, right) => architectureOverviewScore(right, degree) - architectureOverviewScore(left, degree))
      .slice(0, Math.max(0, focusLimit - trimmed.size))
      .forEach((item) => trimmed.add(item.id))
    visible.clear()
    trimmed.forEach((id) => visible.add(id))
  }

  const visibleArrows = arrows.filter((arrow) => visible.has(arrow.from) && visible.has(arrow.to))
  const visibleArrowIds = new Set(visibleArrows.map((arrow) => arrow.id))
  const scopedGroups = (scene.groups ?? []).map((group) => {
    if (scope.kind !== 'group') return group
    if (group.id === scope.id || architectureGroupBreadcrumbs(scope.id, groupById).some((entry) => entry.id === group.id)) {
      return group.collapsed ? { ...group, collapsed: undefined } : group
    }
    // Immediate C4/domain children become navigable summaries. Their members
    // remain in the projection so existing collapsed-edge aggregation works.
    if (group.parentId === scope.id) return { ...group, collapsed: true }
    return group
  })
  const usedLaneIds = new Set(boxes.filter((item) => visible.has(item.id) && item.laneId).map((item) => item.laneId as string))
  const elements = scene.elements.filter((item) => item.type === 'arrow' ? visibleArrowIds.has(item.id) : visible.has(item.id))
  return {
    scene: {
      ...scene,
      elements,
      groups: scopedGroups,
      ...(scene.lanes ? { lanes: scene.lanes.filter((lane) => usedLaneIds.has(lane.id) || scope.kind === 'lane' && lane.id === scope.id) } : {}),
    },
    scope,
    breadcrumbs,
    hiddenNodes: boxes.length - visible.size,
    hiddenArrows: arrows.length - visibleArrows.length,
  }
}

export function resolveCanvasSemanticLod(zoom: number, nodeCount: number): CanvasSemanticLodLevel {
  // Very large diagrams should start in overview; mounting thousands of tiny SVG
  // details at 100% costs more than the visible information they communicate.
  const pressure = nodeCount >= 3000 ? 0.4 : nodeCount >= 1200 ? 0.14 : nodeCount >= 500 ? 0.08 : nodeCount >= 180 ? 0.04 : 0
  if (zoom >= 0.92 + pressure) return 'detail'
  if (zoom >= 0.62 + pressure) return 'compact'
  if (zoom >= 0.36 + pressure / 2) return 'overview'
  return 'regions'
}

/**
 * Display-only semantic LOD. It never mutates persisted collapse state.
 * At the farthest zoom level, stable semantic boundaries become temporary
 * region summaries so large diagrams preserve shape without mounting every
 * member node into the main SVG.
 */
export function canvasSemanticLodProjection(
  scene: CanvasScene,
  zoom: number | CanvasSemanticLodLevel,
  selectedIds: string[] = [],
): CanvasSemanticLodProjection {
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const arrows = scene.elements.filter((item): item is CanvasArrow => item.type === 'arrow')
  const level = typeof zoom === 'number' ? resolveCanvasSemanticLod(zoom, boxes.length) : zoom
  if (level === 'detail' || level === 'compact') {
    return { scene, level, autoCollapsedGroupIds: [], hiddenNodes: 0, hiddenArrows: 0 }
  }

  const selected = new Set(selectedIds)
  arrows.forEach((arrow) => {
    if (!selected.has(arrow.id)) return
    selected.add(arrow.from)
    selected.add(arrow.to)
  })
  const groups = scene.groups ?? []
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const memberCount = new Map<string, number>()
  const containsSelection = new Set<string>()
  boxes.forEach((item) => {
    let groupId = item.groupId
    const visited = new Set<string>()
    while (groupId && !visited.has(groupId)) {
      visited.add(groupId)
      memberCount.set(groupId, (memberCount.get(groupId) ?? 0) + 1)
      if (selected.has(item.id)) containsSelection.add(groupId)
      groupId = groupById.get(groupId)?.parentId
    }
  })

  const eligible = level === 'regions'
    ? new Set(groups.flatMap((group) => {
        if (group.collapsed || containsSelection.has(group.id)) return []
        const count = memberCount.get(group.id) ?? 0
        const semanticBoundary = group.kind === 'boundary' || Boolean(group.c4Type) || count >= 6
        return semanticBoundary && count >= 3 ? [group.id] : []
      }))
    : new Set<string>()

  // Prefer the highest eligible ancestor so nested Container/Domain structures
  // become one stable region summary instead of several overlapping summaries.
  const autoCollapsed = new Set<string>()
  for (const id of eligible) {
    let parentId = groupById.get(id)?.parentId
    let hasEligibleAncestor = false
    while (parentId) {
      if (eligible.has(parentId)) {
        hasEligibleAncestor = true
        break
      }
      parentId = groupById.get(parentId)?.parentId
    }
    if (!hasEligibleAncestor) autoCollapsed.add(id)
  }
  const projectedGroups = autoCollapsed.size
    ? groups.map((group) => autoCollapsed.has(group.id) ? { ...group, collapsed: true } : group)
    : scene.groups
  let projected: CanvasScene = projectedGroups ? { ...scene, groups: projectedGroups } : scene
  const owners = canvasCollapsedOwners(projected)
  const collapsedNodeIds = new Set(owners.keys())
  const candidates = boxes.filter((item) => !collapsedNodeIds.has(item.id))
  const limit = semanticLodNodeLimit(level, boxes.length)
  let visibleNodeIds = new Set(candidates.map((item) => item.id))

  if (candidates.length > limit) {
    const degree = new Map<string, number>(boxes.map((item) => [item.id, 0]))
    arrows.forEach((arrow) => {
      degree.set(arrow.from, (degree.get(arrow.from) ?? 0) + 1)
      degree.set(arrow.to, (degree.get(arrow.to) ?? 0) + 1)
    })
    const mustKeep = new Set<string>()
    candidates.forEach((item) => {
      if (selected.has(item.id) || item.emphasis === 'primary') mustKeep.add(item.id)
    })
    arrows.forEach((arrow) => {
      if (collapsedNodeIds.has(arrow.from) && !collapsedNodeIds.has(arrow.to)) mustKeep.add(arrow.to)
      if (collapsedNodeIds.has(arrow.to) && !collapsedNodeIds.has(arrow.from)) mustKeep.add(arrow.from)
    })
    const buckets = new Map<string, Array<CanvasNode | CanvasNote>>()
    candidates.forEach((item) => {
      const key = item.laneId ? `lane:${item.laneId}` : item.groupId ? `group:${item.groupId}` : ''
      if (!key) return
      buckets.set(key, [...(buckets.get(key) ?? []), item])
    })
    buckets.forEach((members) => {
      const representative = members.slice().sort((left, right) => semanticLodNodeScore(right, degree) - semanticLodNodeScore(left, degree) || left.id.localeCompare(right.id))[0]
      if (representative) mustKeep.add(representative.id)
    })
    const trimmed = new Set(mustKeep)
    candidates
      .filter((item) => !trimmed.has(item.id))
      .sort((left, right) => semanticLodNodeScore(right, degree) - semanticLodNodeScore(left, degree) || left.id.localeCompare(right.id))
      .slice(0, Math.max(0, limit - trimmed.size))
      .forEach((item) => trimmed.add(item.id))
    visibleNodeIds = trimmed

    const aggregationNodeIds = collapsedNodeIds
    projected = {
      ...projected,
      elements: projected.elements.filter((item) => {
        if (item.type !== 'arrow') return aggregationNodeIds.has(item.id) || visibleNodeIds.has(item.id)
        if (aggregationNodeIds.has(item.from) || aggregationNodeIds.has(item.to)) return true
        return visibleNodeIds.has(item.from) && visibleNodeIds.has(item.to)
      }),
    }
  }

  const explicitVisibleNodes = candidates.filter((item) => visibleNodeIds.has(item.id)).length
  const explicitVisibleArrows = arrows.filter((arrow) => !collapsedNodeIds.has(arrow.from) && !collapsedNodeIds.has(arrow.to) && visibleNodeIds.has(arrow.from) && visibleNodeIds.has(arrow.to)).length
  return {
    scene: projected,
    level,
    autoCollapsedGroupIds: [...autoCollapsed],
    hiddenNodes: Math.max(0, boxes.length - explicitVisibleNodes),
    hiddenArrows: Math.max(0, arrows.length - explicitVisibleArrows),
  }
}

function semanticLodNodeLimit(level: CanvasSemanticLodLevel, nodeCount: number): number {
  if (level === 'overview') {
    if (nodeCount >= 3000) return 640
    if (nodeCount >= 1200) return 480
    if (nodeCount >= 500) return 360
    return 260
  }
  if (nodeCount >= 3000) return 220
  if (nodeCount >= 1200) return 180
  if (nodeCount >= 500) return 150
  return 120
}

function semanticLodNodeScore(item: CanvasNode | CanvasNote, degree: Map<string, number>): number {
  let score = (degree.get(item.id) ?? 0) * 24
  if (item.emphasis === 'primary') score += 20_000
  else if (item.emphasis === 'secondary') score += 2_000
  else if (item.emphasis === 'muted') score -= 600
  if (item.c4Type === 'person' || item.c4Type === 'software-system') score += 1_400
  else if (item.c4Type === 'container') score += 900
  if (item.icon === 'gateway' || item.icon === 'api' || item.icon === 'queue' || item.icon === 'database' || item.icon === 'external') score += 520
  if (item.stencil) score += 120
  if (item.description) score += 40
  return score
}

export function resolveCanvasArchitectureDensity(
  scene: CanvasScene,
  nodeCount = scene.elements.filter((item) => item.type !== 'arrow').length,
): Exclude<CanvasArchitectureDensity, 'auto'> {
  const requested = scene.architecture?.density ?? 'auto'
  if (requested !== 'auto') return requested
  if (nodeCount >= 46) return 'dense'
  if (nodeCount >= 22) return 'compact'
  return 'comfortable'
}

export function canvasArchitectureCardTemplate(item: CanvasNode | CanvasNote): CanvasArchitectureCardTemplate {
  if (item.icon === 'user' || item.c4Type === 'person') return { kind: 'actor', label: 'ACTOR' }
  if (item.icon === 'external' || (item.tone === 'muted' && /provider|third[- ]party|external|第三方|外部/i.test(`${item.text} ${item.subtitle ?? ''}`))) {
    return { kind: 'external', label: 'EXTERNAL' }
  }
  if (item.icon === 'web' || item.icon === 'gateway' || item.icon === 'api' || item.icon === 'auth') return { kind: 'entry', label: 'EDGE' }
  if (item.icon === 'queue' || item.icon === 'scheduler') return { kind: 'messaging', label: 'ASYNC' }
  if (item.icon === 'database' || item.icon === 'cache' || item.icon === 'search' || item.icon === 'vector' || item.icon === 'file') return { kind: 'data', label: 'DATA' }
  if (item.icon === 'service' || item.icon === 'worker' || item.icon === 'ai' || item.icon === 'mcp' || item.icon === 'cloud') return { kind: 'compute', label: 'RUNTIME' }
  return { kind: 'generic', label: item.c4Type ? c4Label(item.c4Type).toUpperCase() : 'COMPONENT' }
}

export function canvasArchitectureHeader(scene: CanvasScene): CanvasArchitectureHeader | undefined {
  // Architecture diagrams use the canvas itself as the composition surface.
  // A report-style banner consumed too much vertical space and made the result
  // look like a dashboard instead of a technical architecture drawing. Keep
  // the title on the tight Software System boundary instead.
  void scene
  return undefined
}

export function canvasArrowLabelLayouts(scene: CanvasScene): Map<string, CanvasArrowLabelLayout> {
  const collapsedOwners = canvasCollapsedOwners(scene)
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow' && !collapsedOwners.has(item.id)).map((item) => [item.id, item]))
  const occupied = new CanvasRectIndex([...boxes.values()].map((item) => ({ x: item.x - 8, y: item.y - 8, width: item.width + 16, height: item.height + 16 })))
  const arrows = scene.elements
    .filter((item): item is CanvasArrow => item.type === 'arrow' && Boolean(item.label))
    .slice()
    .sort((left, right) => Number(!left.labelPosition) - Number(!right.labelPosition) || emphasisRank(left.emphasis) - emphasisRank(right.emphasis) || left.id.localeCompare(right.id))
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()
  arrows.forEach((arrow) => {
    outgoing.set(arrow.from, (outgoing.get(arrow.from) ?? 0) + 1)
    incoming.set(arrow.to, (incoming.get(arrow.to) ?? 0) + 1)
  })
  const result = new Map<string, CanvasArrowLabelLayout>()

  for (const arrow of arrows) {
    const from = boxes.get(arrow.from)
    const to = boxes.get(arrow.to)
    const standalone = Boolean(arrow.start && arrow.end)
    if ((!standalone && (!from || !to)) || !arrow.label) continue
    const route = standalone
      ? canvasArrowRoutePoints(arrow.start!, arrow.end!, arrow)
      : canvasArrowBoxRoute(from!, to!, arrow, arrow.from === arrow.to)
    const dimensions = canvasArrowLabelText(arrow.label)
    const { width, height } = dimensions
    if (arrow.labelPosition) {
      const placed = { id: arrow.id, ...arrow.labelPosition, ...dimensions }
      occupied.add({ x: placed.x - width / 2, y: placed.y - height / 2, width, height })
      result.set(arrow.id, placed)
      continue
    }
    const segments = route.slice(0, -1).map((point, index) => {
      const next = route[index + 1]
      const horizontal = Math.abs(next.x - point.x) >= Math.abs(next.y - point.y)
      const length = Math.abs(next.x - point.x) + Math.abs(next.y - point.y)
      const bundledEndpoint = ((arrow.bundleKey?.startsWith('from:') || (outgoing.get(arrow.from) ?? 0) > 1) && index === 0)
        || ((arrow.bundleKey?.startsWith('to:') || (incoming.get(arrow.to) ?? 0) > 1) && index === route.length - 2)
      return { point, next, horizontal, length, bundledEndpoint }
    }).filter((segment) => segment.length >= 28)
      .sort((left, right) => Number(left.bundledEndpoint) - Number(right.bundledEndpoint) || Number(right.horizontal) - Number(left.horizontal) || right.length - left.length)
    let placed: CanvasArrowLabelLayout | undefined
    for (const segment of segments) {
      const gap = (segment.horizontal ? height : width) / 2 + 6
      for (const fraction of [0.5, 0.25, 0.75]) {
        for (const offset of [-gap, gap, -gap - height - 8, gap + height + 8]) {
          const x = segment.point.x + (segment.next.x - segment.point.x) * fraction + (segment.horizontal ? 0 : offset)
          const y = segment.point.y + (segment.next.y - segment.point.y) * fraction + (segment.horizontal ? offset : 0)
          const rect = { x: x - width / 2, y: y - height / 2, width, height }
          if (rect.x < 0 || rect.y < 0 || rect.x + width > scene.width || rect.y + height > scene.height) continue
          if (occupied.overlaps(rect)) continue
          placed = { id: arrow.id, x, y, ...dimensions }
          break
        }
        if (placed) break
      }
      if (placed) break
    }
    if (!placed) {
      const segment = segments[0]
      const routeStart = route[0]
      const routeEnd = route.at(-1)!
      const midpoint = segment
        ? { x: (segment.point.x + segment.next.x) / 2, y: (segment.point.y + segment.next.y) / 2 }
        : { x: (routeStart.x + routeEnd.x) / 2, y: (routeStart.y + routeEnd.y) / 2 }
      placed = { id: arrow.id, x: midpoint.x, y: midpoint.y - height / 2 - 6, ...dimensions }
    }
    occupied.add({ x: placed.x - width / 2, y: placed.y - height / 2, width, height })
    result.set(arrow.id, placed)
  }
  return result
}

function strongestEmphasis(arrows: CanvasArrow[]): CanvasEmphasis | undefined {
  if (arrows.some((arrow) => arrow.emphasis === 'primary')) return 'primary'
  if (arrows.some((arrow) => arrow.emphasis === 'secondary')) return 'secondary'
  if (arrows.some((arrow) => arrow.emphasis === 'muted')) return 'muted'
  return undefined
}

export function canvasGroupFrames(scene: CanvasScene): CanvasGroupFrame[] {
  const groups = scene.groups ?? []
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const boxes = scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow')
  const extents = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; memberIds: string[] }>()
  for (const item of boxes) {
    let groupId = item.groupId
    const seen = new Set<string>()
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId)
      const group = groupById.get(groupId)
      if (!group) break
      const current = extents.get(groupId)
      if (current) {
        current.minX = Math.min(current.minX, item.x)
        current.minY = Math.min(current.minY, item.y)
        current.maxX = Math.max(current.maxX, item.x + item.width)
        current.maxY = Math.max(current.maxY, item.y + item.height)
        current.memberIds.push(item.id)
      } else {
        extents.set(groupId, {
          minX: item.x,
          minY: item.y,
          maxX: item.x + item.width,
          maxY: item.y + item.height,
          memberIds: [item.id],
        })
      }
      groupId = group.parentId
    }
  }
  return groups.flatMap((group) => {
    const extent = extents.get(group.id)
    if (!extent) return []
    const minX = extent.minX - 24
    const minY = extent.minY - 42
    const maxX = extent.maxX + 24
    const maxY = extent.maxY + 24
    return [{
      ...group,
      x: minX,
      y: minY,
      width: group.collapsed ? Math.min(280, Math.max(180, maxX - minX)) : maxX - minX,
      height: group.collapsed ? 58 : maxY - minY,
      memberIds: extent.memberIds,
    }]
  })
}

/**
 * Presentation-only outlines for generated architecture regions.
 * The layout router, spatial checks, overview collapsing and editing bounds
 * continue to use canvasGroupFrames: changing those obstacles would silently
 * change topology/routing candidate selection.
 */
export function canvasPresentationGroupFrames(
  scene: CanvasScene,
  frames: readonly CanvasGroupFrame[] = canvasGroupFrames(scene),
): CanvasGroupFrame[] {
  if (!scene.architecture) return [...frames]
  return frames.map((frame) => {
    const generatedRegion = /^arch-(external|experience|application|processing|data)$/.test(frame.id)
      && frame.kind === 'boundary' && !frame.c4Type && !frame.collapsed
    if (!generatedRegion || frame.height < 92) return frame
    return { ...frame, y: frame.y + 16, height: frame.height - 36 }
  })
}

export function canvasCollapsedOwners(scene: CanvasScene): Map<string, string> {
  const groups = new Map((scene.groups ?? []).map((group) => [group.id, group]))
  const result = new Map<string, string>()
  scene.elements.forEach((item) => {
    if (item.type === 'arrow' || !item.groupId) return
    let groupId: string | undefined = item.groupId
    let owner: string | undefined
    const seen = new Set<string>()
    while (groupId && !seen.has(groupId)) {
      seen.add(groupId)
      const group = groups.get(groupId)
      if (!group) break
      if (group.collapsed) owner = group.id
      groupId = group.parentId
    }
    if (owner) result.set(item.id, owner)
  })
  return result
}

export function canvasCollapsedConnections(scene: CanvasScene, frames = canvasGroupFrames(scene)): CanvasCollapsedConnection[] {
  const boxes = new Map(scene.elements.filter((item): item is CanvasNode | CanvasNote => item.type !== 'arrow').map((item) => [item.id, item]))
  const owners = canvasCollapsedOwners(scene)
  const frameById = new Map(frames.map((frame) => [frame.id, frame]))
  const aggregate = new Map<string, CanvasCollapsedConnection>()
  scene.elements.forEach((item) => {
    if (item.type !== 'arrow') return
    const fromNode = boxes.get(item.from)
    const toNode = boxes.get(item.to)
    if (!fromNode || !toNode) return
    const fromOwner = owners.get(item.from)
    const toOwner = owners.get(item.to)
    if (!fromOwner && !toOwner) return
    const fromFrame = fromOwner ? frameById.get(fromOwner) : undefined
    const toFrame = toOwner ? frameById.get(toOwner) : undefined
    if (fromOwner && !fromFrame || toOwner && !toFrame) return
    const fromKey = fromOwner ? `group:${fromOwner}` : `node:${item.from}`
    const toKey = toOwner ? `group:${toOwner}` : `node:${item.to}`
    if (fromKey === toKey) return
    const key = `${fromKey}->${toKey}`
    const existing = aggregate.get(key)
    if (existing) {
      existing.count += 1
      if (item.label && !existing.labels.includes(item.label)) existing.labels.push(item.label)
      if (existing.lineStyle !== item.lineStyle) existing.lineStyle = 'solid'
      return
    }
    aggregate.set(key, {
      id: `collapsed:${key}`,
      fromKey,
      toKey,
      fromBox: fromFrame ?? fromNode,
      toBox: toFrame ?? toNode,
      count: 1,
      labels: item.label ? [item.label] : [],
      lineStyle: item.lineStyle,
      routing: 'orthogonal',
      fromAnchor: item.fromAnchor,
      toAnchor: item.toAnchor,
    })
  })
  return [...aggregate.values()]
}

function groupContains(targetId: string, candidateId: string, groups: Map<string, CanvasGroup>): boolean {
  let current: string | undefined = candidateId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === targetId) return true
    seen.add(current)
    current = groups.get(current)?.parentId
  }
  return false
}

function architectureGroupBreadcrumbs(groupId: string, groups: Map<string, CanvasGroup>): CanvasArchitectureBreadcrumb[] {
  const chain: CanvasArchitectureBreadcrumb[] = []
  let current: string | undefined = groupId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const group = groups.get(current)
    if (!group) break
    chain.push({ kind: 'group', id: group.id, label: group.label || group.id })
    current = group.parentId
  }
  return chain.reverse()
}

function isInsideCollapsedAncestor(groupId: string, groups: CanvasGroup[]): boolean {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  let current = groupById.get(groupId)?.parentId
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const group = groupById.get(current)
    if (!group) return false
    if (group.collapsed) return true
    current = group.parentId
  }
  return false
}

type CanvasAnchorBox = Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'> & Partial<Pick<CanvasNode, 'shapeRef' | 'rotation'>>

function centerOfCanvasBox(item: CanvasAnchorBox) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 }
}

function edgePoint(item: CanvasAnchorBox, toward: CanvasPoint) {
  const origin = centerOfCanvasBox(item)
  const rotation = ((item.rotation ?? 0) * Math.PI) / 180
  const inverseCos = Math.cos(-rotation)
  const inverseSin = Math.sin(-rotation)
  const worldDx = toward.x - origin.x
  const worldDy = toward.y - origin.y
  const dx = worldDx * inverseCos - worldDy * inverseSin
  const dy = worldDx * inverseSin + worldDy * inverseCos
  if (dx === 0 && dy === 0) return origin
  const halfWidth = Math.max(1, item.width / 2)
  const halfHeight = Math.max(1, item.height / 2)
  const scale = item.shapeRef === 'basic:ellipse'
    ? 1 / Math.sqrt((dx / halfWidth) ** 2 + (dy / halfHeight) ** 2)
    : item.shapeRef === 'basic:diamond' || item.shapeRef === 'flowchart:decision'
      ? 1 / (Math.abs(dx) / halfWidth + Math.abs(dy) / halfHeight)
      : 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight)
  const localX = dx * scale
  const localY = dy * scale
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: origin.x + localX * cos - localY * sin,
    y: origin.y + localX * sin + localY * cos,
  }
}

export function anchorPoint(item: CanvasAnchorBox, anchor: CanvasAnchor | undefined, toward: CanvasPoint): CanvasPoint {
  const center = centerOfCanvasBox(item)
  if (!anchor || anchor === 'auto') return edgePoint(item, toward)
  const local = anchor === 'top'
    ? { x: center.x, y: item.y }
    : anchor === 'right'
      ? { x: item.x + item.width, y: center.y }
      : anchor === 'bottom'
        ? { x: center.x, y: item.y + item.height }
        : { x: item.x, y: center.y }
  const rotation = ((item.rotation ?? 0) * Math.PI) / 180
  if (!rotation) return local
  const dx = local.x - center.x
  const dy = local.y - center.y
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

export function canvasArrowPath(start: CanvasPoint, end: CanvasPoint, arrow: Pick<CanvasArrow, 'routing' | 'points' | 'fromAnchor' | 'toAnchor' | 'freehand'>): string {
  return canvasArrowRoutePath(canvasArrowRoutePoints(start, end, arrow), arrow.freehand)
}

export function canvasArrowRoutePath(route: CanvasPoint[], freehand?: boolean): string {
  if (freehand && route.length > 2) {
    const commands = [`M ${route[0].x} ${route[0].y}`]
    for (let index = 1; index < route.length - 1; index += 1) {
      const current = route[index]
      const next = route[index + 1]
      commands.push(`Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`)
    }
    commands.push(`L ${route.at(-1)!.x} ${route.at(-1)!.y}`)
    return commands.join(' ')
  }
  return [`M ${route[0].x} ${route[0].y}`, ...route.slice(1).map((point) => `L ${point.x} ${point.y}`)].join(' ')
}

/** 按两个节点的真实几何计算关系路径，覆盖手工折点、锚点和自环。 */
export function canvasArrowBoxRoute(
  from: CanvasAnchorBox,
  to: CanvasAnchorBox,
  arrow: Pick<CanvasArrow, 'routing' | 'points' | 'fromAnchor' | 'toAnchor' | 'freehand'>,
  selfLoop = false,
): CanvasPoint[] {
  const loop = selfLoop ? selfLoopPoints(from) : undefined
  const start = anchorPoint(from, arrow.fromAnchor, arrow.points?.[0] ?? loop?.[0] ?? centerOfCanvasBox(to))
  const end = anchorPoint(to, arrow.toAnchor, arrow.points?.at(-1) ?? loop?.at(-1) ?? centerOfCanvasBox(from))
  return canvasArrowRoutePoints(start, end, loop ? { ...arrow, points: loop } : arrow)
}

// 自环没有可用的朝向向量，edgePoint 会退化到节点中心，整条线塌成一个点。
// 用节点右上方的一段折线绕出节点，锚点再朝这些外部点取边缘交点。
function selfLoopPoints(box: CanvasAnchorBox): CanvasPoint[] {
  const stub = Math.max(24, Math.min(48, Math.min(box.width, box.height) * 0.6))
  const right = box.x + box.width
  const above = box.y - stub
  return [
    { x: right + stub, y: box.y + box.height / 2 },
    { x: right + stub, y: above },
    { x: box.x + box.width / 2, y: above },
  ]
}

export function canvasArrowRoutePoints(start: CanvasPoint, end: CanvasPoint, arrow: Pick<CanvasArrow, 'routing' | 'points' | 'fromAnchor' | 'toAnchor'>): CanvasPoint[] {
  const points = arrow.points?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? []
  if (points.length > 0) return [start, ...points, end]
  if (arrow.routing !== 'orthogonal') return [start, end]
  const fromAxis = anchorAxis(arrow.fromAnchor)
  const toAxis = anchorAxis(arrow.toAnchor)
  // 两端法线互相垂直时，Z 形路线无法同时沿两条法线进出（会从锚点侧向滑出边框），
  // 因此改走两条法线的交点，保证首段和末段都沿各自锚点方向。
  if (fromAxis && toAxis && fromAxis !== toAxis) {
    return dedupeRoutePoints(fromAxis === 'y'
      ? [start, { x: start.x, y: end.y }, end]
      : [start, { x: end.x, y: start.y }, end])
  }
  const axis = fromAxis ?? toAxis ?? (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'x' : 'y')
  if (axis === 'y') {
    const midY = (start.y + end.y) / 2
    return dedupeRoutePoints([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end])
  }
  const midX = (start.x + end.x) / 2
  return dedupeRoutePoints([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end])
}

function anchorAxis(anchor: CanvasAnchor | undefined): 'x' | 'y' | undefined {
  if (anchor === 'left' || anchor === 'right') return 'x'
  if (anchor === 'top' || anchor === 'bottom') return 'y'
  return undefined
}

function shapeRadius(shape: CanvasShape | undefined, height: number): number {
  if (shape === 'square') return 3
  if (shape === 'pill') return Math.max(12, height / 2)
  return 12
}

function renderArchitectureCanvasNode(
  item: CanvasNode,
  palette: { fill: string; text: string; stroke: string },
  density: Exclude<CanvasArchitectureDensity, 'auto'>,
  theme: CanvasArchitectureTheme,
  fontOverride?: string,
  titleScale = 1,
  neutralSurface = '#f8fafc',
): string {
  const profile = canvasArchitectureThemeProfile(theme)
  const compact = density === 'dense'
  const iconSize = (compact ? 30 : density === 'compact' ? 34 : 38) * profile.iconScale
  const iconX = item.x + 14
  const iconY = item.y + (item.height - iconSize) / 2
  const hasIcon = Boolean(item.iconRef || item.stencil || item.icon)
  const textX = hasIcon ? iconX + iconSize + 12 : item.x + 16
  const titleY = item.y + item.height / 2 + (item.subtitle ? -4 : 4)
  const subtitleY = titleY + 17
  const titleSize = compact ? 12 : density === 'compact' ? 12.5 : 13
  const focused = item.emphasis === 'primary' && theme === 'enterprise'
  const subtitleSize = compact ? 9 : 9.5
  const opacity = item.opacity ?? (item.emphasis === 'muted' ? '0.88' : '1')
  const darkSurface = hexLuminance(palette.text) > 0.62
  const mark = item.iconRef
    ? architectureIconRefMark(item.iconRef, iconX, iconY, iconSize, palette.text, darkSurface)
    : item.stencil
      ? architectureStencilMark(item.stencil, iconX, iconY, iconSize, palette.stroke, darkSurface)
      : item.icon
        ? architectureRoleMark(item.icon, iconX, iconY, iconSize, palette.stroke)
        : ''
  const family = fontOverride ?? profile.fontFamily
  const fontFamily = family ? ` font-family="${family}"` : ''
  const subtitle = item.subtitle
    ? `<text x="${textX}" y="${subtitleY}" font-size="${subtitleSize}" fill="${escapeXml(palette.text)}" opacity="${profile.subtitleOpacity}"${fontFamily}>${escapeXml(truncateCanvasText(item.subtitle, compact ? 20 : 26))}</text>`
    : ''
  // Every architecture node, including a technology logo or external actor,
  // has the same hit area and visible card. No invisible technical-node plates.
  const plate = `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${profile.nodeRadius || 8}" fill="${escapeXml(item.fillColor ?? neutralSurface)}" fill-opacity="${item.fillColor ? 1 : 0.94}" stroke="${escapeXml(item.strokeColor ?? palette.stroke)}" stroke-opacity="${item.strokeColor ? 1 : focused ? 0.9 : 0.72}" stroke-width="${item.strokeWidth ?? (focused ? 1.7 : 1.25)}"/>`
  return `<g opacity="${opacity}">${plate}${mark}<text x="${textX}" y="${titleY}" font-size="${(titleSize + profile.titleSizeDelta + (focused ? 0.8 : 0)) * titleScale}" font-weight="${focused ? 730 : profile.titleWeight}" fill="${escapeXml(palette.text)}"${fontFamily}>${escapeXml(truncateCanvasText(item.text.replace(/\n/g, ' '), compact ? 20 : 26))}</text>${subtitle}</g>`
}

function canvasArchitectureThemeProfile(theme: CanvasArchitectureTheme) {
  switch (theme) {
    case 'cloud':
      return { edgeScale: 1.02, sketchEdges: false, groupSolid: true, groupScale: 0.9, groupFillOpacity: 0.025, groupStrokeOpacity: 0.24, groupRadius: 16, nodePlateOpacity: 0.20, nodeStrokeOpacity: 0.14, nodeStrokeWidth: 0.85, nodeRadius: 12, titleWeight: 670, titleSizeDelta: 0.15, iconScale: 1.05, fontFamily: '', subtitleOpacity: 0.62 }
    case 'technical':
      return { edgeScale: 0.9, sketchEdges: false, groupSolid: false, groupScale: 0.72, groupFillOpacity: 0, groupStrokeOpacity: 0.42, groupRadius: 2, nodePlateOpacity: 0, nodeStrokeOpacity: 0, nodeStrokeWidth: 0, nodeRadius: 2, titleWeight: 620, titleSizeDelta: -0.65, iconScale: 0.78, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', subtitleOpacity: 0.50 }
    case 'presentation':
      return { edgeScale: 1.12, sketchEdges: false, groupSolid: true, groupScale: 0.96, groupFillOpacity: 0.065, groupStrokeOpacity: 0.46, groupRadius: 12, nodePlateOpacity: 0.50, nodeStrokeOpacity: 0.22, nodeStrokeWidth: 1, nodeRadius: 14, titleWeight: 720, titleSizeDelta: 0.7, iconScale: 1.18, fontFamily: '', subtitleOpacity: 0.68 }
    case 'editorial':
      return { edgeScale: 0.86, sketchEdges: false, groupSolid: true, groupScale: 0.72, groupFillOpacity: 0, groupStrokeOpacity: 0.28, groupRadius: 0, nodePlateOpacity: 0, nodeStrokeOpacity: 0, nodeStrokeWidth: 0, nodeRadius: 0, titleWeight: 760, titleSizeDelta: 1.1, iconScale: 0.95, fontFamily: 'ui-serif, Georgia, serif', subtitleOpacity: 0.48 }
    case 'sketch':
      return { edgeScale: 1.06, sketchEdges: false, groupSolid: false, groupScale: 1.12, groupFillOpacity: 0, groupStrokeOpacity: 0.68, groupRadius: 2, nodePlateOpacity: 0.035, nodeStrokeOpacity: 0.62, nodeStrokeWidth: 1.25, nodeRadius: 3, titleWeight: 640, titleSizeDelta: 0.2, iconScale: 0.92, fontFamily: 'ui-rounded, system-ui, sans-serif', subtitleOpacity: 0.62 }
    default:
      return { edgeScale: 1, sketchEdges: false, groupSolid: false, groupScale: 0.9, groupFillOpacity: 0, groupStrokeOpacity: 0.50, groupRadius: 8, nodePlateOpacity: 0, nodeStrokeOpacity: 0, nodeStrokeWidth: 0, nodeRadius: 7, titleWeight: 650, titleSizeDelta: 0, iconScale: 1, fontFamily: '', subtitleOpacity: 0.58 }
  }
}

export function canvasArchitectureRelationLabelVisible(arrow: CanvasArrow): boolean {
  if (!arrow.label) return false
  if (arrow.emphasis === 'primary' && Array.from(arrow.label).length <= 10) return true
  return /\b(?:https?|rest|sse|grpc|websocket|oidc|oauth|sql|mcp|tcp|udp)\b|异步|事件|消息/i.test(arrow.label)
}

export function canvasIconRefLabel(ref: CanvasIconRef): string {
  return registryIconRefLabel(ref)
}

export function canvasIconRefMarkup(ref: CanvasIconRef, darkSurface = false, fallbackColor = 'currentColor'): string {
  const [source, id] = ref.split(':', 2)
  if (source === 'role') {
    const paths = canvasIconPaths(id as CanvasIcon)
    return `<g fill="none" stroke="${escapeXml(fallbackColor)}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`
  }
  if (source === 'simple') {
    const icon = canvasSimpleIcon(id as CanvasStencil)
    if (!icon) return ''
    const original = `#${icon.hex}`
    const color = darkSurface && hexLuminance(original) < 0.07 ? '#d1d5db' : original
    return `<path d="${icon.path}" fill="${color}" data-icon-ref="${escapeXml(ref)}"/>`
  }
  if (source === 'aws' || source === 'azure' || source === 'gcp') {
    const dataUri = cloudArchitectureIconData(ref)
    return dataUri ? `<image href="${escapeXml(dataUri)}" width="24" height="24" preserveAspectRatio="xMidYMid meet" data-icon-ref="${escapeXml(ref)}"/>` : ''
  }
  const node = canvasLucideIcon(id as CanvasLucideIconId)
  const children = node.map(([tag, attrs]) => {
    const attributes = Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
      .join(' ')
    return `<${tag}${attributes ? ` ${attributes}` : ''}/>`
  }).join('')
  return `<g fill="none" stroke="${escapeXml(fallbackColor)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${children}</g>`
}

function architectureRoleMark(icon: CanvasIcon, x: number, y: number, size: number, color: string): string {
  const paths = canvasIconPaths(icon)
  const scale = size / 24
  return `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="${Math.max(5, size * 0.22)}" fill="${escapeXml(color)}" fill-opacity="0.08" stroke="${escapeXml(color)}" stroke-opacity="0.18"/><g transform="scale(${scale})" fill="none" stroke="${escapeXml(color)}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></g>`
}

function architectureIconRefMark(ref: CanvasIconRef, x: number, y: number, size: number, fallback: string, darkSurface: boolean): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})">${canvasIconRefMarkup(ref, darkSurface, fallback)}</g>`
}

function architectureStencilMark(stencil: CanvasStencil, x: number, y: number, size: number, fallback: string, darkSurface: boolean): string {
  const simpleIcon = architectureSimpleIcon(stencil)
  if (simpleIcon) {
    const original = `#${simpleIcon.hex}`
    const brand = darkSurface && hexLuminance(original) < 0.07 ? '#d1d5db' : original
    return `<g transform="translate(${x} ${y}) scale(${size / 24})"><path d="${simpleIcon.path}" fill="${brand}"/></g>`
  }
  const brand = architectureStencilColor(stencil, fallback)
  const cx = x + size / 2
  const cy = y + size / 2
  const abbreviation = architectureStencilAbbreviation(stencil)
  if (stencil === 'react') {
    return `<g fill="none" stroke="${brand}" stroke-width="1.35"><ellipse cx="${cx}" cy="${cy}" rx="${size * 0.42}" ry="${size * 0.17}"/><ellipse cx="${cx}" cy="${cy}" rx="${size * 0.42}" ry="${size * 0.17}" transform="rotate(60 ${cx} ${cy})"/><ellipse cx="${cx}" cy="${cy}" rx="${size * 0.42}" ry="${size * 0.17}" transform="rotate(120 ${cx} ${cy})"/><circle cx="${cx}" cy="${cy}" r="${Math.max(2, size * 0.07)}" fill="${brand}"/></g>`
  }
  if (stencil === 'redis') {
    const top = y + size * 0.27
    return `<g fill="${brand}" fill-opacity="0.92"><path d="M ${x + size * 0.12} ${top} L ${cx} ${y + size * 0.08} L ${x + size * 0.88} ${top} L ${cx} ${y + size * 0.46} Z"/><path d="M ${x + size * 0.12} ${y + size * 0.48} L ${cx} ${y + size * 0.30} L ${x + size * 0.88} ${y + size * 0.48} L ${cx} ${y + size * 0.67} Z" opacity="0.78"/><path d="M ${x + size * 0.12} ${y + size * 0.69} L ${cx} ${y + size * 0.52} L ${x + size * 0.88} ${y + size * 0.69} L ${cx} ${y + size * 0.88} Z" opacity="0.58"/></g>`
  }
  if (stencil === 'kafka') {
    return `<g fill="none" stroke="${brand}" stroke-width="1.7"><circle cx="${cx}" cy="${cy}" r="${size * 0.10}" fill="${brand}"/><circle cx="${x + size * 0.25}" cy="${y + size * 0.24}" r="${size * 0.07}"/><circle cx="${x + size * 0.76}" cy="${y + size * 0.25}" r="${size * 0.07}"/><circle cx="${x + size * 0.28}" cy="${y + size * 0.76}" r="${size * 0.07}"/><circle cx="${x + size * 0.75}" cy="${y + size * 0.74}" r="${size * 0.07}"/><path d="M ${cx} ${cy} L ${x + size * 0.25} ${y + size * 0.24} M ${cx} ${cy} L ${x + size * 0.76} ${y + size * 0.25} M ${cx} ${cy} L ${x + size * 0.28} ${y + size * 0.76} M ${cx} ${cy} L ${x + size * 0.75} ${y + size * 0.74}"/></g>`
  }
  if (['postgres', 'mysql', 'mongodb', 'qdrant', 'opensearch', 'elasticsearch', 'minio'].includes(stencil)) {
    return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.max(5, size * 0.22)}" fill="${brand}" fill-opacity="0.10"/><text x="${cx}" y="${cy + size * 0.14}" text-anchor="middle" font-size="${Math.max(8, size * 0.30)}" font-weight="750" fill="${brand}">${escapeXml(abbreviation)}</text></g>`
  }
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.max(5, size * 0.22)}" fill="${brand}" fill-opacity="0.10" stroke="${brand}" stroke-opacity="0.18"/><text x="${cx}" y="${cy + size * 0.13}" text-anchor="middle" font-size="${Math.max(7, size * 0.27)}" font-weight="750" fill="${brand}">${escapeXml(abbreviation)}</text></g>`
}

function architectureSimpleIcon(stencil: CanvasStencil): { path: string; hex: string } | undefined {
  return canvasSimpleIcon(stencil)
}

export function canvasStencilVisual(stencil: CanvasStencil, darkSurface = false): { path?: string; color: string; label: string } {
  const simpleIcon = architectureSimpleIcon(stencil)
  const original = simpleIcon ? `#${simpleIcon.hex}` : architectureStencilColor(stencil, '#64748b')
  return {
    ...(simpleIcon ? { path: simpleIcon.path } : {}),
    color: darkSurface && hexLuminance(original) < 0.07 ? '#d1d5db' : original,
    label: architectureStencilAbbreviation(stencil),
  }
}

function architectureStencilAbbreviation(stencil: CanvasStencil): string {
  return ({
    spring: 'S', react: 'R', vue: 'V', postgres: 'PG', mysql: 'MY', redis: 'R', kafka: 'K', rabbitmq: 'MQ', docker: 'D', kubernetes: 'K8S', qdrant: 'Q', opensearch: 'OS', elasticsearch: 'ES', mongodb: 'M', minio: 'S3', nginx: 'N', grpc: 'gR', oidc: 'ID', openai: 'AI', mcp: 'MCP',
  })[stencil]
}

function architectureStencilColor(stencil: CanvasStencil, fallback: string): string {
  return ({
    spring: '#6DB33F', react: '#36A9C8', vue: '#42B883', postgres: '#336791', mysql: '#4479A1', redis: '#D82C20', kafka: '#555555', rabbitmq: '#FF6600', docker: '#2496ED', kubernetes: '#326CE5', qdrant: '#DC244C', opensearch: '#1769AA', elasticsearch: '#1BA9A0', mongodb: '#47A248', minio: '#C72C48', nginx: '#009639', grpc: '#5B6B7A', oidc: '#59636E', openai: '#10A37F', mcp: '#6D5CE7',
  })[stencil] ?? fallback
}

function canvasTonePalette(
  tone: CanvasTone | undefined,
  colors: { panel: string; text: string; border: string; note: string },
  kind: 'node' | 'note',
) {
  if (!tone || tone === 'default') return { fill: kind === 'note' ? colors.note : colors.panel, text: colors.text, stroke: colors.border }
  const palettes: Record<Exclude<CanvasTone, 'default'>, { fill: string; text: string; stroke: string }> = {
    accent: { fill: '#eef2ff', text: '#312e81', stroke: '#818cf8' },
    success: { fill: '#ecfdf5', text: '#065f46', stroke: '#34d399' },
    warning: { fill: '#fffbeb', text: '#92400e', stroke: '#fbbf24' },
    danger: { fill: '#fef2f2', text: '#991b1b', stroke: '#f87171' },
    muted: { fill: '#f5f5f5', text: '#525252', stroke: '#a3a3a3' },
  }
  return palettes[tone]
}

function canvasArchitectureTonePalette(
  tone: CanvasTone | undefined,
  colors: { panel: string; text: string; border: string; note: string },
  kind: 'node' | 'note',
) {
  if (!tone || tone === 'default') return { fill: kind === 'note' ? colors.note : colors.panel, text: colors.text, stroke: colors.border }
  const darkSurface = hexLuminance(colors.text) > 0.62
  if (darkSurface) {
    const palettes: Record<Exclude<CanvasTone, 'default'>, { fill: string; text: string; stroke: string }> = {
      accent: { fill: '#171d2f', text: '#e6e9ff', stroke: '#7886ff' },
      success: { fill: '#12241f', text: '#ddf9ed', stroke: '#42c99a' },
      warning: { fill: '#2a2113', text: '#fff0ce', stroke: '#dcae49' },
      danger: { fill: '#2b171a', text: '#ffe4e6', stroke: '#de6d79' },
      muted: { fill: '#1d1f22', text: '#e5e7eb', stroke: '#7d828a' },
    }
    return palettes[tone]
  }
  return canvasTonePalette(tone, colors, kind)
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function normalizeArchitectureAppearance(value: unknown): CanvasScene['architecture'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  const themes: CanvasArchitectureTheme[] = ['enterprise', 'technical', 'presentation', 'cloud', 'editorial', 'sketch']
  const views: CanvasArchitectureView[] = ['overview', 'detail']
  const densities: CanvasArchitectureDensity[] = ['auto', 'comfortable', 'compact', 'dense']
  const scenarios: CanvasArchitectureScenario[] = ['enterprise-system', 'microservices', 'data-platform', 'ai-agent', 'deployment']
  if (typeof item.theme !== 'string' || !themes.includes(item.theme as CanvasArchitectureTheme)) return undefined
  return {
    theme: item.theme as CanvasArchitectureTheme,
    ...(item.presentation === true ? { presentation: true } : {}),
    ...(typeof item.view === 'string' && views.includes(item.view as CanvasArchitectureView) ? { view: item.view as CanvasArchitectureView } : {}),
    ...(typeof item.density === 'string' && densities.includes(item.density as CanvasArchitectureDensity) ? { density: item.density as CanvasArchitectureDensity } : {}),
    ...(typeof item.titleScale === 'number' && Number.isFinite(item.titleScale) && item.titleScale >= 1 && item.titleScale <= 1.35 ? { titleScale: item.titleScale } : {}),
    ...(typeof item.scenario === 'string' && scenarios.includes(item.scenario as CanvasArchitectureScenario)
      ? { scenario: item.scenario as CanvasArchitectureScenario } : {}),
  }
}

function isCanvasElement(value: unknown): value is CanvasElement {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string') return false
  if (item.type === 'arrow') return typeof item.from === 'string' && typeof item.to === 'string'
  return (item.type === 'node' || item.type === 'note')
    && [item.x, item.y, item.width, item.height].every((part) => typeof part === 'number' && Number.isFinite(part))
    && typeof item.text === 'string'
}

function normalizedHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined
}

function normalizedUnitInterval(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

function normalizedRotation(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = ((value % 360) + 360) % 360
  const signed = normalized > 180 ? normalized - 360 : normalized
  return Math.abs(signed) < 0.0001 ? undefined : Math.round(signed * 100) / 100
}

function normalizeCanvasElement(item: CanvasElement): CanvasElement {
  if (item.type === 'arrow') {
    const emphases: CanvasEmphasis[] = ['primary', 'secondary', 'muted']
    return {
      id: item.id,
      type: 'arrow',
      from: item.from,
      to: item.to,
      ...(typeof item.label === 'string' && item.label ? { label: item.label } : {}),
      ...(item.lineStyle === 'solid' || item.lineStyle === 'dashed' || item.lineStyle === 'dotted' ? { lineStyle: item.lineStyle } : {}),
      ...(item.routing === 'straight' || item.routing === 'orthogonal' ? { routing: item.routing } : {}),
      ...(['auto', 'top', 'right', 'bottom', 'left'].includes(item.fromAnchor ?? '') ? { fromAnchor: item.fromAnchor } : {}),
      ...(['auto', 'top', 'right', 'bottom', 'left'].includes(item.toAnchor ?? '') ? { toAnchor: item.toAnchor } : {}),
      ...(Array.isArray(item.points) ? { points: item.points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)).slice(0, 480).map((point) => ({ x: point.x, y: point.y })) } : {}),
      ...(item.labelPosition && Number.isFinite(item.labelPosition.x) && Number.isFinite(item.labelPosition.y) ? { labelPosition: { x: item.labelPosition.x, y: item.labelPosition.y } } : {}),
      ...(item.emphasis && emphases.includes(item.emphasis) ? { emphasis: item.emphasis } : {}),
      ...(typeof item.bundleKey === 'string' && item.bundleKey.trim() ? { bundleKey: item.bundleKey.trim().slice(0, 120) } : {}),
      ...(item.start && Number.isFinite(item.start.x) && Number.isFinite(item.start.y) ? { start: { x: item.start.x, y: item.start.y } } : {}),
      ...(item.end && Number.isFinite(item.end.x) && Number.isFinite(item.end.y) ? { end: { x: item.end.x, y: item.end.y } } : {}),
      ...(item.markerEnd === 'none' || item.markerEnd === 'arrow' ? { markerEnd: item.markerEnd } : {}),
      ...(normalizedHexColor(item.strokeColor) ? { strokeColor: normalizedHexColor(item.strokeColor) } : {}),
      ...(typeof item.strokeWidth === 'number' && Number.isFinite(item.strokeWidth) && item.strokeWidth > 0 && item.strokeWidth <= 12 ? { strokeWidth: item.strokeWidth } : {}),
      ...(normalizedUnitInterval(item.opacity) !== undefined ? { opacity: normalizedUnitInterval(item.opacity) } : {}),
      ...(item.freehand === true ? { freehand: true } : {}),
    }
  }
  const tones: CanvasTone[] = ['default', 'accent', 'success', 'warning', 'danger', 'muted']
  const emphases: CanvasEmphasis[] = ['primary', 'secondary', 'muted']
  const shapes: CanvasShape[] = ['rounded', 'square', 'pill']
  const icons: readonly CanvasIcon[] = CANVAS_ROLE_ICON_IDS
  const stencils: readonly CanvasStencil[] = CANVAS_STENCIL_IDS
  const c4Types: CanvasC4Type[] = ['person', 'software-system', 'container', 'component']
  return {
    id: item.id,
    type: item.type,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    text: item.text,
    ...(item.tone && tones.includes(item.tone) ? { tone: item.tone } : {}),
    ...(item.shape && shapes.includes(item.shape) ? { shape: item.shape } : {}),
    ...(isCanvasShapeRef(item.shapeRef) ? { shapeRef: item.shapeRef } : {}),
    ...(item.locked === true ? { locked: true } : {}),
    ...(typeof item.groupId === 'string' && item.groupId.trim() ? { groupId: item.groupId.trim() } : {}),
    ...(Array.isArray(item.sourcePaths) ? { sourcePaths: item.sourcePaths.filter((path) => typeof path === 'string' && path.trim()).map((path) => path.trim()).slice(0, 12) } : {}),
    ...(item.icon && icons.includes(item.icon) ? { icon: item.icon } : {}),
    ...(item.stencil && stencils.includes(item.stencil) ? { stencil: item.stencil } : {}),
    ...(isCanvasIconRef(item.iconRef) ? { iconRef: item.iconRef } : {}),
    ...(typeof item.subtitle === 'string' && item.subtitle.trim() ? { subtitle: item.subtitle.trim().slice(0, 120) } : {}),
    ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 1000) } : {}),
    ...(Array.isArray(item.tags) ? { tags: item.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()).slice(0, 12) } : {}),
    ...(typeof item.laneId === 'string' && item.laneId.trim() ? { laneId: item.laneId.trim() } : {}),
    ...(item.c4Type && c4Types.includes(item.c4Type) ? { c4Type: item.c4Type } : {}),
    ...(item.emphasis && emphases.includes(item.emphasis) ? { emphasis: item.emphasis } : {}),
    ...(normalizedHexColor(item.fillColor) ? { fillColor: normalizedHexColor(item.fillColor) } : {}),
    ...(normalizedHexColor(item.strokeColor) ? { strokeColor: normalizedHexColor(item.strokeColor) } : {}),
    ...(typeof item.strokeWidth === 'number' && Number.isFinite(item.strokeWidth) && item.strokeWidth > 0 && item.strokeWidth <= 12 ? { strokeWidth: item.strokeWidth } : {}),
    ...(normalizedUnitInterval(item.opacity) !== undefined ? { opacity: normalizedUnitInterval(item.opacity) } : {}),
    ...(typeof item.cornerRadius === 'number' && Number.isFinite(item.cornerRadius) && item.cornerRadius >= 0 && item.cornerRadius <= 80 ? { cornerRadius: item.cornerRadius } : {}),
    ...(normalizedRotation(item.rotation) !== undefined ? { rotation: normalizedRotation(item.rotation) } : {}),
    ...(item.type === 'note' && item.textOnly === true ? { textOnly: true } : {}),
    ...(item.type === 'note' && typeof item.fontSize === 'number' && Number.isFinite(item.fontSize) && item.fontSize >= 8 && item.fontSize <= 96 ? { fontSize: item.fontSize } : {}),
    ...(item.type === 'note' && [400, 500, 600, 700].includes(item.fontWeight ?? 0) ? { fontWeight: item.fontWeight } : {}),
    ...(item.type === 'note' && normalizedHexColor(item.textColor) ? { textColor: normalizedHexColor(item.textColor) } : {}),
    ...(item.type === 'note' && typeof item.imagePath === 'string' && item.imagePath.trim() ? { imagePath: item.imagePath.trim().slice(0, 500) } : {}),
    ...(item.type === 'note' && (item.imageFit === 'contain' || item.imageFit === 'cover') ? { imageFit: item.imageFit } : {}),
  }
}

function normalizeCanvasGroups(value: unknown[]): CanvasGroup[] {
  const tones: CanvasTone[] = ['default', 'accent', 'success', 'warning', 'danger', 'muted']
  const seen = new Set<string>()
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id.trim())) return []
    const id = item.id.trim()
    seen.add(id)
    return [{
      id,
      ...(typeof item.label === 'string' && item.label.trim() ? { label: item.label.trim() } : {}),
      ...(typeof item.tone === 'string' && tones.includes(item.tone as CanvasTone) ? { tone: item.tone as CanvasTone } : {}),
      ...(item.kind === 'group' || item.kind === 'boundary' ? { kind: item.kind as CanvasGroupKind } : {}),
      ...(item.collapsed === true ? { collapsed: true } : {}),
      ...(typeof item.parentId === 'string' && item.parentId.trim() && item.parentId.trim() !== id ? { parentId: item.parentId.trim() } : {}),
      ...(item.c4Type === 'software-system' || item.c4Type === 'container' ? { c4Type: item.c4Type } : {}),
      ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim().slice(0, 1000) } : {}),
    }]
  })
}

function normalizeCanvasLanes(value: unknown[], width: number, height: number): CanvasLane[] {
  const tones: CanvasTone[] = ['default', 'accent', 'success', 'warning', 'danger', 'muted']
  const seen = new Set<string>()
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id.trim())) return []
    if (typeof item.label !== 'string' || !item.label.trim()) return []
    if (item.axis !== 'horizontal' && item.axis !== 'vertical') return []
    const id = item.id.trim()
    const max = item.axis === 'horizontal' ? height : width
    const start = Math.max(0, Math.min(max, typeof item.start === 'number' && Number.isFinite(item.start) ? item.start : 0))
    const size = Math.max(64, Math.min(max - start || 64, typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 240))
    seen.add(id)
    return [{
      id,
      label: item.label.trim().slice(0, 120),
      axis: item.axis,
      start,
      size,
      ...(typeof item.tone === 'string' && tones.includes(item.tone as CanvasTone) ? { tone: item.tone as CanvasTone } : {}),
    }]
  })
}

export function canvasStencilLabel(stencil: CanvasStencil): string {
  return ({ spring: 'SPRING', react: 'REACT', vue: 'VUE', postgres: 'PG', mysql: 'MYSQL', redis: 'REDIS', kafka: 'KAFKA', rabbitmq: 'RABBITMQ', docker: 'DOCKER', kubernetes: 'K8S', qdrant: 'QDRANT', opensearch: 'OPENSEARCH', elasticsearch: 'ELASTIC', mongodb: 'MONGO', minio: 'S3', nginx: 'NGINX', grpc: 'gRPC', oidc: 'OIDC', openai: 'LLM', mcp: 'MCP' })[stencil]
}

export function canvasIconLabel(icon: CanvasIcon): string {
  return ({ user: 'USER', web: 'WEB', api: 'API', gateway: 'GATEWAY', service: 'SERVICE', worker: 'WORKER', database: 'DATABASE', cache: 'CACHE', queue: 'QUEUE', search: 'SEARCH', vector: 'VECTOR', cloud: 'CLOUD', file: 'STORAGE', auth: 'AUTH', ai: 'AI', mcp: 'MCP', scheduler: 'SCHEDULE', external: 'EXTERNAL' })[icon]
}

export function canvasIconGlyph(icon: CanvasIcon): string {
  return ({ user: '◎', web: '▣', api: '⇄', gateway: '◇', service: '◆', worker: '⚙', database: '▤', cache: '⚡', queue: '≋', search: '⌕', vector: '✣', cloud: '☁', file: '▥', auth: '◆', ai: '✦', mcp: '⌘', scheduler: '◷', external: '↗' })[icon]
}

export function canvasIconPaths(icon: CanvasIcon): string[] {
  return ({
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21a8 8 0 0 1 16 0'],
    web: ['M3 5h18v14H3z', 'M3 9h18', 'M7 7h.01 M10 7h.01'],
    api: ['M5 7h5v5H5z', 'M14 12h5v5h-5z', 'M10 9h4 M12 9v6 M10 15h4'],
    gateway: ['M12 3 21 12 12 21 3 12z', 'M8 12h8', 'M13 9l3 3-3 3'],
    service: ['M12 3 20 7.5v9L12 21l-8-4.5v-9z', 'M8 10h8 M8 14h8'],
    worker: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v3 M12 19v3 M4.9 4.9 7 7 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1 7 17 M17 7l2.1-2.1'],
    database: ['M4 6c0-2 16-2 16 0s-16 2-16 0', 'M4 6v12c0 2 16 2 16 0V6', 'M4 12c0 2 16 2 16 0'],
    cache: ['M13 2 5 14h6l-1 8 9-13h-6z'],
    queue: ['M5 7h14 M5 12h14 M5 17h14', 'M3 7h.01 M3 12h.01 M3 17h.01'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M16 16l5 5'],
    vector: ['M5 6a2 2 0 1 0 0 .01 M19 6a2 2 0 1 0 0 .01 M12 18a2 2 0 1 0 0 .01', 'M7 7l4 9 M17 7l-4 9 M7 6h10'],
    cloud: ['M7 18h11a4 4 0 0 0 .5-8A6 6 0 0 0 7 8.5 4.5 4.5 0 0 0 7 18'],
    file: ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 13h6 M9 17h6'],
    auth: ['M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z', 'M9 12l2 2 4-5'],
    ai: ['M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z', 'M18 3v4 M16 5h4'],
    mcp: ['M6 7h5v5H6z M13 12h5v5h-5z', 'M11 9h4v5 M9 12v5h4'],
    scheduler: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'M12 8v5l3 2', 'M8 2v3 M16 2v3'],
    external: ['M8 16 16 8', 'M10 8h6v6', 'M5 5h6 M5 5v14h14v-6'],
  } satisfies Record<CanvasIcon, string[]>)[icon]
}

export function c4Label(type: CanvasC4Type | 'software-system' | 'container'): string {
  return ({ person: 'Person', 'software-system': 'System', container: 'Container', component: 'Component' })[type]
}

function overviewNodeLimit(density: Exclude<CanvasArchitectureDensity, 'auto'>): number {
  if (density === 'dense') return 26
  if (density === 'compact') return 22
  return 18
}

function architectureOverviewScore(item: CanvasNode | CanvasNote, degree: Map<string, number>): number {
  const emphasis = item.emphasis === 'primary' ? 90 : item.emphasis === 'secondary' || !item.emphasis ? 32 : -18
  const role: Partial<Record<CanvasIcon, number>> = {
    gateway: 20,
    api: 19,
    service: 18,
    worker: 16,
    ai: 16,
    mcp: 15,
    web: 14,
    auth: 13,
    queue: 12,
    search: 11,
    vector: 11,
    database: 10,
    cache: 9,
    external: 8,
    user: 8,
    file: 7,
    scheduler: 7,
    cloud: 7,
  }
  return emphasis + (item.icon ? role[item.icon] ?? 8 : 8) + Math.min(28, (degree.get(item.id) ?? 0) * 4)
}

function architectureDensityLabel(density: Exclude<CanvasArchitectureDensity, 'auto'>): string {
  if (density === 'dense') return '高密度'
  if (density === 'compact') return '紧凑'
  return '舒适'
}

function architectureCardBandColor(kind: CanvasArchitectureCardKind, semantic: string, fallback: string): string {
  if (kind === 'entry') return '#6366f1'
  if (kind === 'data') return '#10b981'
  if (kind === 'messaging') return '#f59e0b'
  if (kind === 'external') return fallback
  return semantic
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] || char)
}

function architectureHeaderToSvg(
  scene: CanvasScene,
  header: CanvasArchitectureHeader,
  colors: { background: string; text: string; border: string },
): string {
  const legendWidth = header.legend.length * 92
  const legendStart = Math.max(scene.width * 0.56, scene.width - legendWidth - 34)
  const legend = header.legend.map((item, index) => {
    const x = legendStart + index * 92
    const dash = item.kind === 'async' ? ' stroke-dasharray="6 4"' : ''
    const strokeWidth = item.kind === 'primary' ? 3 : 2
    const opacity = item.kind === 'secondary' ? '0.62' : '1'
    const stroke = item.kind === 'primary' ? '#6366f1' : colors.border
    return `<g opacity="${opacity}"><path d="M ${x} 50 L ${x + 26} 50" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" stroke-linecap="round"${dash}/><text x="${x + 34}" y="54" font-size="11" font-weight="600" fill="${escapeXml(colors.text)}">${escapeXml(item.label)}</text></g>`
  }).join('')
  return `<g><rect x="0" y="0" width="${scene.width}" height="${header.height}" fill="${escapeXml(colors.background)}"/><path d="M 28 ${header.height - 1} H ${scene.width - 28}" stroke="${escapeXml(colors.border)}" stroke-opacity="0.32"/><text x="32" y="24" font-size="10" font-weight="700" letter-spacing="1.4" fill="${escapeXml(colors.border)}">${escapeXml(header.eyebrow)}</text><text x="32" y="52" font-size="24" font-weight="720" fill="${escapeXml(colors.text)}">${escapeXml(truncateCanvasText(header.title, 42))}</text><text x="32" y="72" font-size="11" fill="${escapeXml(colors.border)}">${escapeXml(header.subtitle)}</text>${legend}</g>`
}

function truncateCanvasText(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : value
}

function emphasisRank(value: CanvasEmphasis | undefined): number {
  if (value === 'primary') return 0
  if (value === 'secondary' || !value) return 1
  return 2
}

function dedupeRoutePoints(points: CanvasPoint[]): CanvasPoint[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
}
