import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Measured width of a layout element in CSS pixels.
 *
 * Layout decisions must follow the space the editor actually got, not the window:
 * a thread panel can be 400px wide inside a 1600px window. The initial value is
 * only a pre-measurement estimate; the layout effect replaces it before paint.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, initial: number): number {
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = (next: number) => {
      if (next > 0) setWidth((current) => Math.abs(current - next) < 0.5 ? current : next)
    }
    measure(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
