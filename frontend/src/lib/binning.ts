/**
 * Class breaks for maps opened from a file, computed in the browser so they need no server or AI call.
 * A line-for-line port of backend/app/binning.py (compute_bins, compute_map_bins, assign, legend) and
 * processing.compute_stats; keep the two in step. Server maps still re-bin through the API.
 */
import type { Binning, LegendEntry, Method, Stats } from '../api/types'

export const METHODS: Method[] = ['quantile', 'equal', 'log']
export const MIN_CLASSES = 3
export const MAX_CLASSES = 9
export const DEFAULT_CLASSES = 7
export const ZERO_BIN = -2
const SCALE_TO_METHOD: Record<string, Method> = { linear: 'equal', log: 'log', quantile: 'quantile' }

export function clampClasses(classes: number | null | undefined): number {
  if (classes == null) return DEFAULT_CLASSES
  return Math.max(MIN_CLASSES, Math.min(MAX_CLASSES, Math.trunc(classes)))
}

export function methodForScale(scale: string | null | undefined): Method {
  return SCALE_TO_METHOD[scale ?? ''] ?? 'quantile'
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = q * (sorted.length - 1)
  const lo = Math.trunc(pos)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function dedupe(edges: number[]): number[] {
  const out: number[] = []
  for (const e of edges) if (!out.length || e > out[out.length - 1]) out.push(e)
  return out
}

function make(method: Method, requested: Method, classes: number, requestedClasses: number, edges: number[], fallback: string | null): Binning {
  return { method, requested_method: requested, classes, requested_classes: requestedClasses, edges, fallback_reason: fallback, zero_class: false }
}

export function computeBins(values: number[], method: Method | null | undefined, classes: number | null | undefined): Binning {
  const known = method != null && METHODS.includes(method)
  const requested: Method = known ? method : 'quantile'
  const k = clampClasses(classes)
  if (!values.length) return make(requested, requested, 0, k, [], 'no data')
  const vals = [...values].sort((a, b) => a - b)
  const lo = vals[0]
  const hi = vals[vals.length - 1]
  if (lo === hi) return make(requested, requested, 1, k, [lo, hi], 'all values are equal')

  let fallback: string | null = known ? null : method ? 'unknown method' : null
  let chosen = requested
  if (chosen === 'log') {
    const positives = vals.filter((v) => v > 0)
    if (lo < 0) {
      chosen = 'quantile'
      fallback = 'log scale needs values of zero or more'
    } else if (new Set(positives).size < 2) {
      chosen = 'quantile'
      fallback = 'not enough distinct positive values for a log scale'
    }
  }

  let edges: number[]
  if (chosen === 'equal') {
    const step = (hi - lo) / k
    edges = [...Array.from({ length: k }, (_, i) => lo + i * step), hi]
  } else if (chosen === 'log') {
    const pLo = Math.min(...vals.filter((v) => v > 0))
    const ratio = hi / pLo
    edges = [...Array.from({ length: k }, (_, i) => pLo * ratio ** (i / k)), hi]
    if (lo === 0) edges[0] = 0
  } else {
    const kEff = Math.min(k, new Set(vals).size)
    edges = dedupe(Array.from({ length: kEff + 1 }, (_, i) => quantile(vals, i / kEff)))
    if (edges.length - 1 < k && fallback === null) fallback = 'too many tied values for that many quantile classes'
  }
  return make(chosen, requested, edges.length - 1, k, edges, fallback)
}

/** Exact zeros get their own class when every value is >= 0 and at least one is positive. */
export function computeMapBins(values: number[], method: Method | null | undefined, classes: number | null | undefined): Binning {
  const positives = values.filter((v) => v > 0)
  if (positives.length && positives.length < values.length && Math.min(...values) === 0) {
    return { ...computeBins(positives, method, classes), zero_class: true }
  }
  return computeBins(values, method, classes)
}

/** Index of the class containing `value` (the top edge belongs to the last class). */
export function assign(value: number, binning: Binning): number {
  if (binning.zero_class && value === 0) return ZERO_BIN
  if (binning.classes <= 1) return 0
  // bisect_right(edges, value) - 1
  let lo = 0
  let hi = binning.edges.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (value < binning.edges[mid]) hi = mid
    else lo = mid + 1
  }
  return Math.max(0, Math.min(binning.classes - 1, lo - 1))
}

export function legendFor(values: number[], binning: Binning): LegendEntry[] {
  const counts = new Array<number>(Math.max(binning.classes, 0)).fill(0)
  for (const v of values) {
    if (binning.zero_class && v === 0) continue
    if (counts.length) counts[assign(v, binning)] += 1
  }
  return counts.map((count, i) => ({ min: binning.edges[i], max: binning.edges[i + 1], count }))
}

export function computeStats(values: number[], total: number): Stats {
  if (!values.length) return { count: 0, na_count: total, zero_count: 0, total, min: null, max: null, median: null, mean: null }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    count: values.length,
    na_count: total - values.length,
    zero_count: values.filter((v) => v === 0).length,
    total,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  }
}
