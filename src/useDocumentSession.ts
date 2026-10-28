/**
 * React binding for the open-document session.
 *
 * The panel keeps one of these and hands it to the hooks that need to read or
 * write the open document. Callers get intent methods instead of raw setters,
 * so a new command cannot invent its own idea of "open", "saved" or "synced".
 */

import { useMemo, useReducer, useRef } from 'react'
import {
  createDocumentSessionState,
  documentSessionReducer,
  isDirty,
  isExternalDeleted,
  type DocumentSessionState,
} from './documentSession.js'
import type { DiagramDocument } from './types.js'

export interface DocumentSession {
  document: DiagramDocument | null
  source: string
  saving: boolean
  error: string | null
  externalChange: boolean
  deletedDraftPath: string | null
  loadingPath: string | null
  dirty: boolean
  externalDeleted: boolean
  setSelected: (value: DiagramDocument | null) => void
  setSource: (value: string | ((current: string) => string)) => void
  setSaving: (value: boolean) => void
  setError: (message: string | null) => void
  setExternalChange: (value: boolean) => void
  setDeletedDraftPath: (path: string | null) => void
  setLoadingPath: (path: string | null) => void
  /** A write landed: adopt the stored document unless the user typed since. */
  adoptSaved: (document: DiagramDocument, expectedSource: string) => void
  /** Disk won: adopt the stored document and drop the conflict flag. */
  adoptSynced: (document: DiagramDocument) => void
  snapshotState: () => DocumentSessionState
}

export function useDocumentSession(): DocumentSession {
  const [state, dispatch] = useReducer(documentSessionReducer, undefined, createDocumentSessionState)
  const sourceRef = useRef(state.source)
  sourceRef.current = state.source

  return useMemo<DocumentSession>(() => ({
    document: state.document,
    source: state.source,
    saving: state.saving,
    error: state.error,
    externalChange: state.externalChange,
    deletedDraftPath: state.deletedDraftPath,
    loadingPath: state.loadingPath,
    dirty: isDirty(state),
    externalDeleted: isExternalDeleted(state),
    setSelected: (value) => {
      if (value) dispatch({ type: 'open', document: value })
      else dispatch({ type: 'close' })
    },
    setSource: (value) => {
      const next = typeof value === 'function' ? value(sourceRef.current) : value
      dispatch({ type: 'draft', source: next })
    },
    setSaving: (value) => dispatch({ type: 'saving', saving: value }),
    setError: (message) => dispatch({ type: 'error', message }),
    setExternalChange: (value) => dispatch({ type: 'external-change', value }),
    setDeletedDraftPath: (path) => dispatch({ type: 'deleted-draft', path }),
    setLoadingPath: (path) => dispatch({ type: 'loading', path }),
    adoptSaved: (document, expectedSource) => dispatch({ type: 'saved', document, expectedSource }),
    adoptSynced: (document) => dispatch({ type: 'synced', document }),
    snapshotState: () => state,
  }), [state])
}
