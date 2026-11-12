import { describe, expect, it } from 'vitest'
import { looksLikeKey, makeKeyStorage, maskKey, providerOfKey } from './keyStorage'

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const OPENAI = { provider: 'openai' as const, key: 'sk-proj-' + 'o'.repeat(40) }
const ANTHROPIC = { provider: 'anthropic' as const, key: 'sk-ant-api03-' + 'a'.repeat(40) }

describe('BYOK key storage', () => {
  it('remember=true uses localStorage only, and keeps the provider', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(OPENAI, true)
    expect(local.data.size).toBe(1)
    expect(session.data.size).toBe(0)
    expect(store.load()).toEqual({ ...OPENAI, remember: true })
  })

  it('remember=false uses sessionStorage and clears any remembered copy', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(ANTHROPIC, true)
    store.save(ANTHROPIC, false)
    expect(local.data.size).toBe(0)
    expect(store.load()).toEqual({ ...ANTHROPIC, remember: false })
  })

  it('reads keys saved by the previous version as Anthropic keys', () => {
    const local = fakeStorage()
    local.data.set('terrachrome.apiKey', ANTHROPIC.key)
    expect(makeKeyStorage(local, fakeStorage()).load()).toEqual({ ...ANTHROPIC, remember: true })
    local.data.set('terrachrome.apiKey', '{not json')
    expect(makeKeyStorage(local, fakeStorage()).load()).toBeNull()
  })

  it('clear removes the key everywhere', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(OPENAI, true)
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('survives storage that throws (private windows)', () => {
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    const store = makeKeyStorage(broken, broken)
    expect(() => store.save(OPENAI, true)).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('masks and validates key shapes per provider', () => {
    expect(maskKey(ANTHROPIC.key)).toBe('sk-ant-…aaaa')
    expect(maskKey(OPENAI.key)).toBe('sk-proj-…oooo')
    expect(maskKey('sk-' + 'L'.repeat(48))).toBe('sk-…LLLL')
    expect(looksLikeKey(ANTHROPIC.key, 'anthropic')).toBe(true)
    expect(looksLikeKey(` ${OPENAI.key} `, 'openai')).toBe(true)
    expect(looksLikeKey(ANTHROPIC.key, 'openai')).toBe(false)
    expect(looksLikeKey(OPENAI.key, 'anthropic')).toBe(false)
    expect(looksLikeKey('sk-proj-abc', 'openai')).toBe(false)
    expect(providerOfKey(ANTHROPIC.key)).toBe('anthropic')
    expect(providerOfKey(OPENAI.key)).toBe('openai')
    expect(providerOfKey('hello')).toBeNull()
  })
})
