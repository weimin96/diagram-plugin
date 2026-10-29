import { guidedRelationSurvives, pruneCanvasSelection } from './canvasSelection.js'
import type { CanvasScene } from './canvas.js'
import { useEffect, useMemo, useState } from 'react'

export interface CanvasSelectionDeps {
  scene: CanvasScene | null
}

export interface GuidedRelation {
  nodeId: string
  index: number
}

export interface CanvasSelectionHandle {
  selectedIds: string[]
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>
  selectedIdSet: Set<string>
  hoveredRelationId: string | null
  setHoveredRelationId: React.Dispatch<React.SetStateAction<string | null>>
  guidedRelation: GuidedRelation | null
  setGuidedRelation: React.Dispatch<React.SetStateAction<GuidedRelation | null>>
}

/**
 * Owns what the user has selected and which relation is being inspected.
 * The prune effect is the invariant that matters: a deleted element must not
 * stay selected, otherwise every downstream inspector reads a ghost.
 */
export function useCanvasSelection({ scene }: CanvasSelectionDeps): CanvasSelectionHandle {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null)
  const [guidedRelation, setGuidedRelation] = useState<GuidedRelation | null>(null)

  useEffect(() => {
    if (!scene) return
    const available = new Set(scene.elements.map((element) => element.id))
    setSelectedIds((current) => {
      const next = pruneCanvasSelection(current, available)
      return next === current ? current : [...next]
    })
  }, [scene])

  useEffect(() => {
    if (guidedRelation && !guidedRelationSurvives(guidedRelation, selectedIds)) setGuidedRelation(null)
  }, [guidedRelation, selectedIds])

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  return {
    selectedIds,
    setSelectedIds,
    selectedIdSet,
    hoveredRelationId,
    setHoveredRelationId,
    guidedRelation,
    setGuidedRelation,
  }
}
