import { fitCanvasViewport, panCanvasViewport, recenterCanvasViewport, zoomCanvasViewport, type CanvasViewport, type CanvasViewportFitOptions, type CanvasViewportRect } from './canvasViewport.js'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CanvasScene } from './canvas.js'

export interface CanvasViewportDeps {
  /** Live scene accessor; the editor throws before the scene is parsed. */
  currentScene: () => CanvasScene
  svgRef: RefObject<SVGSVGElement | null>
}

export interface CanvasViewportHandle {
  viewport: CanvasViewport
  setViewport: React.Dispatch<React.SetStateAction<CanvasViewport>>
  viewportRef: RefObject<CanvasViewport>
  spacePanning: boolean
  setSpacePanning: React.Dispatch<React.SetStateAction<boolean>>
  minimapOpen: boolean | null
  setMinimapOpen: React.Dispatch<React.SetStateAction<boolean | null>>
  zoomAt: (nextZoom: number, clientX?: number, clientY?: number) => void
  handleWheel: (event: React.WheelEvent<SVGSVGElement>) => void
  fitRects: (rects: readonly CanvasViewportRect[], options: CanvasViewportFitOptions) => void
  recenterFromMinimap: (event: React.PointerEvent<SVGSVGElement>, minimap: CanvasViewportRect) => void
  reset: () => void
}

/**
 * Owns everything about where the canvas is looking: the viewport transform,
 * the space-bar panning mode and the minimap toggle. Gestures and selection
 * stay in the editor; only the camera lives here, so the arithmetic can be
 * asserted without mounting an SVG.
 */
export function useCanvasViewport({ currentScene, svgRef }: CanvasViewportDeps): CanvasViewportHandle {
  const [viewport, setViewport] = useState<CanvasViewport>({ x: 0, y: 0, zoom: 1 })
  const [spacePanning, setSpacePanning] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState<boolean | null>(null)
  const viewportRef = useRef<CanvasViewport>(viewport)
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  function zoomAt(nextZoom: number, clientX?: number, clientY?: number) {
    const live = currentScene()
    const bounds = svgRef.current?.getBoundingClientRect()
    setViewport(zoomCanvasViewport({
      viewport,
      scene: live,
      nextZoom,
      ...(bounds ? { container: { width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top } } : {}),
      ...(clientX !== undefined ? { clientX } : {}),
      ...(clientY !== undefined ? { clientY } : {}),
    }))
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      zoomAt(viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY)
      return
    }
    const live = currentScene()
    const bounds = event.currentTarget.getBoundingClientRect()
    setViewport((current) => panCanvasViewport({
      viewport: current,
      scene: live,
      container: { width: bounds.width, height: bounds.height },
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    }))
  }

  function fitRects(rects: readonly CanvasViewportRect[], options: CanvasViewportFitOptions) {
    setViewport(fitCanvasViewport({ scene: currentScene(), rects, options }))
  }

  function recenterFromMinimap(event: React.PointerEvent<SVGSVGElement>, minimap: CanvasViewportRect) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const live = currentScene()
    setViewport((current) => recenterCanvasViewport({
      viewport: current,
      scene: live,
      minimap,
      container: { width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top },
      clientX: event.clientX,
      clientY: event.clientY,
    }))
  }

  function reset() {
    setViewport({ x: 0, y: 0, zoom: 1 })
  }

  return {
    viewport,
    setViewport,
    viewportRef,
    spacePanning,
    setSpacePanning,
    minimapOpen,
    setMinimapOpen,
    zoomAt,
    handleWheel,
    fitRects,
    recenterFromMinimap,
    reset,
  }
}
