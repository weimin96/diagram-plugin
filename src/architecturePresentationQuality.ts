import type { CanvasNode, CanvasScene } from './canvas.js'

/** Diagnostics for fit-to-width viewing; independent of geometry scores. */
export interface ArchitecturePresentationQuality {
  referenceWidth: number
  estimatedTitlePxAtFit: number
  nodeBoundsCoverage: number
  nodeAreaCoverage: number
  warnings: Array<'small-fit-text' | 'low-content-coverage'>
}

export function assessArchitecturePresentation(
  scene: CanvasScene,
  referenceWidth = 1200,
): ArchitecturePresentationQuality {
  const nodes = scene.elements.filter((item): item is CanvasNode => item.type === 'node')
  const scale = Math.min(1, referenceWidth / Math.max(1, scene.width))
  const nominalTitlePx = scene.architecture?.density === 'dense' ? 12 : 12.5
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
