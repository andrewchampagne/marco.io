import { describe, expect, it } from 'vitest'
import { looksLikeKey, makeKeyStorage, maskKey } from './keyStorage'

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const KEY = 'sk-ant-api03-' + 'a'.repeat(40)

describe('BYOK key storage', () => {
  it('remember=true uses localStorage only', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(KEY, true)
    expect(local.data.size).toBe(1)
    expect(session.data.size).toBe(0)
    expect(store.load()).toEqual({ key: KEY, remember: true })
  })

  it('remember=false uses sessionStorage and clears any remembered copy', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(KEY, true)
    store.save(KEY, false)
    expect(local.data.size).toBe(0)
    expect(store.load()).toEqual({ key: KEY, remember: false })
  })

  it('clear removes the key everywhere', () => {
    const local = fakeStorage()
    const session = fakeStorage()
    const store = makeKeyStorage(local, session)
    store.save(KEY, true)
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
    expect(() => store.save(KEY, true)).not.toThrow()
    expect(store.load()).toBeNull()
  })

  it('masks and validates the key shape', () => {
    expect(maskKey(KEY)).toBe('sk-ant-…aaaa')
    expect(looksLikeKey(KEY)).toBe(true)
    expect(looksLikeKey('sk-proj-abc')).toBe(false)
    expect(looksLikeKey(` ${KEY} `)).toBe(true)
  })
})
