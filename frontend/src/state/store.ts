/** A tiny external store (useSyncExternalStore). Selectors must return primitives or existing references. */
import { useSyncExternalStore } from 'react'
import type { AppConfig, Examples, HistoryItem, MapResult, Me, Method, Usage } from '../api/types'
import { DEFAULT_PALETTE, type PaletteId } from '../lib/palettes'
import { DEFAULT_PROVIDER, keyStorage, type Provider } from './keyStorage'
import { loadPrefs, type Prefs } from './prefs'

export type SettingsTab = 'account' | 'key' | 'usage' | 'appearance' | 'privacy' | 'about'

export interface LoadingState {
  query: string
  stage: string
  message: string
  countries: number
  startedAt: number
}

export type UiError =
  | { kind: 'unmappable'; query: string; reason: string; suggestions: string[] }
  | { kind: 'budget'; message: string; resetAt: string | null }
  | { kind: 'network'; query: string; message: string }
  | { kind: 'server'; query: string; message: string; code: string; retryable: boolean }

export interface View {
  palette: PaletteId
  reverse: boolean
  classes: number
  method: Method
}

export interface Hover {
  iso3: string
  x: number
  y: number
}

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'warn' | 'error'
  title: string
  body?: string
  action?: { label: string; run: () => void }
}

export interface KeyState {
  key: string | null
  /** The saved key's provider (OpenAI by default when there is no key yet). */
  provider: Provider
  remember: boolean
  status: 'unset' | 'connected' | 'invalid' | 'checking'
  message?: string
}

export interface AppState {
  config: AppConfig | null
  me: Me | null
  usage: Usage | null
  examples: Examples | null
  map: MapResult | null
  mapNonce: number // bumps whenever a new map is shown, so the map animates in
  view: View
  rebinning: boolean
  loading: LoadingState | null
  error: UiError | null
  hover: Hover | null
  selected: string | null
  legendHover: number | null
  flyTo: { iso3: string; nonce: number } | null
  settings: { open: boolean; tab: SettingsTab }
  access: { open: boolean; step: 1 | 2; resetAt: string | null; pendingQuery: string | null }
  historyOpen: boolean
  tableOpen: boolean
  history: HistoryItem[] | null
  toasts: Toast[]
  apiKey: KeyState
  prefs: Prefs
  draft: string
}

const stored = keyStorage.load()

let state: AppState = {
  config: null,
  me: null,
  usage: null,
  examples: null,
  map: null,
  mapNonce: 0,
  view: { palette: DEFAULT_PALETTE, reverse: false, classes: 7, method: 'quantile' },
  rebinning: false,
  loading: null,
  error: null,
  hover: null,
  selected: null,
  legendHover: null,
  flyTo: null,
  settings: { open: false, tab: 'account' },
  access: { open: false, step: 1, resetAt: null, pendingQuery: null },
  historyOpen: false,
  tableOpen: false,
  history: null,
  toasts: [],
  apiKey: stored
    ? { key: stored.key, provider: stored.provider, remember: stored.remember, status: 'connected' }
    : { key: null, provider: DEFAULT_PROVIDER, remember: true, status: 'unset' },
  prefs: loadPrefs(),
  draft: '',
}

const listeners = new Set<() => void>()

export const store = {
  get: (): AppState => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const next = typeof patch === 'function' ? patch(state) : patch
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state))
}
