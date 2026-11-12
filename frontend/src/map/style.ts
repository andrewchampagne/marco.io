/** MapLibre style: no tiles, no glyphs, no external requests. Bundled polygons on a black canvas. */
import type { FeatureCollection, LineString, Point } from 'geojson'
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import { COUNTRIES } from '../lib/countries'
import { EMPTY_COLOR } from '../lib/palettes'

export const CANVAS = '#07070A'
export const ACCENT = '#7FE7F2'
export const BANDS = 12 // longitude bands for the west-to-east reveal
export const MARKER_FADE_ZOOM: [number, number] = [4.6, 6.2]
export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 8

const state = (name: string): ExpressionSpecification => ['boolean', ['feature-state', name], false]

export function graticule(): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = []
  for (let lon = -180; lon <= 180; lon += 15) {
    features.push({ type: 'Feature', properties: { kind: lon === 0 ? 'prime' : 'meridian' }, geometry: { type: 'LineString', coordinates: [[lon, -75], [lon, 84]] } })
  }
  for (let lat = -60; lat <= 75; lat += 15) {
    const coords: [number, number][] = []
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat])
    features.push({ type: 'Feature', properties: { kind: lat === 0 ? 'equator' : 'parallel' }, geometry: { type: 'LineString', coordinates: coords } })
  }
  return { type: 'FeatureCollection', features }
}

export function markers(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: COUNTRIES.filter((c) => c.tiny).map((c) => ({
      type: 'Feature',
      properties: { iso3: c.iso3 },
      geometry: { type: 'Point', coordinates: c.marker },
    })),
  }
}

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      countries: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'iso3',
        attribution: 'Boundaries: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>',
      },
      markers: { type: 'geojson', data: markers(), promoteId: 'iso3' },
      graticule: { type: 'geojson', data: graticule() },
    },
    layers: [
      { id: 'canvas', type: 'background', paint: { 'background-color': CANVAS } },
      {
        id: 'graticule',
        type: 'line',
        source: 'graticule',
        paint: {
          'line-color': ['match', ['get', 'kind'], ['equator', 'prime'], 'rgba(140,170,255,0.11)', 'rgba(140,170,255,0.055)'],
          'line-width': 0.6,
        },
      },
      // Previous colours (or the idle fill) underneath...
      { id: 'countries-prev', type: 'fill', source: 'countries', paint: { 'fill-color': ['coalesce', ['feature-state', 'prev'], EMPTY_COLOR] } },
      // ...new colours on top, one layer per longitude band. Each band's opacity is a constant animated with
      // MapLibre's own paint transitions (staggered west to east), so the reveal costs no re-tiling and no JS per frame.
      ...Array.from({ length: BANDS }, (_, i) => ({
        id: `countries-next-${i}`,
        type: 'fill' as const,
        source: 'countries',
        filter: ['==', ['get', 'band'], i] as ExpressionSpecification,
        paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], EMPTY_COLOR] as ExpressionSpecification, 'fill-opacity': 1 },
      })),
      {
        // Countries outside the focus region recede (the hatch for "no data" is inserted just below this).
        id: 'countries-outside',
        type: 'fill',
        source: 'countries',
        paint: { 'fill-color': CANVAS, 'fill-opacity': ['case', state('outside'), 0.74, 0] },
      },
      {
        id: 'countries-dim',
        type: 'fill',
        source: 'countries',
        paint: { 'fill-color': CANVAS, 'fill-opacity': ['case', state('dim'), 0.72, 0] },
      },
      {
        id: 'countries-hover',
        type: 'fill',
        source: 'countries',
        paint: { 'fill-color': '#FFFFFF', 'fill-opacity': ['case', state('hover'), 0.13, 0] },
      },
      {
        id: 'borders',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': 'rgba(255,255,255,0.14)',
          'line-opacity': ['case', state('outside'), 0.3, 1],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.35, 4, 0.8, 7, 1.3],
        },
      },
      {
        id: 'outline-glow',
        type: 'line',
        source: 'countries',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['case', state('selected'), ACCENT, '#FFFFFF'],
          'line-width': 7,
          'line-blur': 6,
          'line-opacity': ['case', state('selected'), 0.5, state('hover'), 0.3, state('highlight'), 0.18, 0],
        },
      },
      {
        id: 'outline',
        type: 'line',
        source: 'countries',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['case', state('selected'), ACCENT, '#FFFFFF'],
          'line-width': ['case', state('selected'), 1.7, 1.1],
          'line-opacity': ['case', state('selected'), 1, state('hover'), 0.95, state('highlight'), 0.55, 0],
        },
      },
      {
        // Invisible, generous hit area for tiny countries (dataviz: hit target bigger than the mark).
        id: 'markers-hit',
        type: 'circle',
        source: 'markers',
        maxzoom: MARKER_FADE_ZOOM[1],
        paint: { 'circle-radius': 11, 'circle-color': '#000000', 'circle-opacity': 0 },
      },
      {
        id: 'markers',
        type: 'circle',
        source: 'markers',
        maxzoom: MARKER_FADE_ZOOM[1] + 0.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.8, 3, 4, 6, 5],
          'circle-color': ['coalesce', ['feature-state', 'color'], EMPTY_COLOR],
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            MARKER_FADE_ZOOM[0], ['case', state('dim'), 0.25, state('outside'), 0.22, state('hasData'), 1, 0.6],
            MARKER_FADE_ZOOM[1], 0,
          ],
          'circle-stroke-color': ['case', state('selected'), ACCENT, state('hover'), '#FFFFFF', 'rgba(7,7,10,0.95)'],
          'circle-stroke-width': ['case', state('selected'), 1.6, state('hover'), 1.6, 1],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], MARKER_FADE_ZOOM[0], 1, MARKER_FADE_ZOOM[1], 0],
        },
      },
    ],
  }
}

/** An 8x8 diagonal hatch for countries without data, so N/A never reads as a palette colour. */
export function hatchImage(): { width: number; height: number; data: Uint8Array } {
  // 12px tile at pixelRatio 2: a 1px line every 6 screen px, low contrast so it textures rather than shouts.
  const size = 12
  const data = new Uint8Array(size * size * 4)
  const bg = [0x3b, 0x3b, 0x47]
  const fg = [0x48, 0x48, 0x55]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % size < 2
      const [r, g, b] = on ? fg : bg
      const i = (y * size + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}
