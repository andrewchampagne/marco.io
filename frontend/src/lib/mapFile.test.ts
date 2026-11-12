import { describe, expect, it } from 'vitest'
import type { MapResult, MapRow } from '../api/types'
import type { View } from '../state/store'
import { assign, computeMapBins, legendFor } from './binning'
import { COUNTRIES } from './countries'
import {
  MAP_FILE_FORMAT, MAP_FILE_MAX_BYTES, MAP_FILE_VERSION, MapFileError, buildMapFile, mapResultFromFile, parseMapFile,
  serializeMapFile,
} from './mapFile'

const VALUES: Record<string, number> = { FRA: 67.8, DEU: 83.2, BRA: 216.4, IND: 1428.6, NGA: 223.8, JPN: 124.5, CAN: 38.8, AUS: 26.4, EGY: 0 }

function serverMap(): MapResult {
  const values = Object.values(VALUES)
  const binning = computeMapBins(values, 'quantile', 5)
  const rows: MapRow[] = COUNTRIES.map((c) =>
    c.iso3 in VALUES ? [c.iso3, VALUES[c.iso3], c.iso3 === 'NGA' ? 'm' : 'h', c.iso3 === 'FRA' ? 'Includes overseas regions' : null, assign(VALUES[c.iso3], binning)] : [c.iso3, null, null, null, null],
  )
  return {
    slug: 'Ab12Cd34',
    query: 'population in millions',
    status: 'ok',
    region: 'world',
    meta: {
      status: 'ok', reason: '', title: 'Population', metric_label: 'Population', unit: 'million people', time_scope: '2024',
      value_type: 'count', higher_is: 'neutral', allows_negative: false, suggested_scale: 'quantile', suggested_palette: 'viridis',
      recency_sensitive: false, caveats: ['Estimates'], suggestions: [],
    },
    created_at: '2026-11-01T10:00:00Z',
    source: { kind: 'llm+web', strategy: 'B', model: 'gpt-test', mock: true, info: { sources: [{ url: 'https://example.org/pop', title: 'UN WPP' }], gap_fill: { asked: 3, added: 2 } } },
    generation: { tokens_in: 100, tokens_out: 900, cache_read: 0, cache_write: 0, web_searches: 1, cost_usd: 0.01, latency_ms: 4000 },
    request: { cached: false, tokens_in: 100, tokens_out: 900, cost_usd: 0.01 },
    rows,
    stats: null,
    binning,
    legend: legendFor(values, binning),
    defaults: { method: 'quantile', classes: 7, palette: 'viridis', reverse: false },
  }
}

const VIEW: View = { palette: 'inferno', reverse: true, classes: 5, method: 'quantile' }
const CAMERA = { center: [12.5, 41.9] as [number, number], zoom: 3.25, bearing: 0, pitch: 0 }

function fileText(mutate?: (f: Record<string, any>) => void): string {
  const file = JSON.parse(serializeMapFile(buildMapFile(serverMap(), VIEW, CAMERA, 'europe', new Date('2026-11-12T12:00:00Z'))))
  mutate?.(file)
  return JSON.stringify(file)
}

function rejects(text: string, pattern: RegExp) {
  expect(() => parseMapFile(text)).toThrow(MapFileError)
  expect(() => parseMapFile(text)).toThrow(pattern)
}

describe('map files', () => {
  it('round-trips a map exactly: rows, meta, legend settings, camera and focus', () => {
    const original = serverMap()
    const file = parseMapFile(fileText())
    expect(file.format).toBe(MAP_FILE_FORMAT)
    expect(file.version).toBe(MAP_FILE_VERSION)
    expect(file.map.rows).toHaveLength(Object.keys(VALUES).length) // countries without data are left out
    expect(file.legend).toEqual({ palette: 'inferno', reverse: true, classes: 5, method: 'quantile' })
    expect(file.view).toEqual({ camera: CAMERA, focus: 'europe' })
    expect(file.map.source_slug).toBe('Ab12Cd34')

    const restored = mapResultFromFile(file, 'local-test')
    expect(restored.slug).toBe('local-test')
    expect(restored.local).toEqual({ sourceSlug: 'Ab12Cd34', savedAt: '2026-11-12T12:00:00.000Z' })
    expect(restored.meta).toEqual(original.meta)
    expect(restored.source).toEqual(original.source)
    expect(restored.query).toBe(original.query)
    expect(restored.rows).toEqual(original.rows) // same values, confidence, notes and recomputed bins
    expect(restored.legend).toEqual(original.legend)
    expect(restored.stats).toMatchObject({ count: 9, zero_count: 1, total: COUNTRIES.length })
    expect(restored.request.cost_usd).toBe(0)
  })

  it('never carries anything but the named fields (no API key, whatever is attached to the map)', () => {
    const key = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const map = serverMap() as MapResult & Record<string, unknown>
    map.apiKey = key
    ;(map.meta as unknown as Record<string, unknown>).key = key
    ;(map.source.info as Record<string, unknown>).headers = { 'X-OpenAI-Key': key }
    const text = serializeMapFile(buildMapFile(map, VIEW, CAMERA, 'world'))
    expect(text).not.toContain(key)
    expect(text).not.toContain('sk-')
    expect(text).not.toMatch(/openai-key|apikey/i)
  })

  it('drops unknown fields from a file instead of passing them through', () => {
    const file = parseMapFile(fileText((f) => {
      f.extra = 'x'
      f.map.meta.evil = '<script>'
      f.map.source.info.html = '<img onerror=alert(1)>'
      f.map.__proto__ = { polluted: true }
    }))
    expect(JSON.stringify(file)).not.toMatch(/evil|onerror|polluted/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects files that are not marco maps', () => {
    rejects('not json', /valid JSON/)
    rejects('[]', /isn't a marco.io map file/)
    rejects(JSON.stringify({ format: 'something.else', version: 1 }), /isn't a marco.io map file/)
    rejects(fileText((f) => (f.version = 2)), /newer version/)
    rejects(fileText((f) => (f.version = '1')), /version/)
    rejects('x'.repeat(MAP_FILE_MAX_BYTES + 1), /too large/)
  })

  it('accepts only known ISO codes, real numbers and known confidence levels in rows', () => {
    rejects(fileText((f) => (f.map.rows[0][0] = 'XXX')), /unknown country code/)
    rejects(fileText((f) => (f.map.rows[0][0] = 'fra')), /unknown country code/)
    rejects(fileText((f) => (f.map.rows[1][0] = f.map.rows[0][0])), /appears twice/)
    rejects(fileText((f) => (f.map.rows[0][1] = '67.8')), /expected a number/)
    rejects(fileText((f) => (f.map.rows[0][1] = null)), /expected a number/)
    rejects(fileText((f) => (f.map.rows[0][2] = 'x')), /expected one of/)
    rejects(fileText((f) => f.map.rows[0].push(3)), /more than 4 items|expected \[iso3/)
    rejects(fileText((f) => (f.map.rows = [])), /no data/)
    rejects(fileText((f) => (f.map.rows = Array.from({ length: COUNTRIES.length + 1 }, () => ['FRA', 1, null, null]))), /more than/)
    // JSON can't hold NaN, but 1e999 parses to Infinity.
    rejects(fileText().replace('67.8', '1e999'), /expected a number/)
  })

  it('checks legend settings, regions, meta enums and links', () => {
    rejects(fileText((f) => (f.legend.palette = 'rainbow')), /legend.palette/)
    rejects(fileText((f) => (f.legend.classes = 12)), /legend.classes/)
    rejects(fileText((f) => (f.legend.method = 'jenks')), /legend.method/)
    rejects(fileText((f) => (f.map.region = 'atlantis')), /unknown region/)
    rejects(fileText((f) => (f.view.focus = 'constructor')), /unknown region/)
    rejects(fileText((f) => (f.map.meta.value_type = 'html')), /value_type/)
    rejects(fileText((f) => (f.map.meta.title = '')), /title/)
    rejects(fileText((f) => (f.map.meta.status = 'unmappable')), /only maps with data/)
    rejects(fileText((f) => (f.map.source.info.sources[0].url = 'javascript:alert(1)')), /only http and https/)
    rejects(fileText((f) => (f.map.source.info.url = 'data:text/html,hi')), /only http and https/)
    rejects(fileText((f) => (f.map.meta.title = 'x'.repeat(301))), /longer than/)
  })

  it('normalizes the camera and strips control characters', () => {
    const file = parseMapFile(fileText((f) => {
      f.view.camera.center = [370, 10]
      f.view.camera.zoom = 99
      f.view.camera.bearing = 450
      f.map.meta.title = 'Pop\u0000ulation\u202E'
    }))
    expect(file.view.camera.center).toEqual([10, 10])
    expect(file.view.camera.zoom).toBe(8)
    expect(file.view.camera.bearing).toBe(90)
    expect(file.map.meta.title).toBe('Population') // the NUL and the right-to-left override are gone
    rejects(fileText((f) => (f.view.camera.center = [0, 95])), /latitude/)
  })
})
