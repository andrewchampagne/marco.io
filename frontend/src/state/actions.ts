/** Everything the UI can do. Components call these; only these talk to the API. */
import { ApiError, NetworkError, api, streamMap } from '../api/client'
import type { MapResult, Method, RebinResult } from '../api/types'
import { PALETTE_IDS, type PaletteId } from '../lib/palettes'
import { regionOf } from '../lib/regions'
import { keyStorage, looksLikeKey } from './keyStorage'
import { applyMotionPref, savePrefs, type Prefs } from './prefs'
import { store, type SettingsTab, type Toast, type View } from './store'

const rebinCache = new Map<string, RebinResult>()
let controller: AbortController | null = null
let toastId = 0

// ---- toasts ---------------------------------------------------------------------------------------

export function toast(t: Omit<Toast, 'id'>, ms = 5200): number {
  const id = ++toastId
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
  if (!t.action) setTimeout(() => dismissToast(id), ms)
  else setTimeout(() => dismissToast(id), ms * 2)
  return id
}

export function dismissToast(id: number): void {
  store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

// ---- small helpers ----------------------------------------------------------------------------------

function activeKey(): string | null {
  const { apiKey } = store.get()
  if (!apiKey.key || apiKey.status === 'invalid') return null
  return apiKey.key
}

export async function refreshHistory(): Promise<void> {
  try {
    store.set({ history: (await api.history()).items })
  } catch {
    /* non-essential */
  }
}

/** Open the "add your OpenAI key" prompt; `pendingQuery` runs once a key is saved. */
export function openKeyPrompt(pendingQuery: string | null = null): void {
  store.set({ keyPrompt: { open: true, pendingQuery }, settings: { ...store.get().settings, open: false } })
}

export function closeKeyPrompt(): void {
  store.set({ keyPrompt: { open: false, pendingQuery: null } })
}

// ---- boot -----------------------------------------------------------------------------------------

export async function boot(): Promise<void> {
  applyMotionPref(store.get().prefs.motion)
  const [config, examples] = await Promise.allSettled([api.config(), api.examples()])
  store.set({
    config: config.status === 'fulfilled' ? config.value : null,
    examples: examples.status === 'fulfilled' ? examples.value : { chips: [], placeholders: [] },
  })
  if (config.status === 'rejected') {
    toast({ tone: 'error', title: "Can't reach the Terrachrome server", body: 'Check that the API is running, then reload.' }, 9000)
  }
  void refreshHistory()
  await routeTo(location.pathname, false)
  window.addEventListener('popstate', () => void routeTo(location.pathname, false))
  // First visit without a key: ask for one (shared maps open without asking; a question will ask later).
  if (!store.get().apiKey.key && !store.get().map && config.status === 'fulfilled') openKeyPrompt()
}

async function routeTo(path: string, push: boolean): Promise<void> {
  const match = path.match(/^\/m\/([A-Za-z0-9]{4,16})\/?$/)
  if (match) {
    await openMap(match[1], push)
  } else if (path === '/' || path === '') {
    store.set({ map: null, selected: null, error: null })
  }
}

// ---- maps -----------------------------------------------------------------------------------------

function viewFor(result: MapResult): View {
  const { prefs } = store.get()
  const suggested = result.defaults?.palette as PaletteId | undefined
  const palette: PaletteId = prefs.palette !== 'auto' ? prefs.palette : suggested && PALETTE_IDS.includes(suggested) ? suggested : 'verdant'
  return {
    palette,
    reverse: result.defaults?.reverse ?? false,
    classes: prefs.classes,
    method: prefs.method !== 'auto' ? prefs.method : (result.defaults?.method ?? 'quantile'),
  }
}

function showMap(result: MapResult, push: boolean): void {
  const view = viewFor(result)
  store.set((s) => ({ map: result, mapNonce: s.mapNonce + 1, view, selected: null, error: null, legendHover: null, draft: result.query }))
  // A map made for a region brings its region with it (shared links, history), and the camera follows.
  const region = regionOf(result.region).id
  if (region !== store.get().focus.region) setFocus(region)
  if (push && location.pathname !== `/m/${result.slug}`) history.pushState(null, '', `/m/${result.slug}`)
  document.title = result.status === 'ok' ? `${result.meta.title} · Terrachrome` : 'Terrachrome'
  const binning = result.binning
  if (binning && (binning.requested_method !== view.method || binning.requested_classes !== view.classes)) {
    void changeBins(view.method, view.classes)
  }
}

export async function openMap(slug: string, push = true): Promise<void> {
  if (store.get().map?.slug === slug) return
  try {
    const result = await api.getMap(slug)
    if (result.status === 'unmappable') {
      store.set({ map: null, error: { kind: 'unmappable', query: result.query, reason: result.meta.reason, suggestions: result.meta.suggestions } })
      return
    }
    showMap(result, push)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      toast({ tone: 'warn', title: 'Map not found', body: 'The link may be wrong, or the map was deleted.' })
      history.replaceState(null, '', '/')
    } else {
      toast({ tone: 'error', title: "Couldn't load that map", body: (err as Error).message })
    }
  }
}

export function goHome(): void {
  history.pushState(null, '', '/')
  store.set({ map: null, selected: null, error: null })
  document.title = 'Terrachrome'
}

export function cancelQuery(): void {
  controller?.abort()
  controller = null
  store.set({ loading: null })
}

export async function runQuery(raw: string): Promise<void> {
  const query = raw.replace(/\s+/g, ' ').trim()
  if (!query || store.get().loading) return
  const max = store.get().config?.max_query_chars ?? 200
  if (query.length > max) {
    toast({ tone: 'warn', title: `Questions are limited to ${max} characters` })
    return
  }
  controller = new AbortController()
  const startedAt = Date.now()
  store.set({ loading: { query, stage: 'interpreting', message: 'Interpreting your question', countries: 0, startedAt }, error: null, draft: query })
  const key = activeKey()
  try {
    const result = await streamMap(query, {
      apiKey: key,
      region: store.get().focus.region,
      signal: controller.signal,
      onStatus: (stage, message) => store.set((s) => (s.loading ? { loading: { ...s.loading, stage, message } } : {})),
      onProgress: (countries) => store.set((s) => (s.loading ? { loading: { ...s.loading, countries } } : {})),
    })
    store.set({ loading: null })
    if (key) store.set((s) => ({ apiKey: { ...s.apiKey, status: 'connected', message: undefined } }))
    void refreshHistory()
    if (result.status === 'unmappable') {
      store.set({ error: { kind: 'unmappable', query, reason: result.meta.reason, suggestions: result.meta.suggestions } })
      return
    }
    showMap(result, true)
  } catch (err) {
    store.set({ loading: null })
    handleError(err, query)
  } finally {
    controller = null
  }
}

function handleError(err: unknown, query: string): void {
  if ((err as Error)?.name === 'AbortError') return
  if (err instanceof ApiError) {
    const body = err.body
    switch (err.code) {
      case 'key_required':
        openKeyPrompt(query)
        return
      case 'rate_limited':
        toast({ tone: 'warn', title: 'Slow down a little', body: `Try again in ${body.retry_after ?? 30}s.` })
        return
      case 'in_flight':
        toast({ tone: 'info', title: 'Already working on a map', body: 'Wait for it to finish, then ask again.' })
        return
      case 'invalid_key':
        store.set((s) => ({ apiKey: { ...s.apiKey, status: 'invalid', message: err.message } }))
        toast({ tone: 'error', title: 'Your OpenAI API key was rejected', body: 'Add a working key to keep making maps.' })
        openKeyPrompt(query)
        return
      case 'no_credit':
        toast({ tone: 'error', title: 'Your OpenAI account has no credit', body: 'Add credit in your OpenAI billing settings, or use another key.', action: { label: 'Change key', run: () => openSettings('key') } })
        return
      case 'empty_query':
      case 'query_too_long':
        toast({ tone: 'warn', title: err.message })
        return
      default:
        store.set({ error: { kind: 'server', query, message: err.message, code: err.code, retryable: body.retryable !== false } })
        return
    }
  }
  if (err instanceof NetworkError) {
    store.set({ error: { kind: 'network', query, message: err.message } })
    return
  }
  store.set({ error: { kind: 'server', query, message: 'Something went wrong. Please try again.', code: 'unknown', retryable: true } })
}

export function dismissError(): void {
  store.set({ error: null })
}

// ---- view: palette / reverse / bins ------------------------------------------------------------------

export function setPalette(palette: PaletteId): void {
  store.set((s) => ({ view: { ...s.view, palette } }))
}

export function toggleReverse(): void {
  store.set((s) => ({ view: { ...s.view, reverse: !s.view.reverse } }))
}

export async function changeBins(method: Method, classes: number): Promise<void> {
  const map = store.get().map
  if (!map || map.status !== 'ok') return
  store.set((s) => ({ view: { ...s.view, method, classes } }))
  const cacheKey = `${map.slug}:${method}:${classes}`
  let result = rebinCache.get(cacheKey)
  if (!result) {
    store.set({ rebinning: true })
    try {
      result = await api.rebin(map.slug, method, classes)
      rebinCache.set(cacheKey, result)
    } catch (err) {
      store.set({ rebinning: false })
      toast({ tone: 'error', title: "Couldn't re-bin the map", body: (err as Error).message })
      return
    }
  }
  const current = store.get().map
  if (!current || current.slug !== map.slug) return
  const rows = current.rows.map((r, i) => [r[0], r[1], r[2], r[3], result!.bins[i] ?? null] as typeof r)
  store.set({ map: { ...current, rows, binning: result.binning, legend: result.legend }, rebinning: false, legendHover: null })
}

// ---- map interaction ---------------------------------------------------------------------------------

export function selectCountry(iso3: string | null): void {
  store.set({ selected: iso3 })
}

export function flyToCountry(iso3: string, select = true): void {
  store.set((s) => ({ flyTo: { iso3, nonce: (s.flyTo?.nonce ?? 0) + 1 }, selected: select ? iso3 : s.selected }))
}

// ---- focus region ------------------------------------------------------------------------------------

/** Focus the map on a region: the camera flies there, other countries dim, and the next question covers
 *  only that region. The map on screen (if any) stays as it is. */
export function setFocus(region: string): void {
  const id = regionOf(region).id
  store.set((s) => ({ focus: { region: id, nonce: s.focus.nonce + 1 }, regionPickerOpen: false }))
}

export function openRegionPicker(): void {
  store.set({ regionPickerOpen: true, historyOpen: false })
}

export function closeRegionPicker(): void {
  store.set({ regionPickerOpen: false })
}

// ---- panels and modals --------------------------------------------------------------------------------

export function openSettings(tab: SettingsTab = 'key'): void {
  store.set({ settings: { open: true, tab }, historyOpen: false })
}

export function closeSettings(): void {
  store.set((s) => ({ settings: { ...s.settings, open: false } }))
}

export function setSettingsTab(tab: SettingsTab): void {
  store.set({ settings: { open: true, tab } })
}

export async function clearHistory(): Promise<void> {
  try {
    const { deleted } = await api.clearHistory()
    store.set({ history: [] })
    toast({ tone: 'success', title: deleted ? `Cleared ${deleted} item${deleted === 1 ? '' : 's'} from history` : 'History is already empty' })
  } catch (err) {
    toast({ tone: 'error', title: "Couldn't clear history", body: (err as Error).message })
  }
}

// ---- BYOK -----------------------------------------------------------------------------------------------

export async function saveApiKey(raw: string, remember: boolean): Promise<boolean> {
  const key = raw.trim()
  if (!looksLikeKey(key)) {
    store.set((s) => ({ apiKey: { ...s.apiKey, status: 'invalid', message: "That doesn't look like an OpenAI API key (it starts with sk-)." } }))
    return false
  }
  store.set((s) => ({ apiKey: { ...s.apiKey, status: 'checking', message: undefined } }))
  try {
    const check = await api.validateKey(key)
    if (!check.valid) {
      store.set((s) => ({ apiKey: { ...s.apiKey, status: 'invalid', message: check.message || 'OpenAI rejected this key.' } }))
      return false
    }
    keyStorage.save(key, remember)
    store.set({ apiKey: { key, remember, status: 'connected', message: check.message || undefined } })
    const { keyPrompt } = store.get()
    if (keyPrompt.open) {
      const pending = keyPrompt.pendingQuery
      closeKeyPrompt()
      toast({ tone: 'success', title: 'Key saved: you can make maps now' })
      if (pending) void runQuery(pending)
    } else {
      toast({ tone: 'success', title: 'API key saved', body: remember ? 'Remembered on this device.' : 'Kept for this browser tab only.' })
    }
    return true
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Couldn't check the key. Try again."
    store.set((s) => ({ apiKey: { ...s.apiKey, status: s.apiKey.key ? 'connected' : 'unset', message } }))
    toast({ tone: 'error', title: "Couldn't check the key", body: message })
    return false
  }
}

export function removeApiKey(): void {
  keyStorage.clear()
  store.set({ apiKey: { key: null, remember: true, status: 'unset' } })
  toast({ tone: 'info', title: 'API key removed from this browser' })
}

// ---- preferences --------------------------------------------------------------------------------------

export function updatePrefs(patch: Partial<Prefs>): void {
  const prefs = { ...store.get().prefs, ...patch }
  savePrefs(prefs)
  if (patch.motion) applyMotionPref(prefs.motion)
  store.set({ prefs })
}

export function useSuggestion(query: string): void {
  store.set({ draft: query, error: null })
  void runQuery(query)
}
