import type { ViewMode } from './editorPolicy.js'
import type { DiagramSurface } from './types.js'

export interface ViewPreferences {
  mode: ViewMode
  /** Whether the panel follows the conversation's active diagram. */
  follow: boolean
}

/** Bump when the stored shape changes; stale keys are ignored, never migrated blindly. */
export const VIEW_PREFERENCES_KEY = 'diagram.view-preferences.v1'

/** Keeps the store bounded when a project accumulates many diagrams. */
export const VIEW_PREFERENCES_LIMIT = 64

export function viewPreferenceScope(surface: DiagramSurface, path?: string): string {
  return path ? `${surface}:${path}` : surface
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'preview' || value === 'source' || value === 'split'
}

export function viewPreferenceStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // Access itself throws in some privacy modes; preferences stay in memory.
    return undefined
  }
}

type StoredPreferences = Record<string, { mode?: unknown; follow?: unknown }>

function readStore(storage: Storage | undefined): StoredPreferences {
  if (!storage) return {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem(VIEW_PREFERENCES_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as StoredPreferences : {}
  } catch {
    return {}
  }
}

/** Returns `undefined` when nothing valid is stored, so callers fall back to policy defaults. */
export function readViewPreferences(storage: Storage | undefined, scope: string): ViewPreferences | undefined {
  const entry = readStore(storage)[scope]
  if (!entry || typeof entry !== 'object') return undefined
  const mode = isViewMode(entry.mode) ? entry.mode : undefined
  const follow = typeof entry.follow === 'boolean' ? entry.follow : undefined
  if (!mode && follow === undefined) return undefined
  return { mode: mode ?? 'split', follow: follow ?? true }
}

export function writeViewPreferences(storage: Storage | undefined, scope: string, preferences: ViewPreferences): void {
  if (!storage) return
  try {
    const store = readStore(storage)
    delete store[scope]
    const keys = Object.keys(store)
    for (const key of keys.slice(0, Math.max(0, keys.length - VIEW_PREFERENCES_LIMIT + 1))) delete store[key]
    store[scope] = { mode: preferences.mode, follow: preferences.follow }
    storage.setItem(VIEW_PREFERENCES_KEY, JSON.stringify(store))
  } catch {
    // Quota or privacy failures must not break editing.
  }
}
