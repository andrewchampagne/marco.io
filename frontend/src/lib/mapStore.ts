/**
 * Where saved maps ("My maps") live. The app talks only to the MapStore interface, so a CloudMapStore can
 * be added once accounts exist (docs/DECISIONS.md D-42); today there is only LocalMapStore, which keeps
 * maps in this browser's localStorage.
 */
import { type MapFile, MapFileError, parseMapFile, serializeMapFile } from './mapFile'

export interface SavedMapSummary {
  id: string
  title: string
  query: string
  region: string
  savedAt: string
  bytes: number
}

export interface MapStore {
  readonly kind: 'local' | 'cloud'
  /** Newest first. */
  list(): Promise<SavedMapSummary[]>
  /** Saves a new map, or replaces the one with `id`. */
  save(file: MapFile, id?: string | null): Promise<SavedMapSummary>
  /** The map, validated like any uploaded file; null when it's gone or unreadable. */
  load(id: string): Promise<MapFile | null>
  delete(id: string): Promise<void>
}

export class MapStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapStoreError'
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const INDEX_KEY = 'marco.maps.index'
const ITEM_PREFIX = 'marco.maps.item.'
const ID_RE = /^[A-Za-z0-9-]{8,64}$/
export const LOCAL_MAP_LIMIT = 200

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

function isSummary(x: unknown): x is SavedMapSummary {
  if (!x || typeof x !== 'object') return false
  const s = x as Record<string, unknown>
  return typeof s.id === 'string' && ID_RE.test(s.id) && typeof s.title === 'string' && typeof s.query === 'string' &&
    typeof s.region === 'string' && typeof s.savedAt === 'string' && typeof s.bytes === 'number'
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number }
  return e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22
}

/** Saved maps in localStorage: an index of summaries plus one entry per map holding the file's text. */
export class LocalMapStore implements MapStore {
  readonly kind = 'local' as const
  private readonly storage: StorageLike | null

  constructor(storage: StorageLike | null) {
    this.storage = storage
  }

  private need(): StorageLike {
    if (!this.storage) throw new MapStoreError('This browser is blocking site storage, so maps can’t be saved here. Download the map file instead.')
    return this.storage
  }

  private readIndex(): SavedMapSummary[] {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(INDEX_KEY) ?? null
    } catch {
      return []
    }
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isSummary) : []
    } catch {
      return []
    }
  }

  private write(key: string, value: string): void {
    try {
      this.need().setItem(key, value)
    } catch (err) {
      if (err instanceof MapStoreError) throw err
      if (isQuotaError(err)) throw new MapStoreError('Browser storage is full. Delete some saved maps, or download this one as a file.')
      throw new MapStoreError('Couldn’t save to this browser’s storage. Download the map file instead.')
    }
  }

  async list(): Promise<SavedMapSummary[]> {
    return this.readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async save(file: MapFile, id?: string | null): Promise<SavedMapSummary> {
    const index = this.readIndex()
    const existing = id && ID_RE.test(id) ? index.find((s) => s.id === id) : undefined
    if (!existing && index.length >= LOCAL_MAP_LIMIT) throw new MapStoreError(`You can keep up to ${LOCAL_MAP_LIMIT} maps here. Delete some to save more.`)
    const text = serializeMapFile(file)
    const summary: SavedMapSummary = {
      id: existing?.id ?? newId(),
      title: file.map.meta.title,
      query: file.map.query,
      region: file.map.region,
      savedAt: file.saved_at,
      bytes: text.length,
    }
    this.write(ITEM_PREFIX + summary.id, text)
    const next = [summary, ...index.filter((s) => s.id !== summary.id)]
    try {
      this.write(INDEX_KEY, JSON.stringify(next))
    } catch (err) {
      if (!existing) this.removeQuietly(ITEM_PREFIX + summary.id)
      throw err
    }
    return summary
  }

  async load(id: string): Promise<MapFile | null> {
    if (!ID_RE.test(id)) return null
    let text: string | null = null
    try {
      text = this.storage?.getItem(ITEM_PREFIX + id) ?? null
    } catch {
      return null
    }
    if (!text) return null
    try {
      return parseMapFile(text) // storage is untrusted too: same checks as an uploaded file
    } catch (err) {
      if (err instanceof MapFileError) return null
      throw err
    }
  }

  async delete(id: string): Promise<void> {
    if (!ID_RE.test(id)) return
    const next = this.readIndex().filter((s) => s.id !== id)
    this.write(INDEX_KEY, JSON.stringify(next))
    this.removeQuietly(ITEM_PREFIX + id)
  }

  private removeQuietly(key: string): void {
    try {
      this.storage?.removeItem(key)
    } catch {
      /* best effort */
    }
  }
}

function browserLocalStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null // storage access throws with site data blocked
  }
}

/** The store the app uses. Swap in a CloudMapStore here (or per signed-in visitor) once auth exists. */
export const mapStore: MapStore = new LocalMapStore(browserLocalStorage())
