/**
 * Choropleth palettes. Each is an ordered ramp (low -> high) interpolated in OKLab to N classes.
 *
 * Low values are at the light or cool end and high values at the dark end (D-45). The single-hue ramps run
 * light -> dark; the default runs green -> yellow -> dark maroon (D-47), so the top classes are the darkest.
 * Tuned for the near-black canvas (#07070A): every ramp's dark end keeps >= 2:1 contrast against the
 * canvas, so high classes never disappear into the background. They also stay clearly apart from the
 * N/A grey, which additionally carries a hatch texture.
 *
 * "Verdant to Maroon" and "Neon" are multi-hue scales (semantic heat / analogous hues), which are legitimate
 * for magnitude only with a scale legend - the legend is always shown. Cividis is the colourblind-safe
 * option: yellow to blue with monotone lightness.
 */

export type PaletteId = 'verdant' | 'viridis' | 'inferno' | 'ice' | 'neon' | 'mono' | 'cividis'

export interface Palette {
  id: PaletteId
  name: string
  hint: string
  stops: string[] // low -> high
}

export const PALETTES: Palette[] = [
  {
    id: 'verdant',
    name: 'Verdant to Maroon',
    hint: 'Severity: bright green, yellow, then dark maroon',
    stops: ['#2FD27E', '#9DD36A', '#F2E36B', '#F7A24A', '#E2533F', '#B0223F', '#8E1539'],
  },
  {
    id: 'viridis',
    name: 'Viridis',
    hint: 'Perceptually even, yellow to purple',
    stops: ['#FDE725', '#C2DF23', '#85D54A', '#51C56A', '#2BB07F', '#1E9B8A', '#25858E', '#2D708E', '#38598C', '#433E85'],
  },
  {
    id: 'inferno',
    name: 'Inferno',
    hint: 'Heat: pale yellow through flame to plum',
    stops: ['#FCFFA4', '#F7D13D', '#FB9B06', '#ED6925', '#CF4446', '#A52C60', '#781C6D'],
  },
  {
    id: 'ice',
    name: 'Ice',
    hint: 'Water and cold: frost to deep blue',
    stops: ['#FBFDFF', '#C4E1FA', '#8CC6F2', '#5AA9E6', '#3A8BD0', '#2E6AAB', '#2B4C7E'],
  },
  {
    id: 'neon',
    name: 'Neon',
    hint: 'Cyan to magenta',
    stops: ['#00E1FF', '#3FB2FF', '#7C86FF', '#B05EFF', '#E040F0', '#FF2DAE'],
  },
  {
    id: 'mono',
    name: 'Mono',
    hint: 'White to graphite',
    stops: ['#FFFFFF', '#5E5E6D'],
  },
  {
    id: 'cividis',
    name: 'Cividis',
    hint: 'Colourblind-safe: yellow to blue',
    stops: ['#FEE838', '#F0D64E', '#CDB966', '#AA9F72', '#8A8678', '#6A6E72', '#4A5A6E', '#2A4570'],
  },
]

export const PALETTE_IDS = PALETTES.map((p) => p.id)
export const DEFAULT_PALETTE: PaletteId = 'verdant'

/** Fill for countries without data: a grey that reads against the canvas (paired with a hatch). */
export const NA_COLOR = '#3B3B47'
/** Fill for an exact, documented zero: a flat light neutral, outside every ramp and unlike the dark hatched N/A. */
export const ZERO_COLOR = '#9C9CAA'
/** Bin index the API uses for exact zeros when they have their own class (null bin = no data). */
export const ZERO_BIN = -2

/** Swatch colour for a row's bin index: a ramp class, the zero class, or undefined for no data. */
export function binColor(bin: number | null | undefined, colors: string[]): string | undefined {
  if (bin == null) return undefined
  return bin === ZERO_BIN ? ZERO_COLOR : colors[Math.min(bin, colors.length - 1)]
}
/** Fill for countries before any map is loaded. */
export const EMPTY_COLOR = '#1C1C24'
/** Before any map is loaded, the focus region's countries are a touch lighter, so the region reads at a glance. */
export const FOCUS_IDLE_COLOR = '#292935'

export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

// ---- OKLab interpolation ------------------------------------------------------------------------

type Lab = [number, number, number]

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

export function hexToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return rgbToHex([r, g, bl].map((v) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255) as [number, number, number])
}

/** Colour at position t (0..1) along a ramp, interpolated in OKLab. */
export function sampleRamp(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0].toUpperCase()
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const a = hexToOklab(stops[i])
  const b = hexToOklab(stops[i + 1])
  return oklabToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
}

/** N class colours, low -> high (or high -> low when reversed). A single class takes the upper-middle. */
export function rampColors(id: string | null | undefined, n: number, reverse = false): string[] {
  const stops = getPalette(id).stops
  if (n <= 0) return []
  const colors = n === 1 ? [sampleRamp(stops, 0.7)] : Array.from({ length: n }, (_, i) => sampleRamp(stops, i / (n - 1)))
  return reverse ? colors.reverse() : colors
}

/** A CSS linear-gradient for palette swatches. */
export function paletteGradient(id: string, reverse = false, steps = 8): string {
  const colors = rampColors(id, steps, reverse)
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${Math.round((i / (steps - 1)) * 100)}%`).join(', ')})`
}

/** WCAG 2 relative luminance contrast between two colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => srgbToLinear(v / 255))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

