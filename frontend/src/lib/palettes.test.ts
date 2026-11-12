import { describe, expect, it } from 'vitest'
import { EMPTY_COLOR, NA_COLOR, PALETTES, ZERO_BIN, ZERO_COLOR, binColor, contrast, getPalette, hexToOklab, oklabToHex, rampColors, sampleRamp } from './palettes'

describe('binColor', () => {
  it('separates zero, no data and ramp classes', () => {
    const colors = ['#111111', '#222222', '#333333']
    expect(binColor(null, colors)).toBeUndefined()
    expect(binColor(ZERO_BIN, colors)).toBe(ZERO_COLOR)
    expect(binColor(1, colors)).toBe('#222222')
    expect(ZERO_COLOR).not.toBe(NA_COLOR)
  })
})

const CANVAS = '#07070A'
const HEX = /^#[0-9A-F]{6}$/

describe('palettes', () => {
  it('round-trips colours through OKLab', () => {
    for (const hex of ['#25B46E', '#FFFFFF', '#000000', '#7C86FF', '#8E1539']) {
      expect(oklabToHex(hexToOklab(hex))).toBe(hex)
    }
  })

  it('interpolates any class count with the exact ramp endpoints', () => {
    for (const p of PALETTES) {
      for (let n = 3; n <= 9; n++) {
        const colors = rampColors(p.id, n)
        expect(colors).toHaveLength(n)
        colors.forEach((c) => expect(c).toMatch(HEX))
        expect(colors[0]).toBe(p.stops[0].toUpperCase())
        expect(colors[n - 1]).toBe(p.stops.at(-1)!.toUpperCase())
      }
    }
  })

  it('reverses direction', () => {
    expect(rampColors('ice', 5, true)).toEqual(rampColors('ice', 5).reverse())
  })

  it('handles one class and unknown palettes', () => {
    expect(rampColors('verdant', 1)).toEqual([sampleRamp(getPalette('verdant').stops, 0.7)])
    expect(rampColors('nope', 3)).toEqual(rampColors('verdant', 3))
    expect(rampColors('mono', 0)).toEqual([])
  })

  it('keeps every class visible on the black canvas', () => {
    for (const p of PALETTES) {
      for (const c of rampColors(p.id, 9)) expect(contrast(c, CANVAS)).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps N/A visible against the canvas but distinct from idle countries', () => {
    expect(contrast(NA_COLOR, CANVAS)).toBeGreaterThan(1.7)
    expect(NA_COLOR).not.toBe(EMPTY_COLOR)
  })

  it('has monotone lightness for the single-direction ramps', () => {
    for (const id of ['viridis', 'inferno', 'ice', 'mono', 'cividis']) {
      const L = rampColors(id, 9).map((c) => hexToOklab(c)[0])
      for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThan(L[i - 1])
    }
  })
})
