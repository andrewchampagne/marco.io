import { describe, expect, it } from 'vitest'
import type { MapResult } from '../api/types'
import { SLICE_COLORS, TOP_MAX, isSummable, restLabel, topAndRest } from './charts'

type Input = Pick<MapResult, 'meta' | 'rows' | 'region'>

function map(values: Record<string, number | null>, meta: Partial<MapResult['meta']> = {}, region = 'world'): Input {
  return {
    region,
    meta: { value_type: 'count', unit: 'people', metric_label: 'Population', ...meta } as MapResult['meta'],
    rows: Object.entries(values).map(([iso3, v]) => [iso3, v, 'h', null, v == null ? null : 0]) as unknown as MapResult['rows'],
  }
}

const POP = { CHN: 1400, IND: 1430, USA: 335, IDN: 278, PAK: 240, NGA: 224, BRA: 216, FRA: 68, DEU: 84, KEN: null }

describe('top N and the rest', () => {
  it('ranks the top N and sums everyone else for counts', () => {
    const d = topAndRest(map(POP), 3)
    expect(d.items.map((i) => i.key)).toEqual(['IND', 'CHN', 'USA'])
    expect(d.rest?.value).toBe(278 + 240 + 224 + 216 + 68 + 84)
    expect(d.rest?.label).toBe('Rest of world')
    expect(d.restCount).toBe(6) // KEN has no value and isn't counted
    expect(d.pieBlocked).toBeNull()
    const shares = [...d.items, d.rest!].reduce((s, i) => s + (i.share ?? 0), 0)
    expect(shares).toBeCloseTo(1, 9)
  })

  it('averages the rest for rates, and offers bars instead of a pie', () => {
    const d = topAndRest(map({ JPN: 84, CHE: 83, AUS: 83, NGA: 53, TCD: 52 }, { value_type: 'rate', unit: 'years', metric_label: 'Life expectancy' }), 3)
    expect(d.summable).toBe(false)
    expect(d.rest?.value).toBeCloseTo((53 + 52) / 2, 9)
    expect(d.rest?.label).toBe('Rest of world (average)')
    expect(d.items.every((i) => i.share === null)).toBe(true)
    expect(d.pieBlocked).toMatch(/don't add up/)
  })

  it('treats "per" units as rates even when the type says count or currency', () => {
    expect(isSummable(map({}, { value_type: 'currency', unit: 'US$ per person', metric_label: 'GDP per capita' }))).toBe(false)
    expect(isSummable(map({}, { value_type: 'count', unit: 'deaths per 100,000' }))).toBe(false)
    expect(isSummable(map({}, { value_type: 'currency', unit: 'US$', metric_label: 'GDP' }))).toBe(true)
  })

  it('blocks the pie when values are negative', () => {
    const d = topAndRest(map({ USA: 1000, DEU: 500, SYR: -800, VEN: -300 }, { unit: 'people', metric_label: 'Net migration' }), 3)
    expect(d.pieBlocked).toMatch(/negative/)
    expect(d.items[0].share).toBeNull()
  })

  it('only counts the map region, and names the rest after it', () => {
    const d = topAndRest(map({ NGA: 224, EGY: 112, ETH: 126, KEN: 55, FRA: 68 }, {}, 'africa'), 3)
    expect(d.items.map((i) => i.key)).toEqual(['NGA', 'ETH', 'EGY'])
    expect(d.rest?.value).toBe(55) // France is outside Africa
    expect(d.rest?.label).toBe('Rest of Africa')
    expect(restLabel('northern')).toBe('Rest of the Northern Hemisphere')
  })

  it('keeps N between 3 and 8, one colour per slice, and drops the rest when nobody is left', () => {
    expect(topAndRest(map(POP), 20).items).toHaveLength(TOP_MAX)
    expect(SLICE_COLORS).toHaveLength(TOP_MAX)
    expect(topAndRest(map(POP), 1).items).toHaveLength(3)
    const few = topAndRest(map({ USA: 3, CAN: 2, MEX: 1 }), 5)
    expect(few.rest).toBeNull()
  })
})
