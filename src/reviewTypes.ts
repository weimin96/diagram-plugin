import type { DiagramDocument, DiagramSummary } from './types.js'

export interface DiagramProposalSummary {
  revision: string
  path: string
  reason?: string
  baseModifiedAt: string
  updatedAt: string
  scopeElementIds?: string[]
  newElementIds?: string[]
  impactElementIds?: string[]
  automaticElementIds?: string[]
  branchId?: string
  branchLabel?: string
  branchGroupId?: string
  rebaseable?: boolean
  patchSummary?: {
    updated: number
    added: number
    removed: number
    layout: 'preserve' | 'local'
  }
}

export interface DiagramPatchHistoryChange {
  id: string
  kind: 'add' | 'remove' | 'update'
  automatic: boolean
  declared: boolean
  label: string
  fields: string[]
}

export interface DiagramPatchHistoryEntry {
  id: string
  path: string
  appliedAt: string
  reason?: string
  layout: 'preserve' | 'local'
  rebased: boolean
  partial: boolean
  acceptedElementIds?: string[]
  scopeElementIds: string[]
  automaticElementIds: string[]
  proposalBranchId?: string
  proposalBranchLabel?: string
  proposalBranchGroupId?: string
  dependsOnIds: string[]
  dependentIds: string[]
  dependencyDepth: number
  undoneAt?: string
  undoEventId?: string
  undoBatchId?: string
  redoneAt?: string
  redoEventId?: string
  redoBatchId?: string
  counts: { updated: number; added: number; removed: number; automatic: number }
  changes: DiagramPatchHistoryChange[]
}

export interface DiagramGitImpactResult {
  kind: 'diagram-git-impact'
  updatedAt: string
  workspacePath: string
  path: string
  direction: 'upstream' | 'downstream' | 'both'
  depth: number
  git: {
    repoRoot: string
    workspacePrefix: string
    baseRef?: string
    files: Array<{ path: string; kinds: string[] }>
  }
  matchedFiles: Array<{ path: string; kinds: string[]; elementIds: string[] }>
  unmatchedFiles: Array<{ path: string; kinds: string[] }>
  directElementIds: string[]
  buckets: Array<{ distance: number; elementIds: string[] }>
  trace: {
    nodeIds: string[]
    arrowIds: string[]
    distanceById: Record<string, number>
    nodes: Array<{ id: string; text: string; distance: number }>
  }
}

export interface DiagramDeletedResult {
  kind: 'diagram-deleted'
  workspacePath: string
  path: string
}

export interface DiagramProposalRefreshResult {
  kind: 'diagram-proposal-refresh'
  workspacePath: string
  proposal: DiagramProposalSummary
  before: DiagramDocument
  candidateSource: string
  reviewElementIds: string[]
}

export interface DiagramResult {
  kind: 'diagram'
  workspacePath: string
  diagram: DiagramDocument
  proposalApply?: { rebased: boolean; beforeSource?: string; historyEntryId?: string; historyRecorded?: boolean }
}

export interface DiagramThreadStateResult {
  kind: 'diagram-thread-state'
  activeDiagramPath?: string
  diagramPaths?: string[]
  focusElementIds?: string[]
  trace?: { seedElementIds: string[]; direction: 'upstream' | 'downstream' | 'both'; depth: number }
  activity?: { kind: 'create' | 'update' | 'proposal' | 'source-sync' | 'history-undo' | 'history-redo'; path: string; key: string; modifiedAt?: string }
  proposal?: DiagramProposalSummary
  gitImpact?: { path: string; updatedAt: string; fileCount: number; directCount: number; affectedCount: number; unmatchedCount: number }
  updatedAt?: string
}

export interface DiagramPatchHistoryChainUndoResult {
  kind: 'diagram-patch-history-chain-undo'
  workspacePath: string
  diagram: DiagramDocument
  rootHistoryId: string
  historyIds: string[]
  revertedElementIds: string[]
}

export interface DiagramPatchHistoryChainRedoResult {
  kind: 'diagram-patch-history-chain-redo'
  workspacePath: string
  diagram: DiagramDocument
  rootHistoryId: string
  historyIds: string[]
  reappliedElementIds: string[]
}

export interface DiagramPatchHistoryResult {
  kind: 'diagram-patch-history'
  workspacePath: string
  path?: string
  entries: DiagramPatchHistoryEntry[]
}

export interface DiagramPatchHistoryUndoResult {
  kind: 'diagram-patch-history-undo'
  workspacePath: string
  diagram: DiagramDocument
  historyId: string
  undoEventId: string
  revertedElementIds: string[]
}

export interface DiagramPatchHistoryRedoResult {
  kind: 'diagram-patch-history-redo'
  workspacePath: string
  diagram: DiagramDocument
  historyId: string
  redoEventId: string
  reappliedElementIds: string[]
}

export interface DiagramProposalBranchSet {
  groupId: string
  activeBranchId: string
  branches: DiagramProposalSummary[]
}

export interface DiagramProposalSourceResult {
  kind: 'diagram-proposal-source'
  workspacePath: string
  proposal: DiagramProposalSummary
  before: DiagramDocument
  candidateSource: string
  branchSet?: DiagramProposalBranchSet
}

export interface DiagramListResult {
  kind: 'diagram-list'
  workspacePath: string
  diagrams: DiagramSummary[]
}

export type DiagramThreadActivityKind =
  | 'create'
  | 'update'
  | 'source-sync'
  | 'proposal'
  | 'history-undo'
  | 'history-redo'

export interface DiagramRevisionResult {
  kind: 'diagram-revision'
  workspacePath: string
  revision: { path: string; modifiedAt: string }
}
