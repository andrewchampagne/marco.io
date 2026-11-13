/**
 * Map files (".marco"): a saved map as versioned JSON that restores exactly, anywhere, with no API key and
 * no AI call. It holds the data rows, meta, provenance, legend settings and the camera.
 *
 * Contents are untrusted on the way in (a file from anyone, or browser storage someone else could have
 * written), so `parseMapFile` rebuilds every field from a whitelist with strict types and caps, checks ISO
 * codes against the country list and URLs against http(s), and drops anything it doesn't know. Bin indices,
 * legends and stats are never read from a file: they are recomputed from the values (lib/binning.ts).
 *
 * Never put the visitor's OpenAI key (or anything else from browser storage) in a file: `buildMapFile`
 * copies named fields from the map on screen and nothing else.
 */
import type { Confidence, MapMeta, MapResult, MapRow, Method, SourceInfo } from '../api/types'
import type { View } from '../state/store'
import { MAX_ZOOM, MIN_ZOOM } from '../map/style'
import { DEFAULT_CLASSES, METHODS, MAX_CLASSES, MIN_CLASSES, assign, computeMapBins, computeStats, legendFor, methodForScale } from './binning'
import { COUNTRIES, COUNTRY_BY_ISO3 } from './countries'
import { PALETTE_IDS, type PaletteId } from './palettes'
import { REGION_BY_ID, regionOf } from './regions'

export const MAP_FILE_FORMAT = 'marco.map'
export const MAP_FILE_VERSION = 1
export const MAP_FILE_EXTENSION = '.marco'
export const MAP_FILE_MIME = 'application/vnd.marco.map+json'
/** A full world map with long notes is well under 100 KB; anything near this cap isn't one of ours. */
export const MAP_FILE_MAX_BYTES = 1_000_000

/** One data row in a file: [iso3, value, confidence, note]. Countries without a value are left out. */
export type MapFileRow = [string, number, Confidence | null, string | null]

export interface MapCamera {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

export interface MapFile {
  format: typeof MAP_FILE_FORMAT
  version: typeof MAP_FILE_VERSION
  saved_at: string
  map: {
    query: string
    /** The region the map was made for (regions.json id). */
    region: string
    created_at: string | null
    /** The /m/<slug> it came from on the server that made it (informational: may not exist elsewhere). */
    source_slug: string | null
    meta: MapMeta
    source: SourceInfo
    generation: MapResult['generation'] | null
    rows: MapFileRow[]
  }
  legend: { palette: PaletteId; reverse: boolean; classes: number; method: Method }
  view: { camera: MapCamera; focus: string }
}

export class MapFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapFileError'
  }
}

// ---- building ---------------------------------------------------------------------------------------

const VALUE_TYPES = ['count', 'rate', 'percent', 'index', 'currency', 'categorical'] as const
const HIGHER_IS = ['worse', 'better', 'neutral'] as const
const SCALES = ['linear', 'log', 'quantile'] as const
const SOURCE_KINDS = ['llm', 'llm+web', 'worldbank'] as const
const STRATEGIES = ['A', 'B', 'C'] as const
const CONFIDENCES = ['h', 'm', 'l'] as const

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function wrapLng(lng: number): number {
  const w = ((((lng + 180) % 360) + 360) % 360) - 180
  return w === -180 && lng > 0 ? 180 : w
}

function normalizeBearing(b: number): number {
  const w = ((((b + 180) % 360) + 360) % 360) - 180
  return Object.is(w, -0) ? 0 : w
}

/** A file for the map on screen. Only named fields are copied; missing meta fields get neutral defaults. */
export function buildMapFile(result: MapResult, view: View, camera: MapCamera, focus: string, now = new Date()): MapFile {
  if (result.status !== 'ok') throw new MapFileError('Only maps with data can be saved.')
  const m = result.meta
  const info = result.source.info
  const strings = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string') : [])
  const rows: MapFileRow[] = []
  for (const r of result.rows) {
    if (typeof r[1] === 'number' && Number.isFinite(r[1])) rows.push([r[0], r[1], r[2] ?? null, r[3] ?? null])
  }
  const g = result.generation
  return {
    format: MAP_FILE_FORMAT,
    version: MAP_FILE_VERSION,
    saved_at: now.toISOString(),
    map: {
      query: result.query,
      region: regionOf(result.region).id,
      created_at: result.created_at ?? null,
      source_slug: result.local ? result.local.sourceSlug : result.slug,
      meta: {
        status: 'ok',
        reason: m.reason ?? '',
        title: m.title || result.query,
        metric_label: m.metric_label ?? '',
        unit: m.unit ?? '',
        time_scope: m.time_scope ?? '',
        value_type: pick(m.value_type, VALUE_TYPES, 'count'),
        higher_is: pick(m.higher_is, HIGHER_IS, 'neutral'),
        allows_negative: !!m.allows_negative,
        suggested_scale: pick(m.suggested_scale, SCALES, 'quantile'),
        suggested_palette: m.suggested_palette ?? '',
        recency_sensitive: !!m.recency_sensitive,
        caveats: strings(m.caveats),
        suggestions: strings(m.suggestions),
      },
      source: {
        kind: result.source.kind,
        strategy: result.source.strategy,
        model: result.source.model,
        mock: !!result.source.mock,
        info: info
          ? {
              ...(info.name !== undefined && { name: info.name }),
              ...(info.indicator !== undefined && { indicator: info.indicator }),
              ...(info.url !== undefined && { url: info.url }),
              ...(info.sources !== undefined && { sources: info.sources.map((s) => ({ url: s.url, title: s.title })) }),
              ...(info.gap_fill !== undefined && { gap_fill: { asked: info.gap_fill.asked, added: info.gap_fill.added } }),
            }
          : null,
      },
      generation: g
        ? {
            tokens_in: g.tokens_in, tokens_out: g.tokens_out, cache_read: g.cache_read, cache_write: g.cache_write,
            web_searches: g.web_searches, cost_usd: g.cost_usd, latency_ms: g.latency_ms,
          }
        : null,
      rows,
    },
    legend: { palette: view.palette, reverse: view.reverse, classes: view.classes, method: view.method },
    view: {
      camera: {
        center: [wrapLng(camera.center[0]), camera.center[1]],
        zoom: camera.zoom,
        bearing: normalizeBearing(camera.bearing),
        pitch: camera.pitch,
      },
      focus: regionOf(focus).id,
    },
  }
}

export function serializeMapFile(file: MapFile): string {
  return JSON.stringify(file, null, 1) + '\n'
}

// ---- parsing (untrusted input) ------------------------------------------------------------------------

type Obj = Record<string, unknown>

function fail(path: string, problem: string): never {
  throw new MapFileError(`This isn't a valid marco.io map file (${path}: ${problem}).`)
}

function obj(value: unknown, path: string): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object')
  return value as Obj
}

function field(o: Obj, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined
}

// Control characters other than tab and newline, line separators and bidi overrides (which can make text
// read differently from what it is) are removed from every string.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]', 'g')

function str(value: unknown, path: string, max: number, { min = 0 } = {}): string {
  if (typeof value !== 'string') fail(path, 'expected text')
  const clean = value.replace(CONTROL, '')
  if (clean.length > max) fail(path, `longer than ${max} characters`)
  if (clean.trim().length < min) fail(path, 'empty')
  return clean
}

function optStr(value: unknown, path: string, max: number): string | null {
  return value === null || value === undefined ? null : str(value, path, max)
}

function num(value: unknown, path: string): number {
  // Numbers only: "12", true, null or NaN-ish values are rejected, never coerced.
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a number')
  return value
}

function nonNegInt(value: unknown, path: string): number {
  const n = num(value, path)
  if (!Number.isInteger(n) || n < 0) fail(path, 'expected a whole number')
  return n
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected true or false')
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(value as T)) fail(path, `expected one of ${allowed.join(', ')}`)
  return value as T
}

function arr(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected a list')
  if (value.length > max) fail(path, `more than ${max} items`)
  return value
}

function date(value: unknown, path: string): string {
  const s = str(value, path, 40)
  if (Number.isNaN(Date.parse(s))) fail(path, 'expected a date')
  return s
}

/** Links from a file end up in href attributes, so only plain http(s) URLs survive. */
function url(value: unknown, path: string): string {
  const s = str(value, path, 2000)
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    fail(path, 'expected a web address')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') fail(path, 'only http and https links are allowed')
  return parsed.href
}

function region(value: unknown, path: string): string {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(REGION_BY_ID, value)) fail(path, 'unknown region')
  return value
}

function parseMeta(raw: unknown): MapMeta {
  const o = obj(raw, 'map.meta')
  const p = (k: string) => `map.meta.${k}`
  if (field(o, 'status') !== 'ok') fail(p('status'), 'only maps with data can be opened')
  return {
    status: 'ok',
    reason: str(field(o, 'reason') ?? '', p('reason'), 1000),
    title: str(field(o, 'title'), p('title'), 300, { min: 1 }),
    metric_label: str(field(o, 'metric_label'), p('metric_label'), 300),
    unit: str(field(o, 'unit'), p('unit'), 120),
    time_scope: str(field(o, 'time_scope'), p('time_scope'), 200),
    value_type: oneOf(field(o, 'value_type'), VALUE_TYPES, p('value_type')),
    higher_is: oneOf(field(o, 'higher_is'), HIGHER_IS, p('higher_is')),
    allows_negative: bool(field(o, 'allows_negative'), p('allows_negative')),
    suggested_scale: oneOf(field(o, 'suggested_scale'), SCALES, p('suggested_scale')),
    suggested_palette: str(field(o, 'suggested_palette'), p('suggested_palette'), 40),
    recency_sensitive: bool(field(o, 'recency_sensitive'), p('recency_sensitive')),
    caveats: arr(field(o, 'caveats'), p('caveats'), 30).map((c, i) => str(c, `${p('caveats')}[${i}]`, 1000)),
    suggestions: arr(field(o, 'suggestions'), p('suggestions'), 30).map((c, i) => str(c, `${p('suggestions')}[${i}]`, 300)),
  }
}

function parseSource(raw: unknown): SourceInfo {
  const o = obj(raw, 'map.source')
  const infoRaw = field(o, 'info')
  let info: SourceInfo['info'] = null
  if (infoRaw !== null && infoRaw !== undefined) {
    const i = obj(infoRaw, 'map.source.info')
    info = {}
    const name = field(i, 'name')
    const indicator = field(i, 'indicator')
    const link = field(i, 'url')
    const sources = field(i, 'sources')
    const gap = field(i, 'gap_fill')
    if (name !== undefined) info.name = str(name, 'map.source.info.name', 300)
    if (indicator !== undefined) info.indicator = str(indicator, 'map.source.info.indicator', 200)
    if (link !== undefined) info.url = url(link, 'map.source.info.url')
    if (sources !== undefined) {
      info.sources = arr(sources, 'map.source.info.sources', 50).map((s, n) => {
        const so = obj(s, `map.source.info.sources[${n}]`)
        return { url: url(field(so, 'url'), `map.source.info.sources[${n}].url`), title: str(field(so, 'title'), `map.source.info.sources[${n}].title`, 300) }
      })
    }
    if (gap !== undefined) {
      const go = obj(gap, 'map.source.info.gap_fill')
      info.gap_fill = { asked: nonNegInt(field(go, 'asked'), 'map.source.info.gap_fill.asked'), added: nonNegInt(field(go, 'added'), 'map.source.info.gap_fill.added') }
    }
  }
  return {
    kind: oneOf(field(o, 'kind'), SOURCE_KINDS, 'map.source.kind'),
    strategy: oneOf(field(o, 'strategy'), STRATEGIES, 'map.source.strategy'),
    model: optStr(field(o, 'model'), 'map.source.model', 120),
    mock: bool(field(o, 'mock'), 'map.source.mock'),
    info,
  }
}

function parseGeneration(raw: unknown): MapResult['generation'] | null {
  if (raw === null || raw === undefined) return null
  const o = obj(raw, 'map.generation')
  const n = (k: string) => {
    const v = num(field(o, k), `map.generation.${k}`)
    if (v < 0) fail(`map.generation.${k}`, 'expected zero or more')
    return v
  }
  return {
    tokens_in: n('tokens_in'), tokens_out: n('tokens_out'), cache_read: n('cache_read'), cache_write: n('cache_write'),
    web_searches: n('web_searches'), cost_usd: n('cost_usd'), latency_ms: n('latency_ms'),
  }
}

function parseRows(raw: unknown): MapFileRow[] {
  const list = arr(raw, 'map.rows', COUNTRIES.length)
  if (!list.length) fail('map.rows', 'no data')
  const seen = new Set<string>()
  return list.map((r, i) => {
    const path = `map.rows[${i}]`
    const row = arr(r, path, 4)
    if (row.length !== 4) fail(path, 'expected [iso3, value, confidence, note]')
    const iso3 = row[0]
    if (typeof iso3 !== 'string' || !Object.prototype.hasOwnProperty.call(COUNTRY_BY_ISO3, iso3)) fail(`${path}[0]`, 'unknown country code')
    if (seen.has(iso3)) fail(`${path}[0]`, `${iso3} appears twice`)
    seen.add(iso3)
    const conf = row[2] === null ? null : oneOf(row[2], CONFIDENCES, `${path}[2]`)
    return [iso3, num(row[1], `${path}[1]`), conf, optStr(row[3], `${path}[3]`, 1000)]
  })
}

function parseCamera(raw: unknown): MapCamera {
  const o = obj(raw, 'view.camera')
  const center = arr(field(o, 'center'), 'view.camera.center', 2)
  if (center.length !== 2) fail('view.camera.center', 'expected [longitude, latitude]')
  const lng = num(center[0], 'view.camera.center[0]')
  const lat = num(center[1], 'view.camera.center[1]')
  if (Math.abs(lat) > 90) fail('view.camera.center[1]', 'latitude out of range')
  const zoom = num(field(o, 'zoom'), 'view.camera.zoom')
  return {
    center: [wrapLng(lng), lat],
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
    bearing: normalizeBearing(num(field(o, 'bearing') ?? 0, 'view.camera.bearing')),
    pitch: Math.min(60, Math.max(0, num(field(o, 'pitch') ?? 0, 'view.camera.pitch'))),
  }
}

/** Parse and validate a map file's text. Throws MapFileError with a message fit to show the visitor. */
export function parseMapFile(text: string): MapFile {
  if (typeof text !== 'string') throw new MapFileError("This isn't a marco.io map file.")
  if (text.length > MAP_FILE_MAX_BYTES) throw new MapFileError('This file is too large to be a marco.io map.')
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new MapFileError("This isn't a marco.io map file (it isn't valid JSON).")
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || field(raw as Obj, 'format') !== MAP_FILE_FORMAT) {
    throw new MapFileError("This isn't a marco.io map file.")
  }
  const top = raw as Obj
  const version = field(top, 'version')
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) fail('version', 'expected a whole number')
  if (version > MAP_FILE_VERSION) {
    throw new MapFileError('This map was saved by a newer version of marco.io. Update the app to open it.')
  }
  // Older versions would be migrated here, one step at a time, before the checks below.

  const map = obj(field(top, 'map'), 'map')
  const legend = obj(field(top, 'legend'), 'legend')
  const view = obj(field(top, 'view'), 'view')
  const classes = num(field(legend, 'classes'), 'legend.classes')
  if (!Number.isInteger(classes) || classes < MIN_CLASSES || classes > MAX_CLASSES) fail('legend.classes', `expected ${MIN_CLASSES} to ${MAX_CLASSES}`)
  const slug = field(map, 'source_slug')
  if (slug !== null && slug !== undefined && (typeof slug !== 'string' || !/^[A-Za-z0-9]{4,16}$/.test(slug))) fail('map.source_slug', 'unexpected format')
  const created = field(map, 'created_at')

  return {
    format: MAP_FILE_FORMAT,
    version: MAP_FILE_VERSION,
    saved_at: date(field(top, 'saved_at'), 'saved_at'),
    map: {
      query: str(field(map, 'query'), 'map.query', 2000, { min: 1 }),
      region: region(field(map, 'region'), 'map.region'),
      created_at: created === null || created === undefined ? null : date(created, 'map.created_at'),
      source_slug: (slug as string | null | undefined) ?? null,
      meta: parseMeta(field(map, 'meta')),
      source: parseSource(field(map, 'source')),
      generation: parseGeneration(field(map, 'generation')),
      rows: parseRows(field(map, 'rows')),
    },
    legend: {
      palette: oneOf(field(legend, 'palette'), PALETTE_IDS, 'legend.palette'),
      reverse: bool(field(legend, 'reverse'), 'legend.reverse'),
      classes,
      method: oneOf(field(legend, 'method'), METHODS, 'legend.method'),
    },
    view: { camera: parseCamera(field(view, 'camera')), focus: region(field(view, 'focus'), 'view.focus') },
  }
}

// ---- restoring -----------------------------------------------------------------------------------------

/** Bin indices, legend and stats for a local map's values, all computed here. */
export function binLocal(values: Map<string, number>, regionId: string, method: Method, classes: number) {
  const list = [...values.values()]
  const binning = computeMapBins(list, method, classes)
  return {
    binning,
    legend: legendFor(list, binning),
    stats: computeStats(list, regionOf(regionId).members.length),
    bins: COUNTRIES.map((c) => (values.has(c.iso3) ? assign(values.get(c.iso3)!, binning) : null)),
  }
}

/** The MapResult the app shows for a file. `localId` becomes its slug (it has no server slug here). */
export function mapResultFromFile(file: MapFile, localId: string): MapResult {
  const byIso = new Map(file.map.rows.map((r) => [r[0], r]))
  const values = new Map(file.map.rows.map((r) => [r[0], r[1]]))
  const { binning, legend, stats, bins } = binLocal(values, file.map.region, file.legend.method, file.legend.classes)
  const rows: MapRow[] = COUNTRIES.map((c, i) => {
    const r = byIso.get(c.iso3)
    return r ? [c.iso3, r[1], r[2], r[3], bins[i]] : [c.iso3, null, null, null, null]
  })
  const meta = file.map.meta
  return {
    slug: localId,
    query: file.map.query,
    status: 'ok',
    region: file.map.region,
    meta,
    created_at: file.map.created_at ?? file.saved_at,
    source: file.map.source,
    generation: file.map.generation ?? { tokens_in: 0, tokens_out: 0, cache_read: 0, cache_write: 0, web_searches: 0, cost_usd: 0, latency_ms: 0 },
    request: { cached: true, tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    rows,
    stats,
    binning,
    legend,
    defaults: {
      method: methodForScale(meta.suggested_scale),
      classes: DEFAULT_CLASSES,
      palette: meta.suggested_palette || 'verdant',
      reverse: false, // darker always means higher (D-45)
    },
    local: { sourceSlug: file.map.source_slug, savedAt: file.saved_at },
  }
}
