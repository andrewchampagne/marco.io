/**
 * The user's Anthropic API key (BYOK) lives only in this browser.
 * "Remember on this device" -> localStorage; otherwise sessionStorage (gone when the tab closes).
 * It is sent per request in the X-Anthropic-Key header and never stored on the server.
 */

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

export function makeKeyStorage(local: StorageLike | null, session: StorageLike | null) {
  return {
    load(): StoredKey | null {
      const persistent = safe(() => local?.getItem(STORAGE_KEY) ?? null, null)
      if (persistent) return { key: persistent, remember: true }
      const temporary = safe(() => session?.getItem(STORAGE_KEY) ?? null, null)
      return temporary ? { key: temporary, remember: false } : null
    },
    save(key: string, remember: boolean): void {
      const [target, other] = remember ? [local, session] : [session, local]
      safe(() => other?.removeItem(STORAGE_KEY), undefined)
      safe(() => target?.setItem(STORAGE_KEY, key), undefined)
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

/** sk-ant-…ab12 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  return trimmed.length <= 10 ? 'sk-ant-…' : `sk-ant-…${trimmed.slice(-4)}`
}

export function looksLikeKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key.trim())
}
