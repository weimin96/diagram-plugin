/**
 * The open-document session.
 *
 * Everything the panel knows about "which diagram is open and does it match
 * disk" lives here: the document record, the draft source, the save flag, the
 * conflict flags and the derived dirty/deleted selectors.
 *
 * It is a pure reducer on purpose. The panel used to spread those seven pieces
 * across twenty-odd `setState` calls in unrelated commands, so "is this draft
 * dirty" and "did the file change underneath us" could disagree. Every write is
 * now a named intent, and the selectors are the only definition of dirty.
 */

import type { DiagramDocument } from './types.js'

export interface DocumentSessionState {
  document: DiagramDocument | null
  source: string
  saving: boolean
  error: string | null
  /** Disk changed while the draft was dirty: the user has to decide. */
  externalChange: boolean
  /** Path whose draft outlived the file on disk. */
  deletedDraftPath: string | null
  loadingPath: string | null
}

export type DocumentSessionAction =
  | { type: 'open'; document: DiagramDocument }
  | { type: 'close' }
  | { type: 'draft'; source: string }
  | { type: 'saving'; saving: boolean }
  | { type: 'error'; message: string | null }
  | { type: 'synced'; document: DiagramDocument }
  | { type: 'external-change'; value: boolean }
  | { type: 'deleted-draft'; path: string | null }
  | { type: 'loading'; path: string | null }
  /** A write completed: adopt the stored document, but never overwrite newer typing. */
  | { type: 'saved'; document: DiagramDocument; expectedSource: string }

export function createDocumentSessionState(): DocumentSessionState {
  return {
    document: null,
    source: '',
    saving: false,
    error: null,
    externalChange: false,
    deletedDraftPath: null,
    loadingPath: null,
  }
}

export function documentSessionReducer(state: DocumentSessionState, action: DocumentSessionAction): DocumentSessionState {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        document: action.document,
        source: action.document.source,
        externalChange: false,
        deletedDraftPath: null,
        loadingPath: null,
      }
    case 'close':
      return { ...state, document: null, source: '', externalChange: false, deletedDraftPath: null }
    case 'draft':
      return { ...state, source: action.source }
    case 'saving':
      return { ...state, saving: action.saving }
    case 'error':
      return { ...state, error: action.message }
    case 'synced':
      // A successful sync means the file is back on disk, so the deleted-draft
      // marker must go with the conflict flag.
      return {
        ...state,
        document: action.document,
        source: action.document.source,
        externalChange: false,
        deletedDraftPath: null,
      }
    case 'external-change':
      return { ...state, externalChange: action.value }
    case 'deleted-draft':
      return { ...state, deletedDraftPath: action.path, externalChange: action.path ? false : state.externalChange }
    case 'loading':
      return { ...state, loadingPath: action.path }
    case 'saved':
      return {
        ...state,
        document: action.document,
        source: state.source === action.expectedSource ? action.document.source : state.source,
        externalChange: false,
        deletedDraftPath: null,
      }
    default:
      return state
  }
}

/** The file on disk is gone, but the draft in the panel still holds edits. */
export function isExternalDeleted(state: DocumentSessionState): boolean {
  return Boolean(state.document && state.document.path === state.deletedDraftPath)
}

export function isDirty(state: DocumentSessionState): boolean {
  if (!state.document) return false
  return state.source !== state.document.source || isExternalDeleted(state)
}
