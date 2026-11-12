import { describe, expect, it } from 'vitest'
import type { MapFile } from './mapFile'
import { LocalMapStore, MapStoreError } from './mapStore'

function memoryStorage(opts: { quota?: number; throwOnRead?: boolean } = {}) {
  const data = new Map<string, string>()
  return {
    data,
    getItem(k: string) {
      if (opts.throwOnRead) throw new Error('SecurityError')
      return data.get(k) ?? null
    },
    setItem(k: string, v: string) {
      const used = [...data.entries()].filter(([key]) => key !== k).reduce((n, [key, val]) => n + key.length + val.length, 0)
      if (opts.quota !== undefined && used + k.length + v.length > opts.quota) {
        const err = new Error('quota') as Error & { name: string }
        err.name = 'QuotaExceededError'
        throw err
      }
      data.set(k, v)
    },
    removeItem(k: string) {
      data.delete(k)
    },
  }
}

function file(title: string, savedAt = '2026-11-12T12:00:00.000Z'): MapFile {
  return {
    format: 'marco.map',
    version: 1,
    saved_at: savedAt,
    map: {
      query: `${title} by country`,
      region: 'africa',
      created_at: null,
      source_slug: null,
      meta: {
        status: 'ok', reason: '', title, metric_label: title, unit: '%', time_scope: '2024', value_type: 'percent',
        higher_is: 'better', allows_negative: false, suggested_scale: 'linear', suggested_palette: 'verdant',
        recency_sensitive: false, caveats: [], suggestions: [],
      },
      source: { kind: 'llm', strategy: 'A', model: 'gpt-test', mock: true, info: null },
      generation: null,
      rows: [['NGA', 50, 'h', null], ['KEN', 60, null, 'note']],
    },
    legend: { palette: 'verdant', reverse: false, classes: 5, method: 'equal' },
    view: { camera: { center: [20, 0], zoom: 2, bearing: 0, pitch: 0 }, focus: 'africa' },
  }
}

describe('LocalMapStore', () => {
  it('saves, lists newest first, loads, updates in place and deletes', async () => {
    const storage = memoryStorage()
    const store = new LocalMapStore(storage)
    const a = await store.save(file('Literacy', '2026-11-10T00:00:00.000Z'))
    const b = await store.save(file('Rainfall', '2026-11-11T00:00:00.000Z'))
    expect((await store.list()).map((s) => s.title)).toEqual(['Rainfall', 'Literacy'])
    expect((await store.load(a.id))?.map.rows).toEqual(file('Literacy').map.rows)

    const updated = await store.save(file('Literacy rate', '2026-11-12T00:00:00.000Z'), a.id)
    expect(updated.id).toBe(a.id)
    expect((await store.list()).map((s) => s.title)).toEqual(['Literacy rate', 'Rainfall'])

    await store.delete(b.id)
    expect((await store.list()).map((s) => s.id)).toEqual([a.id])
    expect(await store.load(b.id)).toBeNull()
    expect([...storage.data.keys()].some((k) => k.includes(b.id))).toBe(false)
  })

  it('validates stored maps like uploaded files and ignores a corrupted index', async () => {
    const storage = memoryStorage()
    const store = new LocalMapStore(storage)
    const s = await store.save(file('Literacy'))
    storage.setItem(`marco.maps.item.${s.id}`, '{"format":"marco.map","version":1,"map":{"rows":[["XXX",1,null,null]]}}')
    expect(await store.load(s.id)).toBeNull()
    expect(await store.load('../marco.apiKey')).toBeNull()
    storage.setItem('marco.maps.index', 'not json')
    expect(await store.list()).toEqual([])
    storage.setItem('marco.maps.index', JSON.stringify([{ id: 'x' }, 42]))
    expect(await store.list()).toEqual([])
  })

  it('never touches the API key entry', async () => {
    const storage = memoryStorage()
    storage.setItem('marco.apiKey', JSON.stringify({ key: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ' }))
    const store = new LocalMapStore(storage)
    const s = await store.save(file('Literacy'))
    await store.delete(s.id)
    expect(storage.data.get('marco.apiKey')).toContain('sk-proj-')
    for (const [k, v] of storage.data) if (k !== 'marco.apiKey') expect(v).not.toContain('sk-')
  })

  it('reports full or blocked storage as a MapStoreError', async () => {
    await expect(new LocalMapStore(memoryStorage({ quota: 100 })).save(file('Literacy'))).rejects.toThrow(/storage is full/)
    await expect(new LocalMapStore(null).save(file('Literacy'))).rejects.toBeInstanceOf(MapStoreError)
    const blocked = new LocalMapStore(memoryStorage({ throwOnRead: true }))
    expect(await blocked.list()).toEqual([])
    expect(await blocked.load('abcdefgh-1234')).toBeNull()
  })
})
