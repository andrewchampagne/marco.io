/** Shapes returned by the Terrachrome API (backend/app/serialize.py and routes/). */

export type Confidence = 'h' | 'm' | 'l'
export type Method = 'quantile' | 'equal' | 'log'

/** [iso3, value, confidence, note, binIndex]; value and bin are null for countries without data.
 *  binIndex is -2 (ZERO_BIN) for an exact zero when binning.zero_class is on. */
export type MapRow = [string, number | null, Confidence | null, string | null, number | null]

export interface MapMeta {
  status: 'ok' | 'unmappable'
  reason: string
  title: string
  metric_label: string
  unit: string
  time_scope: string
  value_type: 'count' | 'rate' | 'percent' | 'index' | 'currency' | 'categorical'
  higher_is: 'worse' | 'better' | 'neutral'
  allows_negative: boolean
  suggested_scale: 'linear' | 'log' | 'quantile'
  suggested_palette: string
  recency_sensitive: boolean
  caveats: string[]
  suggestions: string[]
}

export interface Binning {
  method: Method
  requested_method: Method
  classes: number
  requested_classes: number
  edges: number[]
  fallback_reason: string | null
  /** Exact zeros sit outside the edges in their own class. */
  zero_class?: boolean
}

export interface LegendEntry {
  min: number
  max: number
  count: number
}

export interface Stats {
  count: number
  na_count: number
  zero_count?: number
  total: number
  min: number | null
  max: number | null
  median: number | null
  mean: number | null
}

export interface SourceInfo {
  kind: 'llm' | 'llm+web' | 'worldbank'
  strategy: 'A' | 'B' | 'C'
  model: string | null
  mock: boolean
  info: {
    name?: string
    indicator?: string
    url?: string
    sources?: { url: string; title: string }[]
    /** The second pass that asks about each missing country by name. */
    gap_fill?: { asked: number; added: number }
  } | null
}

export interface MapResult {
  slug: string
  query: string
  status: 'ok' | 'unmappable'
  meta: MapMeta
  created_at: string
  source: SourceInfo
  generation: {
    tokens_in: number
    tokens_out: number
    cache_read: number
    cache_write: number
    web_searches: number
    cost_usd: number
    latency_ms: number
  }
  request: { cached: boolean; tokens_in: number; tokens_out: number; cost_usd: number }
  rows: MapRow[]
  stats: Stats | null
  binning: Binning | null
  legend: LegendEntry[]
  defaults: { method: Method; classes: number; palette: string; reverse: boolean } | null
}

export interface RebinResult {
  slug: string
  binning: Binning
  legend: LegendEntry[]
  bins: (number | null)[]
}

export interface AppConfig {
  version: string
  llm_mode: 'mock' | 'live'
  model: string
  max_query_chars: number
  web_search: boolean
  datasources_enabled: boolean
}

export interface Examples {
  chips: string[]
  placeholders: string[]
}

export interface HistoryItem {
  slug: string
  query: string
  title: string
  status: 'ok' | 'unmappable'
  created_at: string
}

export interface KeyCheck {
  valid: boolean
  code: string | null
  message: string
  model: string
}

/** Error body: every API error is {code, message, ...extra}. */
export interface ApiErrorBody {
  code: string
  message: string
  retry_after?: number
  retryable?: boolean
  [key: string]: unknown
}
