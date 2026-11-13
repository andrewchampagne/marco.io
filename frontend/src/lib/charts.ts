/**
 * Data for the charts panel: the top N countries of a map plus one "Rest of <region>" entry for everyone
 * else in the map's region (D-46).
 *
 * The rest is a SUM when the values add up to a meaningful total (counts and money totals), and an AVERAGE
 * otherwise (rates, percentages, indexes, anything "per" something), since adding up life expectancies
 * means nothing. A pie needs a meaningful total, so it's only offered for summable values with no
 * negatives; the bar chart works for every map.
 */
import type { MapResult } from '../api/types'
import { countryName } from './countries'
import { WORLD, inRegion, regionOf } from './regions'

export const TOP_MIN = 3
/** Eight categorical slice colours pass the colour checks side by side; a 9th would be a made-up hue. */
export const TOP_MAX = 8
export const TOP_DEFAULT = 5

/** Pie slice colours in fixed order (the dataviz reference palette, dark steps, validated on the panel). */
export const SLICE_COLORS = ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767']
export const REST_COLOR = '#5E5E6D'
export const BAR_COLOR = '#3987E5'

export interface ChartItem {
  key: string // ISO3, or 'rest'
  label: string
  value: number
  /** Share of the region's total (summable values only). */
  share: number | null
  rest: boolean
}

export interface ChartData {
  items: ChartItem[] // top N, largest first
  rest: ChartItem | null // null when every country is already in the top N
  restCount: number
  summable: boolean
  /** Why the pie isn't available, or null when it is. */
  pieBlocked: string | null
  total: number | null
}

const PER = /\b(per|capita|average|mean|median|rate|ratio|share|index)\b|\/|%/i

/** Whether a map's values add up to a meaningful total (so "rest" can be a sum and a pie makes sense). */
export function isSummable(map: Pick<MapResult, 'meta'>): boolean {
  const { value_type, unit, metric_label } = map.meta
  if (value_type !== 'count' && value_type !== 'currency') return false
  return !PER.test(`${unit} ${metric_label}`)
}

/** "Rest of world", "Rest of Africa", "Rest of the Northern Hemisphere". */
export function restLabel(region: string | null | undefined): string {
  const r = regionOf(region)
  if (r.id === WORLD) return 'Rest of world'
  return r.group === 'hemisphere' ? `Rest of the ${r.label}` : `Rest of ${r.label}`
}

export function topAndRest(map: Pick<MapResult, 'meta' | 'rows' | 'region'>, n: number): ChartData {
  const top = Math.max(TOP_MIN, Math.min(TOP_MAX, Math.round(n)))
  const rows = map.rows
    .filter((r) => typeof r[1] === 'number' && Number.isFinite(r[1]) && inRegion(map.region, r[0]))
    .map((r) => ({ iso3: r[0], value: r[1] as number }))
    .sort((a, b) => b.value - a.value)
  const summable = isSummable(map)
  const negatives = rows.some((r) => r.value < 0)
  const total = summable && !negatives ? rows.reduce((s, r) => s + r.value, 0) : null
  const share = (v: number) => (total && total > 0 ? v / total : null)
  const items: ChartItem[] = rows.slice(0, top).map((r) => ({ key: r.iso3, label: countryName(r.iso3), value: r.value, share: share(r.value), rest: false }))
  const others = rows.slice(top)
  let rest: ChartItem | null = null
  if (others.length > 0) {
    const sum = others.reduce((s, r) => s + r.value, 0)
    const value = summable ? sum : sum / others.length
    const label = summable ? restLabel(map.region) : `${restLabel(map.region)} (average)`
    rest = { key: 'rest', label, value, share: share(value), rest: true }
  }
  let pieBlocked: string | null = null
  if (!summable) pieBlocked = 'A pie shows parts of a total. These values are rates or averages, which don\'t add up to one, so the bars compare them instead.'
  else if (negatives) pieBlocked = 'Some values are negative, so they can\'t be slices of a whole. The bars show them instead.'
  else if (!total || total <= 0) pieBlocked = 'There is no total to split.'
  return { items, rest, restCount: others.length, summable, pieBlocked, total }
}
