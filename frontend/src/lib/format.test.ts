import { describe, expect, it } from 'vitest'
import { csvCell } from './exporters'
import { formatCompact, formatCountdown, formatFull, formatRange, formatWithUnit } from './format'

describe('number formatting', () => {
  it('compacts large numbers and keeps small ones precise', () => {
    expect(formatCompact(1_397_800)).toBe('1.4M')
    expect(formatCompact(52_000)).toBe('52K')
    expect(formatCompact(7147)).toBe('7,147')
    expect(formatCompact(12.34)).toBe('12.3')
    expect(formatCompact(4.5)).toBe('4.5')
    expect(formatCompact(0.0521)).toBe('0.052')
    expect(formatCompact(0)).toBe('0')
    expect(formatCompact(-2.5)).toBe('-2.5')
  })

  it('formats full values with grouping', () => {
    expect(formatFull(1_550_000)).toBe('1,550,000')
    expect(formatFull(72.456)).toBe('72.46')
    expect(formatFull(327)).toBe('327')
    expect(formatFull(0.00512)).toBe('0.00512')
  })

  it('attaches percent units to the number', () => {
    expect(formatWithUnit(45.2, '% of population')).toEqual({ value: '45.2%', unit: 'of population' })
    expect(formatWithUnit(1_550_000, 'deaths')).toEqual({ value: '1,550,000', unit: 'deaths' })
    expect(formatWithUnit(3, 'percent')).toEqual({ value: '3%', unit: '' })
  })

  it('formats ranges', () => {
    expect(formatRange(1_000_000, 2_800_000)).toBe('1M – 2.8M')
    expect(formatRange(5, 5)).toBe('5')
  })

  it('counts down to a reset time', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(formatCountdown(new Date(now + (5 * 3600 + 12 * 60) * 1000).toISOString(), now)).toBe('5h 12m')
    expect(formatCountdown(new Date(now + 90_000).toISOString(), now)).toBe('1m 30s')
    expect(formatCountdown(new Date(now - 1000).toISOString(), now)).toBe('now')
    expect(formatCountdown(null, now)).toBe('')
  })
})

describe('CSV export', () => {
  it('neutralises spreadsheet formulas in text but not in numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1 note')).toBe("'+1 note")
    expect(csvCell(-12.5)).toBe('-12.5')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell(null)).toBe('')
  })
})
