/**
 * The visitor's OpenAI API key lives only in this browser.
 * "Remember on this device" -> localStorage; otherwise sessionStorage (gone when the tab closes).
 * It is sent per request in the X-OpenAI-Key header and never stored on the server.
 */

export const KEY_HEADER = 'X-OpenAI-Key'
export const KEYS_URL = 'https://platform.openai.com/api-keys'

const STORAGE_KEY = 'terrachrome.apiKey'

export interface StoredKey {
  key: string
  remember: boolean
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback // storage can throw in private windows or with site data blocked
  }
}

/** Stored values are JSON {key}. Earlier versions stored other providers' keys; those are ignored. */
function decode(raw: string | null): string | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { key?: unknown; provider?: unknown }
    if (typeof value.key === 'string' && (value.provider === undefined || value.provider === 'openai') && looksLikeKey(value.key)) {
      return value.key
    }
  } catch {
    /* a bare string from an older version, or a corrupted entry */
  }
  return null
}

export function makeKeyStorage(local: StorageLike | null, session: StorageLike | null) {
  return {
    load(): StoredKey | null {
      const persistent = decode(safe(() => local?.getItem(STORAGE_KEY) ?? null, null))
      if (persistent) return { key: persistent, remember: true }
      const temporary = decode(safe(() => session?.getItem(STORAGE_KEY) ?? null, null))
      return temporary ? { key: temporary, remember: false } : null
    },
    save(key: string, remember: boolean): void {
      const [target, other] = remember ? [local, session] : [session, local]
      safe(() => other?.removeItem(STORAGE_KEY), undefined)
      safe(() => target?.setItem(STORAGE_KEY, JSON.stringify({ key })), undefined)
    },
    clear(): void {
      safe(() => local?.removeItem(STORAGE_KEY), undefined)
      safe(() => session?.removeItem(STORAGE_KEY), undefined)
    },
  }
}

const browserStorage = (kind: 'localStorage' | 'sessionStorage'): StorageLike | null =>
  safe(() => (typeof window !== 'undefined' ? window[kind] : null), null)

export const keyStorage = makeKeyStorage(browserStorage('localStorage'), browserStorage('sessionStorage'))

/** sk-proj-…ab12, sk-svcacct-…ab12, sk-…ab12 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  const prefix = /^sk-(proj|svcacct)-/.exec(trimmed)?.[0] ?? 'sk-'
  return trimmed.length <= prefix.length + 6 ? `${prefix}…` : `${prefix}…${trimmed.slice(-4)}`
}

/** OpenAI doesn't publish a key format; observed keys are sk-proj-…, sk-svcacct-… and legacy sk-…. */
export function looksLikeKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,400}$/.test(key.trim())
}
