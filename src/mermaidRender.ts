import mermaid from 'mermaid'
import { fitMermaidSvgToContent } from './mermaidSvg.js'
import { createMermaidRenderQueue } from './mermaidRenderQueue.js'
import { detectDiagramType } from './templates.js'
import { mermaidVisualConfig, normalizeMermaidSourceForRender } from './mermaidVisualGrammar.js'
import { normalizeMermaidColor } from './colors.js'

const queueMermaidRender = createMermaidRenderQueue()

/** Read a theme variable as a concrete color, so Mermaid and canvas agree on it. */
export function resolveCssColor(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.pointerEvents = 'none'
  probe.style.visibility = 'hidden'
  probe.style.color = value
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return normalizeMermaidColor(resolved, fallback)
}

/** Render Mermaid to an SVG string with the current theme, one render at a time. */
export function renderMermaidSvg(source: string, renderId: string, isObsolete?: () => boolean): Promise<string> {
  return queueMermaidRender(async () => {
    const styles = getComputedStyle(document.documentElement)
    const type = detectDiagramType(source)
    const renderSource = normalizeMermaidSourceForRender(type, source)
    const visualConfig = mermaidVisualConfig(type, {
      background: resolveCssColor('--app-bg', '#ffffff'),
      surface: resolveCssColor('--surface-panel', '#fafafa'),
      raised: resolveCssColor('--surface-raised', '#f5f5f5'),
      muted: resolveCssColor('--surface-muted', '#eeeeee'),
      text: resolveCssColor('--text-primary', '#171717'),
      secondaryText: resolveCssColor('--text-secondary', '#666666'),
      border: resolveCssColor('--border', '#d4d4d4'),
      strongBorder: resolveCssColor('--border-strong', '#b8b8b8'),
      accent: resolveCssColor('--accent', '#2563eb'),
      success: resolveCssColor('--editor-string', '#16803a'),
      warning: resolveCssColor('--editor-type', '#b45309'),
      danger: resolveCssColor('--danger', '#c9362b'),
    }, renderSource)
    mermaid.initialize({
      ...visualConfig,
      fontFamily: visualConfig.fontFamily ?? (styles.getPropertyValue('--font-sans').trim() || 'ui-sans-serif, system-ui'),
    })
    const result = await mermaid.render(renderId, renderSource || 'flowchart LR\n  A[空图表]')
    return fitMermaidSvgToContent(serializeSafeSvg(result.svg), visualConfig.themeVariables?.background)
  }, isObsolete)
}

/** Turn Mermaid's markup into a DOM SVG with scripts, handlers and JS URLs stripped. */
export function createSafeSvgElement(markup: string): SVGSVGElement {
  const template = document.createElement('template')
  template.innerHTML = markup.trim()
  const svg = template.content.querySelector('svg')
  if (!(svg instanceof SVGSVGElement)) throw new Error('Mermaid 没有返回可渲染的 SVG。')
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (Array.from(clone.querySelectorAll('*')).some((element) => element.hasAttribute('xlink:href'))) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  clone.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove())
  const elements = [clone, ...Array.from(clone.querySelectorAll('*'))]
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && value.startsWith('javascript:'))) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return clone
}

export function serializeSafeSvg(markup: string): string {
  return new XMLSerializer().serializeToString(createSafeSvgElement(markup))
}
