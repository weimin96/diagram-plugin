/**
 * Workspace-scoped panel state.
 *
 * These fields all die together when the workspace changes. They used to be thirty
 * separate `useState` calls, which meant "switch workspace" had to enumerate every
 * setter by hand — and a forgotten one leaked the previous project's proposal, git
 * report or canvas selection into the new one. One owner, one reset.
 */

import { useMemo, useReducer } from 'react'
import type { CanvasPlaybackRequest, CanvasSelection } from './CanvasEditor.js'
import type { DiscardTarget } from './useDocumentCommands.js'
import type { DiagramGitImpactResult, DiagramProposalBranchSet, DiagramProposalSummary, DiagramThreadStateResult } from './reviewTypes.js'
import type { DiagramDocument } from './types.js'

export type GenerationPreset = { key: number; scope?: string; title?: string; instructions?: string }

export type CanvasFocus = { ids: string[]; key: string; trace?: DiagramThreadStateResult['trace'] }

export interface PanelState {
  creating: boolean
  sidebarCollapsed: boolean
  diagramQuery: string
  aiOpen: boolean
  aiMode: 'generate' | 'modify'
  generationPreset: GenerationPreset | undefined
  aiSending: boolean
  notice: string | null
  exporting: boolean
  splitPercent: number
  sourceSearchRequest: number
  documentMenuOpen: boolean
  renaming: boolean
  renameTitle: string
  deleteConfirmOpen: boolean
  threadDiagramMenuOpen: boolean
  threadDiagramQuery: string
  threadDiagramListLoading: boolean
  threadDiagramListError: string | null
  canvasSelection: CanvasSelection | null
  canvasFocus: CanvasFocus | null
  canvasPlayback: CanvasPlaybackRequest | null
  gitImpactReport: DiagramGitImpactResult | null
  gitImpactOpen: boolean
  aiProposal: { summary: DiagramProposalSummary; before: DiagramDocument; after: DiagramDocument } | null
  proposalBranchSet: DiagramProposalBranchSet | null
  proposalReviewOpen: boolean
  changeReview: { before: DiagramDocument; after: DiagramDocument } | null
  changeReviewOpen: boolean
  discardTarget: DiscardTarget | null
}

export type PanelKey = keyof PanelState

/** Fields that must be dropped when the workspace changes. */
export const WORKSPACE_SCOPED_KEYS: readonly PanelKey[] = [
  'threadDiagramMenuOpen',
  'threadDiagramQuery',
  'threadDiagramListError',
  'canvasSelection',
  'canvasFocus',
  'canvasPlayback',
  'gitImpactReport',
  'gitImpactOpen',
  'aiProposal',
  'proposalBranchSet',
  'proposalReviewOpen',
  'changeReview',
  'changeReviewOpen',
  'documentMenuOpen',
  'renaming',
  'deleteConfirmOpen',
  'discardTarget',
]

export const initialPanelState: PanelState = {
  creating: false,
  sidebarCollapsed: false,
  diagramQuery: '',
  aiOpen: false,
  aiMode: 'generate',
  generationPreset: undefined,
  aiSending: false,
  notice: null,
  exporting: false,
  splitPercent: 44,
  sourceSearchRequest: 0,
  documentMenuOpen: false,
  renaming: false,
  renameTitle: '',
  deleteConfirmOpen: false,
  threadDiagramMenuOpen: false,
  threadDiagramQuery: '',
  threadDiagramListLoading: false,
  threadDiagramListError: null,
  canvasSelection: null,
  canvasFocus: null,
  canvasPlayback: null,
  gitImpactReport: null,
  gitImpactOpen: false,
  aiProposal: null,
  proposalBranchSet: null,
  proposalReviewOpen: false,
  changeReview: null,
  changeReviewOpen: false,
  discardTarget: null,
}

export type PanelAction =
  | { type: 'set'; key: PanelKey; apply: (state: PanelState) => PanelState }
  | { type: 'reset-workspace' }

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  if (action.type === 'set') return action.apply(state)
  const next = { ...state }
  for (const key of WORKSPACE_SCOPED_KEYS) {
    Object.assign(next, { [key]: initialPanelState[key] })
  }
  return next
}

export type PanelSetter<K extends PanelKey> = (next: PanelState[K] | ((current: PanelState[K]) => PanelState[K])) => void

export type PanelSetters = { [K in PanelKey as `set${Capitalize<K>}`]: PanelSetter<K> }

export interface PanelStore {
  state: PanelState
  setters: PanelSetters
  resetWorkspace: () => void
}

export function usePanelStore(): PanelStore {
  const [state, dispatch] = useReducer(panelReducer, initialPanelState)

  return useMemo(() => {
    const set = <K extends PanelKey>(key: K, next: PanelState[K] | ((current: PanelState[K]) => PanelState[K])) => {
      dispatch({
        type: 'set',
        key,
        apply: (current) => ({
          ...current,
          [key]: typeof next === 'function' ? (next as (value: PanelState[K]) => PanelState[K])(current[key]) : next,
        }),
      })
    }

    const setters = {} as Record<string, unknown>
    for (const key of Object.keys(initialPanelState) as PanelKey[]) {
      setters[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] = (next: unknown) => set(key, next as never)
    }

    return {
      state,
      setters: setters as PanelSetters,
      resetWorkspace: () => dispatch({ type: 'reset-workspace' }),
    }
  }, [state])
}
