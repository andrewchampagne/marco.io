/**
 * The user's own API key (BYOK), for OpenAI (the default) or Anthropic, lives only in this browser.
 * "Remember on this device" -> localStorage; otherwise sessionStorage (gone when the tab closes).
 * It is sent per request in the X-OpenAI-Key or X-Anthropic-Key header and never stored on the server.
 */

export type Provider = 'openai' | 'anthropic'

export const DEFAULT_PROVIDER: Provider = 'openai'

export const PROVIDERS: Record<Provider, { label: string; header: string; placeholder: string; keysUrl: string; prefix: string }> = {
  openai: {
    label: 'OpenAI',
    header: 'X-OpenAI-Key',
    placeholder: 'sk-proj-…',
    keysUrl: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
  },
  anthropic: {
    label: 'Anthropic',
    header: 'X-Anthropic-Key',
    placeholder: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    prefix: 'sk-ant-',
  },
}

/** What requests carry: which provider, and the key itself. */
export interface Credential {
  provider: Provider
  key: string
}

const STORAGE_KEY = 'terrachrome.apiKey'

export interface StoredKey extends Credential {
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

/** Stored values are JSON {provider, key}. Older versions stored a bare Anthropic key string. */
function decode(raw: string | null): Credential | null {
  if (!raw) return null
  if (raw.startsWith('sk-')) return { provider: 'anthropic', key: raw }
  try {
    const value = JSON.parse(raw) as Partial<Credential>
    if (typeof value.key === 'string' && (value.provider === 'openai' || value.provider === 'anthropic')) {
      return { provider: value.provider, key: value.key }
    }
  } catch {
    /* corrupted entry: treat as no key */
  }
  return null
}

export function makeKeyStorage(local: StorageLike | null, session: StorageLike | null) {
  return {
    load(): StoredKey | null {
      const persistent = decode(safe(() => local?.getItem(STORAGE_KEY) ?? null, null))
      if (persistent) return { ...persistent, remember: true }
      const temporary = decode(safe(() => session?.getItem(STORAGE_KEY) ?? null, null))
      return temporary ? { ...temporary, remember: false } : null
    },
    save(credential: Credential, remember: boolean): void {
      const [target, other] = remember ? [local, session] : [session, local]
      const value = JSON.stringify({ provider: credential.provider, key: credential.key })
      safe(() => other?.removeItem(STORAGE_KEY), undefined)
      safe(() => target?.setItem(STORAGE_KEY, value), undefined)
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

/** sk-proj-…ab12, sk-ant-…ab12, sk-…ab12 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  const prefix = /^sk-(ant|proj|svcacct)-/.exec(trimmed)?.[0] ?? 'sk-'
  return trimmed.length <= prefix.length + 6 ? `${prefix}…` : `${prefix}…${trimmed.slice(-4)}`
}

/** The provider a key belongs to, judged by its prefix (used only to catch a mismatched choice). */
export function providerOfKey(key: string): Provider | null {
  const trimmed = key.trim()
  if (trimmed.startsWith('sk-ant-')) return 'anthropic'
  if (trimmed.startsWith('sk-')) return 'openai'
  return null
}

export function looksLikeKey(key: string, provider: Provider): boolean {
  const trimmed = key.trim()
  return provider === 'anthropic'
    ? /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(trimmed)
    : /^sk-(?!ant-)[A-Za-z0-9_-]{20,400}$/.test(trimmed)
}
