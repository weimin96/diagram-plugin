import { useEffect, useRef } from 'react'
import type { CanvasPoint } from './canvas.js'
import type { CanvasTransformBox } from './canvasOperations.js'
import type { GestureVisualDraft, InsertTarget, SnapGuides } from './canvasGesture.js'

type PositionOverrides = Record<string, CanvasPoint> | null
type TransformDrafts = Record<string, CanvasTransformBox> | null
type ArrowPointDraft = { id: string; points: CanvasPoint[] } | null
type ArrowLabelDraft = { id: string; position: CanvasPoint } | null

export type CanvasGestureDraftDeps = {
  setGesturePositionOverrides: (value: PositionOverrides) => void
  setSnapGuides: (value: SnapGuides) => void
  setInsertTarget: (value: InsertTarget | null) => void
  setTransformDrafts: (value: TransformDrafts) => void
  setArrowPointDraft: (value: ArrowPointDraft) => void
  setArrowLabelDraft: (value: ArrowLabelDraft) => void
}

/**
 * 手势期间的瞬态视觉状态：位置覆盖、吸附参考线、插入目标和几何草稿。
 *
 * 它们以 requestAnimationFrame 合并，每一帧最多提交一次 React 更新；从不写进
 * 文档或撤销栈。引用与调度器放在同一个所有者里，卸载时统一取消挂起的帧，
 * 避免指针离开窗口后仍有回调写入已卸载组件。
 */
export function useCanvasGestureDrafts(deps: CanvasGestureDraftDeps) {
  const {
    setGesturePositionOverrides, setSnapGuides, setInsertTarget,
    setTransformDrafts, setArrowPointDraft, setArrowLabelDraft,
  } = deps

  const gesturePositionOverridesRef = useRef<PositionOverrides>(null)
  const insertTargetRef = useRef<InsertTarget | null>(null)
  const transformDraftsRef = useRef<TransformDrafts>(null)
  const arrowPointDraftRef = useRef<ArrowPointDraft>(null)
  const arrowLabelDraftRef = useRef<ArrowLabelDraft>(null)
  const gestureVisualFrameRef = useRef<number | null>(null)
  const pendingGestureVisualRef = useRef<GestureVisualDraft | null>(null)
  const geometryDraftFrameRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (gestureVisualFrameRef.current !== null) window.cancelAnimationFrame(gestureVisualFrameRef.current)
    if (geometryDraftFrameRef.current !== null) window.cancelAnimationFrame(geometryDraftFrameRef.current)
  }, [])

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

  return {
    gesturePositionOverridesRef, insertTargetRef, transformDraftsRef, arrowPointDraftRef, arrowLabelDraftRef,
    scheduleGestureVisual, clearGestureVisual, clearGeometryDrafts, scheduleGeometryDraftRender,
  }
}
