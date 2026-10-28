import { diagramVisualStyles } from '../src/diagramVisualStyles.js'
import { setMermaidVisualStyle } from '../src/mermaidVisualGrammar.js'
import { mermaidDiagramTypes } from '../src/types.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mermaidVisualConfig, mermaidVisualProfile, normalizeMermaidSourceForRender, resolveMermaidVisualDensity, resolveMermaidVisualStyle } from '../src/mermaidVisualGrammar.js'

const palette = {
  background: '#ffffff', surface: '#fafafa', raised: '#f4f4f5', muted: '#eeeeef', text: '#18181b', secondaryText: '#6b7280',
  border: '#d4d4d8', strongBorder: '#a1a1aa', accent: '#2563eb', success: '#16803a', warning: '#b45309', danger: '#c9362b',
}

test('visual grammar applies type-aware spacing and semantic theme variables', () => {
  const config = mermaidVisualConfig('sequence', palette)
  assert.equal(config.sequence?.actorMargin, 72)
  assert.equal(config.sequence?.mirrorActors, false)
  assert.equal(config.themeVariables?.actorBkg, palette.raised)
  assert.equal(config.themeVariables?.signalColor, palette.secondaryText)
})

test('ER, state and mindmap use distinct layout policies', () => {
  const er = mermaidVisualConfig('er', palette)
  const state = mermaidVisualConfig('state', palette)
  const mindmap = mermaidVisualConfig('mindmap', palette)
  assert.equal(er.er?.layoutDirection, 'LR')
  assert.equal(state.state?.defaultRenderer, 'dagre-wrapper')
  assert.equal(state.look, 'neo')
  assert.equal(mindmap.mindmap?.maxNodeWidth, 190)
  assert.equal(mindmap.look, 'classic')
  assert.equal(mermaidVisualProfile('er'), 'schema')
  assert.equal(mermaidVisualProfile('state'), 'lifecycle')
  assert.equal(mermaidVisualProfile('mindmap'), 'hierarchy')
})

test('planning and positioning diagrams share tokens but retain specialized geometry', () => {
  const config = mermaidVisualConfig('gantt', palette)
  assert.equal(config.gantt?.displayMode, 'compact')
  assert.equal(config.themeVariables?.activeTaskBkgColor, palette.accent)
  const quadrant = mermaidVisualConfig('quadrant', palette)
  assert.equal(quadrant.quadrantChart?.chartWidth, 620)
  assert.equal(quadrant.themeVariables?.quadrantPointFill, palette.accent)
})

test('visual density compacts every diagram family without changing authored source', () => {
  const densityCases: { type: string; source: string; density: 'compact' | 'dense'; assert: (config: ReturnType<typeof mermaidVisualConfig>) => void }[] = [
    {
      type: 'sequence',
      source: ['sequenceDiagram', ...Array.from({ length: 10 }, (_, index) => `participant P${index}`), ...Array.from({ length: 32 }, (_, index) => `P${index % 10}->>P${(index + 1) % 10}: call`)].join('\n'),
      density: 'dense',
      assert: (config) => assert.equal(config.sequence?.actorMargin, 34),
    },
    {
      type: 'sequence',
      source: ['sequenceDiagram', ...Array.from({ length: 9 }, (_, index) => `participant P${index}`), ...Array.from({ length: 22 }, (_, index) => `P${index % 9}->>P${(index + 1) % 9}: call`), 'alt retry', 'P1->>P2: retry', 'end'].join('\n'),
      density: 'dense',
      assert: () => {},
    },
    {
      type: 'er',
      source: ['erDiagram', ...Array.from({ length: 12 }, (_, index) => `E${index} {\n string id PK\n}`)].join('\n'),
      density: 'compact',
      assert: (config) => assert.equal(config.er?.entityPadding, 10),
    },
    {
      type: 'er',
      source: ['erDiagram', ...Array.from({ length: 15 }, (_, index) => `E${index} { string id PK }`)].join('\n'),
      density: 'compact',
      assert: (config) => assert.equal(config.er?.entityPadding, 10),
    },
    {
      type: 'treemap',
      source: ['treemap-beta', '"Root"', ...Array.from({ length: 36 }, (_, index) => `  "Item ${index}": ${index + 1}`)].join('\n'),
      density: 'dense',
      assert: (config) => {
        assert.equal(config.treemap?.showValues, false)
        assert.equal(config.treemap?.labelFontSize, 12)
      },
    },
    {
      type: 'sankey',
      source: ['sankey-beta', '', ...Array.from({ length: 29 }, (_, index) => `A${index},B${index},${index + 1}`)].join('\n'),
      density: 'dense',
      assert: (config) => assert.equal(config.sankey?.nodePadding, 8),
    },
    {
      type: 'radar',
      source: ['radar-beta', 'axis a["A"],b["B"],c["C"]', ...Array.from({ length: 5 }, (_, index) => `curve c${index}["C${index}"]{1,2,3}`)].join('\n'),
      density: 'dense',
      assert: (config) => assert.equal(config.radar?.axisScaleFactor, 0.9),
    },
    {
      type: 'kanban',
      source: ['kanban', 'todo[Todo]', ...Array.from({ length: 18 }, (_, index) => `task${index}[Task ${index}]`)].join('\n'),
      density: 'compact',
      assert: (config) => assert.equal(config.kanban?.sectionWidth, 220),
    },
    {
      type: 'flowchart',
      source: ['flowchart TB', 'subgraph approval[Approval]', 'A --> B{Valid?}', 'B -- yes --> C{Small?}', 'C -- no --> D{Approved?}', 'D -- yes --> E{Success?}', 'E -- no --> F{Retry limit?}', 'F -- no --> E', 'end'].join('\n'),
      density: 'dense',
      assert: (config) => assert.equal(config.flowchart?.rankSpacing, 32),
    },
  ]
  assert.equal(densityCases.length, 9)
  for (const item of densityCases) {
    assert.equal(resolveMermaidVisualDensity(item.type, item.source), item.density, `${item.type} density`)
    item.assert(mermaidVisualConfig(item.type, palette, item.source))
  }
})

test('data and analysis diagrams use dedicated chart grammar instead of generic defaults', () => {
  const sankey = mermaidVisualConfig('sankey', palette)
  assert.equal(sankey.sankey?.linkColor, 'gradient')
  assert.equal(sankey.sankey?.showValues, true)
  assert.equal(mermaidVisualProfile('sankey'), 'flow-quantity')

  const xy = mermaidVisualConfig('xychart', palette)
  assert.equal(xy.xyChart?.showLegend, true)
  assert.equal(xy.themeVariables?.xyChart?.plotColorPalette, [palette.accent, palette.success, palette.warning, palette.danger, palette.secondaryText].join(','))

  const radar = mermaidVisualConfig('radar', palette)
  assert.equal(radar.radar?.width, 620)
  assert.equal(radar.themeVariables?.radar?.curveStrokeWidth, 2)
  assert.equal(mermaidVisualProfile('radar'), 'multi-axis')

  const requirement = mermaidVisualConfig('requirement', palette)
  assert.equal(requirement.requirement?.rect_fill, palette.raised)
  assert.equal(requirement.themeVariables?.requirementBorderColor, palette.strongBorder)

  const kanban = mermaidVisualConfig('kanban', palette)
  assert.equal(kanban.kanban?.sectionWidth, 250)

  const ishikawa = mermaidVisualConfig('ishikawa', palette)
  assert.equal(ishikawa.ishikawa?.useMaxWidth, true)
  assert.equal(mermaidVisualProfile('ishikawa'), 'root-cause')
})

test('flowchart render normalization removes HTML line breaks without rewriting authored source', () => {
  const source = 'flowchart TB\n  A["Parse<br/>retry"] --> B[Done]\n'
  const normalized = normalizeMermaidSourceForRender('flowchart', source)
  assert.equal(normalized, 'flowchart TB\n  A["Parse retry"] --> B[Done]\n')
  assert.match(source, /<br\/>/)
  assert.equal(normalizeMermaidSourceForRender('sequence', source), source)
})

test('visual style directives select stable profiles without changing the diagram grammar', () => {
  assert.equal(resolveMermaidVisualStyle('flowchart LR\n  A --> B'), 'technical')
  assert.equal(resolveMermaidVisualStyle('%% diagram-plugin:style=editorial\nflowchart LR\n  A --> B'), 'editorial')
  assert.equal(resolveMermaidVisualStyle('%% diagram-plugin:style=presentation\nflowchart LR\n  A --> B'), 'presentation')

  const technical = mermaidVisualConfig('flowchart', palette, 'flowchart LR\n  A --> B')
  const minimal = mermaidVisualConfig('flowchart', palette, '%% diagram-plugin:style=minimal\nflowchart LR\n  A --> B')
  const editorial = mermaidVisualConfig('flowchart', palette, '%% diagram-plugin:style=editorial\nflowchart LR\n  A --> B')
  const presentation = mermaidVisualConfig('flowchart', palette, '%% diagram-plugin:style=presentation\nflowchart LR\n  A --> B')

  assert.equal(technical.look, 'neo')
  assert.equal(minimal.look, 'classic')
  assert.equal(editorial.look, 'classic')
  assert.ok((minimal.flowchart?.nodeSpacing ?? 0) < (technical.flowchart?.nodeSpacing ?? 0))
  assert.ok((editorial.flowchart?.nodeSpacing ?? 0) > (technical.flowchart?.nodeSpacing ?? 0))
  assert.ok((presentation.flowchart?.nodeSpacing ?? 0) > (editorial.flowchart?.nodeSpacing ?? 0))
  assert.equal(presentation.themeVariables?.fontSize, '15px')
})

test('共享样式覆盖全部 Mermaid 图种，并保留各自的图形语法', () => {
  for (const { type } of mermaidDiagramTypes) {
    const outputs = new Set<string>()
    for (const style of diagramVisualStyles) {
      const source = `%% diagram-plugin:style=${style.id}\n`
      assert.equal(resolveMermaidVisualStyle(source), style.id)
      const config = mermaidVisualConfig(type, palette, source)
      assert.ok(config.fontFamily)
      assert.notEqual(config.themeVariables?.primaryBorderColor, palette.strongBorder)
      outputs.add(JSON.stringify(config))
    }
    assert.equal(outputs.size, diagramVisualStyles.length)
  }
})

test('style directives are rewritten in place and legacy prefixes migrate', () => {
  const source = '---\r\ntitle: 审批\r\n---\r\n%% diagram-plugin:style=warm\r\nsequenceDiagram\r\nA->>B: 请求\r\n'
  const changed = setMermaidVisualStyle(source, 'forest')
  assert.equal(changed, source.replace('style=warm', 'style=forest'))
  assert.equal(setMermaidVisualStyle(changed, 'forest'), changed)
  assert.equal(resolveMermaidVisualStyle('%% diagram-plugin:style=unknown\nflowchart LR'), 'technical')

  const legacy = '%% codex-diagram:style=warm\nflowchart LR\n  A --> B'
  assert.equal(resolveMermaidVisualStyle(legacy), 'warm')
  const migrated = setMermaidVisualStyle(legacy, 'forest')
  assert.ok(migrated.startsWith('%% diagram-plugin:style=forest\n'))
  assert.ok(!migrated.includes('codex-diagram'))
  assert.ok(migrated.includes('flowchart LR'))
})
