import type { CanvasNode, CanvasScene } from './canvas.js'

/** Diagnostics for fit-to-width viewing; independent of geometry scores. */
export interface ArchitecturePresentationQuality {
  referenceWidth: number
  estimatedTitlePxAtFit: number
  nodeBoundsCoverage: number
  nodeAreaCoverage: number
  warnings: Array<'small-fit-text' | 'low-content-coverage'>
}

/** Compute a legible zoom for the real editor size, rather than assuming a
 * 1200px-wide canvas. This is a transient viewport adjustment, not a scene edit. */
export function recommendArchitectureReadableZoom(
  scene: CanvasScene,
  viewportWidth: number,
  viewportHeight: number,
  currentZoom = 1,
  targetFontPx = 11.5,
  maxZoom = 4,
): number {
  if (!scene.architecture || viewportWidth <= 0 || viewportHeight <= 0 || scene.width <= 0 || scene.height <= 0) {
    return currentZoom
  }
  const font = (scene.architecture.density === 'dense' ? 12 : 12.5) * (scene.architecture.titleScale ?? 1)
  const screenScaleAtOne = Math.min(viewportWidth / scene.width, viewportHeight / scene.height)
  const target = targetFontPx / Math.max(.01, font * screenScaleAtOne)
  return Math.min(maxZoom, Math.max(currentZoom, 1, Math.ceil(target * 100) / 100))
}

/** Boost generated titles only when they still fit their cards. Never upscale existing files implicitly. */
export function recommendArchitectureTitleScale(scene: CanvasScene, referenceWidth = 1200): number {
  if (!scene.architecture || scene.width <= referenceWidth || !scene.elements.length) return 1
  const scaleAtFit = referenceWidth / scene.width
  const base = scene.architecture.density === 'dense' ? 12 : 12.5
  const desired = Math.min(1.3, Math.max(1, 11.2 / Math.max(1, base * scaleAtFit)))
  if (desired <= 1) return 1
  const nodes = scene.elements.filter((element): element is CanvasNode => element.type === 'node')
  const cap = nodes.reduce((limit, node) => {
    const units = [...node.text].reduce((total, ch) =>
      total + (/\p{Script=Han}/u.test(ch) ? 1 : ch === ' ' ? .3 : .62), 0)
    const available = node.width - (node.icon || node.stencil || node.iconRef ? 76 : 24)
    return Math.min(limit, Math.max(1, available / Math.max(1, units * base)))
  }, desired)
  return Math.round(cap * 100) / 100
}

export function assessArchitecturePresentation(
  scene: CanvasScene,
  referenceWidth = 1200,
): ArchitecturePresentationQuality {
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const scale = Math.min(1, referenceWidth / Math.max(1, scene.width))
  const nominalTitlePx = (scene.architecture?.density === 'dense' ? 12 : 12.5)
    * (scene.architecture?.titleScale ?? 1)
  const estimatedTitlePxAtFit = Math.round(nominalTitlePx * scale * 10) / 10
  if (!nodes.length || scene.width <= 0 || scene.height <= 0) {
    return { referenceWidth, estimatedTitlePxAtFit, nodeBoundsCoverage: 0, nodeAreaCoverage: 0, warnings: [] }
  }
  const left = Math.min(...nodes.map((item) => item.x))
  const top = Math.min(...nodes.map((item) => item.y))
  const right = Math.max(...nodes.map((item) => item.x + item.width))
  const bottom = Math.max(...nodes.map((item) => item.y + item.height))
  const area = scene.width * scene.height
  const nodeBoundsCoverage = Math.round(Math.min(1, (right - left) * (bottom - top) / area) * 1000) / 1000
  const nodeAreaCoverage = Math.round(nodes.reduce((sum, item) => sum + item.width * item.height, 0) / area * 1000) / 1000
  const warnings: ArchitecturePresentationQuality['warnings'] = []
  if (estimatedTitlePxAtFit < 11) warnings.push('small-fit-text')
  if (nodes.length >= 6 && nodeBoundsCoverage < .48) warnings.push('low-content-coverage')
  return { referenceWidth, estimatedTitlePxAtFit, nodeBoundsCoverage, nodeAreaCoverage, warnings }
}
