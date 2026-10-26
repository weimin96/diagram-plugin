import { diagramStylePalette, isDiagramVisualStyle, type DiagramVisualStyle } from './diagramVisualStyles.js'
import type { MermaidConfig } from 'mermaid'
import type { MermaidDiagramType } from './types.js'

export interface MermaidVisualPalette {
  background: string
  surface: string
  raised: string
  muted: string
  text: string
  secondaryText: string
  border: string
  strongBorder: string
  accent: string
  success: string
  warning: string
  danger: string
}

export type MermaidVisualDensity = 'comfortable' | 'compact' | 'dense'
export type MermaidVisualStyle = 'technical' | 'minimal' | 'editorial' | 'presentation' | DiagramVisualStyle

interface MermaidTreemapRuntimeConfig {
  useMaxWidth?: boolean
  padding?: number
  diagramPadding?: number
  showValues?: boolean
  nodeWidth?: number
  nodeHeight?: number
  borderWidth?: number
  valueFontSize?: number
  labelFontSize?: number
  valueFormat?: string
}

export type MermaidVisualConfig = MermaidConfig & {
  /** Mermaid 11.17 supports this at runtime, but its public MermaidConfig typing omits it. */
  treemap?: MermaidTreemapRuntimeConfig
}

/** 当前样式指令前缀。 */
const STYLE_DIRECTIVE = 'diagram-plugin'
/** 改名前的样式指令前缀；旧图仍按同一套样式渲染。 */
const LEGACY_STYLE_DIRECTIVE = 'codex-diagram'

export function resolveMermaidVisualStyle(source: string): MermaidVisualStyle {
  const match = source.match(/^\s*%%\s*(?:diagram-plugin|codex-diagram):style=([a-z-]+)\s*$/im)
  const name = match?.[1]
  return name && (isDiagramVisualStyle(name) || ['technical', 'minimal', 'editorial', 'presentation'].includes(name)) ? name as MermaidVisualStyle : 'technical'
}

export function setMermaidVisualStyle(source: string, style: MermaidVisualStyle): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const clean = source.replace(/^[ \t]*%%[ \t]*(?:diagram-plugin|codex-diagram):style=[^\r\n]*(?:\r?\n|$)/gm, '')
  const frontmatter = clean.match(/^[ \t\r\n]*---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? ''
  const declaration = `%% ${STYLE_DIRECTIVE}:style=${style}${newline}`
  return frontmatter ? `${frontmatter}${frontmatter.endsWith('\n') ? '' : newline}${declaration}${clean.slice(frontmatter.length)}` : `${declaration}${clean}`
}

export function normalizeMermaidSourceForRender(type: MermaidDiagramType | 'unknown', source: string): string {
  if (type !== 'flowchart') return source
  // Mermaid 11.17 can produce a zero-sized SVG for flowchart HTML line breaks in
  // headless/browser measurement paths. Keep authored source untouched and only
  // normalize the render input so preview and export stay deterministic.
  return source.replace(/<br\s*\/?\s*>/gi, ' ')
}

export function resolveMermaidVisualDensity(type: MermaidDiagramType | 'unknown', source: string): MermaidVisualDensity {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('%%'))
  if (type === 'flowchart') {
    const decisions = lines.filter((line) => /\w+\s*\{[^}]+\}/.test(line)).length
    const relations = lines.filter((line) => /-->|---|==>|-.->/.test(line)).length
    const groups = lines.filter((line) => /^subgraph\b/i.test(line)).length
    if (decisions >= 5 || relations > 18 || groups >= 4) return 'dense'
    if (decisions >= 3 || relations > 11 || groups >= 2) return 'compact'
    if (lines.length > 24) return 'compact'
    return 'comfortable'
  }
  if (type === 'sequence') {
    const participants = lines.filter((line) => /^(participant|actor)\b/i.test(line)).length
    const messages = lines.filter((line) => /(?:--?>>|--?>|--?x|--?\)|--?\])/.test(line)).length
    const controlBlocks = lines.filter((line) => /^(alt|opt|par|loop|critical|break|rect)\b/i.test(line)).length
    if (participants > 9 || messages > 24 || (participants >= 9 && messages >= 20) || (controlBlocks >= 2 && messages >= 20)) return 'dense'
    if (participants > 6 || messages > 16 || (controlBlocks >= 1 && messages >= 14)) return 'compact'
    return 'comfortable'
  }
  if (type === 'er') {
    const entities = lines.filter((line) => /^(?:"[^"]+"|[\w-]+)\s*\{/.test(line)).length
    if (entities > 16) return 'dense'
    if (entities > 9) return 'compact'
    return 'comfortable'
  }
  if (type === 'mindmap') {
    const nodes = Math.max(0, lines.length - 1)
    if (nodes > 55) return 'dense'
    if (nodes > 28) return 'compact'
    return 'comfortable'
  }
  if (type === 'state' || type === 'class') {
    if (lines.length > 46) return 'dense'
    if (lines.length > 24) return 'compact'
    return 'comfortable'
  }
  if (type === 'kanban') {
    const cards = lines.filter((line) => /^\w+\[/.test(line)).length
    if (cards > 28) return 'dense'
    if (cards > 16) return 'compact'
    return 'comfortable'
  }
  if (type === 'requirement') {
    const items = lines.filter((line) => /^(requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\b/.test(line)).length
    if (items > 20) return 'dense'
    if (items > 11) return 'compact'
    return 'comfortable'
  }
  if (type === 'sankey') {
    const flows = Math.max(0, lines.length - 1)
    if (flows > 28) return 'dense'
    if (flows > 16) return 'compact'
    return 'comfortable'
  }
  if (type === 'radar') {
    const curves = lines.filter((line) => /^curve\b/i.test(line)).length
    if (curves > 4) return 'dense'
    if (curves > 2) return 'compact'
    return 'comfortable'
  }
  if (type === 'treemap' || type === 'ishikawa') {
    if (lines.length > 32) return 'dense'
    if (lines.length > 18) return 'compact'
    return 'comfortable'
  }
  if (lines.length > 42) return 'dense'
  if (lines.length > 22) return 'compact'
  return 'comfortable'
}

export function mermaidVisualConfig(type: MermaidDiagramType | 'unknown', palette: MermaidVisualPalette, source = ''): MermaidVisualConfig {
  const density = resolveMermaidVisualDensity(type, source)
  const requestedStyle = resolveMermaidVisualStyle(source)
  const sharedStyle = isDiagramVisualStyle(requestedStyle) ? requestedStyle : undefined
  const sharedPalette = sharedStyle ? diagramStylePalette(sharedStyle, palette.background) : undefined
  if (sharedPalette) palette = sharedPalette
  const style = sharedStyle ? sharedStyle === 'graphite' || sharedStyle === 'blueprint' ? 'minimal' : sharedStyle === 'warm' || sharedStyle === 'rose' ? 'editorial' : sharedStyle === 'coral' || sharedStyle === 'ink' ? 'presentation' : 'technical' : requestedStyle
  const requestedSpacing = style === 'minimal' ? 0.88 : style === 'editorial' ? 1.14 : style === 'presentation' ? 1.24 : 1
  const spacing = density === 'dense' ? Math.min(requestedSpacing, 1.08) : requestedSpacing
  const scaled = (value: number) => Math.round(value * spacing)
  const nodeSpacing = scaled(density === 'comfortable' ? 38 : density === 'compact' ? 30 : 24)
  const rankSpacing = scaled(density === 'comfortable' ? 58 : density === 'compact' ? 48 : 40)
  const flowchartRankSpacing = scaled(density === 'comfortable' ? 54 : density === 'compact' ? 42 : 32)
  const actorMargin = scaled(density === 'comfortable' ? 72 : density === 'compact' ? 58 : 46)
  const messageMargin = scaled(density === 'comfortable' ? 34 : density === 'compact' ? 29 : 24)
  const actorWidth = scaled(density === 'comfortable' ? 150 : density === 'compact' ? 136 : 118)
  const actorHeight = scaled(density === 'comfortable' ? 50 : density === 'compact' ? 47 : 44)
  const entityPadding = scaled(density === 'comfortable' ? 12 : density === 'compact' ? 10 : 8)
  const fontSize = style === 'minimal' ? '12px' : style === 'editorial' ? '14px' : style === 'presentation' ? '15px' : '13px'
  const fontWeight = style === 'presentation' ? '600' : style === 'editorial' ? '550' : '500'
  const radius = sharedPalette?.radius ?? (style === 'minimal' ? 5 : style === 'editorial' ? 10 : style === 'presentation' ? 12 : 8)
  const strokeWidth = sharedPalette ? `${sharedPalette.strokeWidth}px` : style === 'presentation' ? '1.5px' : style === 'editorial' ? '1.25px' : '1px'
  const themeVariables = {
    fontSize,
    fontWeight,
    radius,
    strokeWidth,
    dropShadow: 'none',
    ...(sharedPalette ? { actor0: palette.accent, actor1: palette.success, actor2: palette.warning, actor3: palette.danger } : {}),
    background: palette.background,
    primaryColor: palette.raised,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.strongBorder,
    secondaryColor: palette.muted,
    secondaryTextColor: palette.text,
    secondaryBorderColor: palette.border,
    tertiaryColor: palette.surface,
    tertiaryTextColor: palette.text,
    tertiaryBorderColor: palette.border,
    lineColor: palette.secondaryText,
    arrowheadColor: palette.secondaryText,
    textColor: palette.text,
    titleColor: palette.text,
    edgeLabelBackground: palette.surface,
    nodeBkg: palette.raised,
    nodeBorder: palette.strongBorder,
    nodeTextColor: palette.text,
    clusterBkg: palette.surface,
    clusterBorder: palette.border,
    actorBkg: palette.raised,
    actorBorder: palette.strongBorder,
    actorTextColor: palette.text,
    actorLineColor: palette.border,
    signalColor: palette.secondaryText,
    signalTextColor: palette.text,
    labelBoxBkgColor: palette.surface,
    labelBoxBorderColor: palette.border,
    labelTextColor: palette.text,
    loopTextColor: palette.text,
    activationBkgColor: palette.muted,
    activationBorderColor: palette.accent,
    noteBkgColor: palette.surface,
    noteBorderColor: palette.border,
    noteTextColor: palette.text,
    transitionColor: palette.secondaryText,
    transitionLabelColor: palette.text,
    stateLabelColor: palette.text,
    stateBkg: palette.raised,
    compositeBackground: palette.surface,
    compositeBorder: palette.border,
    compositeTitleBackground: palette.muted,
    specialStateColor: palette.accent,
    rowOdd: palette.raised,
    rowEven: palette.surface,
    relationColor: palette.secondaryText,
    relationLabelBackground: palette.surface,
    relationLabelColor: palette.text,
    sectionBkgColor: palette.surface,
    sectionBkgColor2: palette.raised,
    altSectionBkgColor: palette.muted,
    taskBkgColor: palette.raised,
    taskBorderColor: palette.strongBorder,
    activeTaskBkgColor: palette.accent,
    activeTaskBorderColor: palette.accent,
    doneTaskBkgColor: palette.muted,
    doneTaskBorderColor: palette.border,
    critBkgColor: palette.danger,
    critBorderColor: palette.danger,
    gridColor: palette.border,
    todayLineColor: palette.warning,
    taskTextColor: palette.text,
    taskTextOutsideColor: palette.text,
    quadrant1Fill: palette.muted,
    quadrant2Fill: palette.surface,
    quadrant3Fill: palette.raised,
    quadrant4Fill: palette.muted,
    quadrant1TextFill: palette.text,
    quadrant2TextFill: palette.text,
    quadrant3TextFill: palette.text,
    quadrant4TextFill: palette.text,
    quadrantPointFill: palette.accent,
    quadrantPointTextFill: palette.text,
    quadrantXAxisTextFill: palette.secondaryText,
    quadrantYAxisTextFill: palette.secondaryText,
    quadrantInternalBorderStrokeFill: palette.border,
    quadrantExternalBorderStrokeFill: palette.strongBorder,
    quadrantTitleFill: palette.text,
    git0: palette.accent,
    git1: palette.success,
    git2: palette.warning,
    git3: palette.danger,
    git4: palette.secondaryText,
    gitInv0: palette.surface,
    gitInv1: palette.surface,
    gitInv2: palette.surface,
    gitInv3: palette.surface,
    branchLabelColor: palette.text,
    commitLabelColor: palette.text,
    commitLabelBackground: palette.surface,
    tagLabelColor: palette.text,
    tagLabelBackground: palette.muted,
    tagLabelBorder: palette.border,
    cScale0: palette.accent,
    cScale1: palette.success,
    cScale2: palette.warning,
    cScale3: palette.danger,
    cScale4: palette.secondaryText,
    cScale5: palette.strongBorder,
    pie1: palette.accent,
    pie2: palette.success,
    pie3: palette.warning,
    pie4: palette.danger,
    pie5: palette.secondaryText,
    pie6: palette.strongBorder,
    pieStrokeColor: palette.background,
    pieOuterStrokeColor: palette.border,
    pieSectionTextColor: sharedPalette ? sharedPalette.dark ? '#182333' : '#ffffff' : palette.text,
    pieLegendTextColor: palette.text,
    requirementBackground: palette.raised,
    requirementBorderColor: palette.strongBorder,
    requirementBorderSize: '1',
    requirementTextColor: palette.text,
    xyChart: {
      backgroundColor: palette.background,
      titleColor: palette.text,
      dataLabelColor: palette.text,
      legendTextColor: palette.text,
      xAxisTitleColor: palette.text,
      xAxisLabelColor: palette.secondaryText,
      xAxisTickColor: palette.border,
      xAxisLineColor: palette.strongBorder,
      yAxisTitleColor: palette.text,
      yAxisLabelColor: palette.secondaryText,
      yAxisTickColor: palette.border,
      yAxisLineColor: palette.strongBorder,
      plotColorPalette: [palette.accent, palette.success, palette.warning, palette.danger, palette.secondaryText].join(','),
    },
    radar: {
      axisColor: palette.strongBorder,
      axisStrokeWidth: 1,
      axisLabelFontSize: 12,
      curveOpacity: 0.34,
      curveStrokeWidth: 2,
      graticuleColor: palette.border,
      graticuleStrokeWidth: 1,
      graticuleOpacity: 0.6,
      legendBoxSize: 11,
      legendFontSize: 12,
    },
  }

  return {
    startOnLoad: false,
    ...(sharedPalette ? { fontFamily: sharedPalette.font } : {}),
    securityLevel: 'strict',
    theme: 'base',
    look: (type === 'flowchart' || type === 'state' || type === 'class') && style !== 'minimal' && style !== 'editorial' ? 'neo' : 'classic',
    themeVariables,
    markdownAutoWrap: true,
    flowchart: {
      diagramPadding: scaled(16),
      htmlLabels: true,
      nodeSpacing,
      rankSpacing: flowchartRankSpacing,
      defaultRenderer: 'dagre-wrapper',
      curve: 'linear',
      padding: scaled(density === 'dense' ? 9 : 12),
      wrappingWidth: scaled(density === 'dense' ? 170 : 190),
    },
    sequence: {
      diagramMarginX: scaled(density === 'dense' ? 18 : 28),
      diagramMarginY: scaled(density === 'dense' ? 10 : 18),
      actorMargin: density === 'dense' ? scaled(34) : actorMargin,
      width: actorWidth,
      height: density === 'dense' ? scaled(42) : actorHeight,
      boxMargin: scaled(density === 'dense' ? 7 : 10),
      boxTextMargin: scaled(density === 'dense' ? 4 : 6),
      noteMargin: scaled(density === 'dense' ? 10 : 14),
      messageMargin: density === 'dense' ? scaled(16) : messageMargin,
      mirrorActors: false,
      bottomMarginAdj: 8,
      actorFontSize: style === 'presentation' ? 15 : style === 'editorial' ? 14 : 13,
      messageFontSize: style === 'presentation' ? 14 : style === 'editorial' ? 13 : 12,
      noteFontSize: style === 'presentation' ? 13 : 12,
      wrap: true,
      wrapPadding: scaled(density === 'dense' ? 7 : 10),
    },
    er: {
      diagramPadding: scaled(18),
      layoutDirection: 'LR',
      minEntityWidth: scaled(120),
      minEntityHeight: scaled(70),
      entityPadding,
      nodeSpacing: nodeSpacing + 2,
      rankSpacing: rankSpacing + 4,
      fontSize: style === 'presentation' ? 14 : style === 'editorial' ? 13 : 12,
      stroke: palette.strongBorder,
      fill: palette.raised,
    },
    state: {
      padding: scaled(12),
      noteMargin: scaled(12),
      nodeSpacing: nodeSpacing + 4,
      rankSpacing,
      miniPadding: scaled(5),
      fontSize: style === 'presentation' ? 14 : style === 'editorial' ? 13 : 12,
      radius,
      defaultRenderer: 'dagre-wrapper',
    },
    mindmap: {
      padding: scaled(14),
      maxNodeWidth: scaled(density === 'dense' ? 160 : density === 'compact' ? 175 : 190),
    },
    class: {
      padding: scaled(10),
      nodeSpacing: nodeSpacing + 4,
      rankSpacing,
      diagramPadding: scaled(16),
      htmlLabels: true,
      hideEmptyMembersBox: true,
      hierarchicalNamespaces: true,
      defaultRenderer: 'dagre-wrapper',
    },
    gantt: {
      barHeight: 20,
      barGap: 6,
      topPadding: 46,
      rightPadding: 30,
      leftPadding: 84,
      fontSize: 12,
      sectionFontSize: 12,
      displayMode: 'compact',
    },
    timeline: {
      diagramMarginX: 28,
      diagramMarginY: 18,
      padding: 10,
      boxMargin: 10,
      taskMargin: 10,
      taskFontSize: 12,
      disableMulticolor: true,
    },
    journey: {
      diagramMarginX: 28,
      diagramMarginY: 18,
      leftMargin: 120,
      maxLabelWidth: 220,
      boxMargin: 10,
      taskMargin: 18,
      taskFontSize: 12,
      actorColours: [palette.accent, palette.success, palette.warning, palette.secondaryText],
      sectionFills: [palette.surface, palette.raised, palette.muted],
      sectionColours: [palette.text, palette.text, palette.text],
      titleColor: palette.text,
    },
    gitGraph: {
      diagramPadding: 14,
      showCommitLabel: true,
      showBranches: true,
    },
    quadrantChart: {
      chartWidth: 620,
      chartHeight: 620,
      titleFontSize: 18,
      titlePadding: 12,
      quadrantPadding: 10,
      xAxisLabelPadding: 8,
      yAxisLabelPadding: 8,
      xAxisLabelFontSize: 12,
      yAxisLabelFontSize: 12,
      quadrantLabelFontSize: 13,
      pointLabelFontSize: 11,
      pointRadius: 5,
      quadrantInternalBorderStrokeWidth: 1,
      quadrantExternalBorderStrokeWidth: 1,
    },
    pie: {
      textPosition: 0.72,
      donutHole: 0,
      legendPosition: 'right',
    },
    xyChart: {
      width: 720,
      height: 460,
      titleFontSize: 18,
      titlePadding: 12,
      showDataLabel: density === 'comfortable',
      showDataLabelOutsideBar: Boolean(sharedPalette),
      showTitle: true,
      showLegend: true,
      legendFontSize: 12,
      legendPadding: 8,
    },
    requirement: {
      rect_fill: palette.raised,
      text_color: palette.text,
      rect_border_size: '1',
      rect_border_color: palette.strongBorder,
      rect_min_width: density === 'dense' ? 170 : density === 'compact' ? 195 : 220,
      rect_min_height: 70,
      fontSize: 12,
      rect_padding: density === 'dense' ? 8 : 10,
      line_height: 20,
    },
    kanban: {
      padding: density === 'dense' ? 8 : 12,
      sectionWidth: density === 'dense' ? 190 : density === 'compact' ? 220 : 250,
    },
    sankey: {
      width: 760,
      height: density === 'dense' ? 460 : 520,
      linkColor: 'gradient',
      nodeAlignment: 'justify',
      useMaxWidth: true,
      showValues: true,
      nodeWidth: 12,
      nodePadding: density === 'dense' ? 8 : 14,
      labelStyle: 'outlined',
    },
    treemap: {
      useMaxWidth: true,
      padding: density === 'dense' ? 7 : 10,
      diagramPadding: density === 'dense' ? 18 : 12,
      showValues: density !== 'dense',
      nodeWidth: density === 'dense' ? 92 : 100,
      nodeHeight: density === 'dense' ? 36 : 40,
      borderWidth: 1,
      valueFontSize: density === 'dense' ? 10 : 12,
      labelFontSize: density === 'dense' ? 12 : 14,
      valueFormat: ',',
    },
    radar: {
      width: 620,
      height: 520,
      // Leave space between the title and the upper axis label. Real Chrome
      // geometry A/B: 44px had one text collision; 56px has zero with only
      // 12px extra height. Keep authored radar data and axes untouched.
      marginTop: 56,
      marginRight: 72,
      marginBottom: 54,
      marginLeft: 72,
      axisScaleFactor: density === 'dense' ? 0.9 : 1,
      axisLabelFactor: 1.08,
      curveTension: 0.16,
    },
    ishikawa: {
      diagramPadding: density === 'dense' ? 14 : 22,
      useMaxWidth: true,
    },
  }
}

export function mermaidVisualProfile(type: MermaidDiagramType | 'unknown'): string {
  return ({
    flowchart: 'process', sequence: 'interaction', er: 'schema', state: 'lifecycle', mindmap: 'hierarchy', class: 'structure',
    gantt: 'planning', timeline: 'chronology', gitgraph: 'versioning', journey: 'experience', quadrant: 'positioning',
    kanban: 'work-management', requirement: 'traceability', sankey: 'flow-quantity', xychart: 'metrics', pie: 'composition', radar: 'multi-axis', treemap: 'hierarchical-composition', ishikawa: 'root-cause', unknown: 'generic',
  } as const)[type]
}
