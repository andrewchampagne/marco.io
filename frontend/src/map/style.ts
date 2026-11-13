/** MapLibre style: no tiles, no glyphs, no external requests. Bundled polygons on a black canvas. */
import type { FeatureCollection, LineString, Point } from 'geojson'
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'
import { COUNTRIES } from '../lib/countries'
import { EMPTY_COLOR } from '../lib/palettes'

export const CANVAS = '#07070A'
export const ACCENT = '#7FE7F2'
export const BANDS = 12 // longitude bands for the west-to-east reveal
export const MARKER_FADE_ZOOM: [number, number] = [4.6, 6.2]
/** Absolute floor (also for zooms read from files); the live minimum is `minZoomFor` the viewport width. */
export const MIN_ZOOM = -1.5
export const MAX_ZOOM = 8
const TILE = 512 // MapLibre's world size at zoom 0, in CSS pixels
const MAX_LAT = 85.051129
/** The map's left and right edge: the Bering Strait, between Little Diomede (US) and Big Diomede (Russia).
 *  The world runs from here east for 360 degrees, so Alaska is at the far left and Chukotka at the far
 *  right, and the map doesn't wrap. */
export const SEAM_WEST = -169
export const SEAM_EAST = SEAM_WEST + 360
/** The map's top and bottom: just past northern Greenland (83.6°N) and Cape Horn (55.9°S). There is no
 *  Antarctica in the country data, so nothing south of this is part of the map. */
export const MAP_NORTH = 84
export const MAP_SOUTH = -57

/** Screen space the map keeps clear: the search bar along the top (two rows on a phone) and a little at the
 *  bottom, in CSS pixels. Zoomed all the way out, the whole map fits between them. */
export function topInsetFor(viewportWidth: number): number {
  return viewportWidth < 768 ? 112 : 64
}
const BOTTOM_INSET = 8

/** Web Mercator y as a share of the world's height, 0 at the top. */
export function mercY(lat: number): number {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360)) / (2 * Math.PI)
}
const Y_NORTH = mercY(MAP_NORTH)
const Y_SOUTH = mercY(MAP_SOUTH)

/** The lowest zoom for a viewport: the whole map (seam to seam, Greenland to Cape Horn) just fits on screen,
 *  below the search bar. The height decides on a desktop (about 0.93 at 1280x720, with dark space at the
 *  sides) and the width on a phone in portrait (about -0.45 at 375x812). */
export function minZoomFor(viewportWidth: number, viewportHeight: number): number {
  const fitWidth = Math.log2(Math.max(1, viewportWidth) / TILE)
  const usable = Math.max(1, viewportHeight - topInsetFor(viewportWidth) - BOTTOM_INSET)
  const fitHeight = Math.log2(usable / (TILE * (Y_SOUTH - Y_NORTH)))
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitWidth, fitHeight))
}

/** The longitude the camera may sit at: the screen's left edge never goes west of SEAM_WEST and its right
 *  edge never east of SEAM_EAST. Longitudes are first moved into SEAM_WEST..SEAM_EAST, so -175 (just west
 *  of the strait) becomes 185 and sits at the right, next to Russia. */
export function constrainLng(lng: number, zoom: number, viewportWidth: number): number {
  let l = ((((lng - SEAM_WEST) % 360) + 360) % 360) + SEAM_WEST
  if (!Number.isFinite(l)) l = SEAM_WEST + 180
  const half = (viewportWidth / 2 / (TILE * 2 ** zoom)) * 360
  const lo = SEAM_WEST + half
  const hi = SEAM_EAST - half
  if (lo >= hi) return SEAM_WEST + 180
  return Math.max(lo, Math.min(hi, l))
}

/**
 * The latitude the camera may sit at for a zoom and viewport. MapLibre's default constrain refuses to zoom
 * out once the world is shorter than the viewport, which would stop a phone in portrait from fitting the
 * width, so this replaces it. When the map (MAP_NORTH..MAP_SOUTH) is taller than the space below the search
 * bar, that space can't go past the map's top or bottom; when it's shorter, the map can't leave that space.
 * At the minimum zoom the two meet, so the whole map sits still. Longitude is bounded by `constrainLng`.
 */
export function constrainLat(lat: number, zoom: number, viewportWidth: number, viewportHeight: number): number {
  const y = mercY(lat)
  const worldPx = TILE * 2 ** zoom
  const half = viewportHeight / 2 / worldPx
  const top = topInsetFor(viewportWidth) / worldPx
  const bottom = BOTTOM_INSET / worldPx
  const topAligned = Y_NORTH + half - top // the map's top edge just under the search bar
  const bottomAligned = Y_SOUTH - half + bottom // the map's bottom edge at the bottom of the screen
  const yc = Math.max(Math.min(topAligned, bottomAligned), Math.min(Math.max(topAligned, bottomAligned), y))
  return (360 / Math.PI) * Math.atan(Math.exp((0.5 - yc) * 2 * Math.PI)) - 90
}

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
