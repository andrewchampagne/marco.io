import { Map as MlMap, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'
import geoUrl from '@data/countries.geojson?url'
import type { MapRow } from '../api/types'
import { COUNTRIES, COUNTRY_BY_ISO3 } from '../lib/countries'
import { EMPTY_COLOR, NA_COLOR, rampColors } from '../lib/palettes'
import { selectCountry } from '../state/actions'
import { prefersReducedMotion } from '../state/prefs'
import { store } from '../state/store'
import { BANDS, MARKER_FADE_ZOOM, buildStyle, hatchImage } from './style'

// MapLibre resolves its worker relative to its own module, which a bundle doesn't preserve. Importing the
// worker with ?url makes Vite emit it as an asset (dev and build) and gives MapLibre its real address.
setWorkerUrl(workerUrl)

export const WORLD_BOUNDS: [[number, number], [number, number]] = [[-168, -56], [180, 78]]
const TINY = new Set(COUNTRIES.filter((c) => c.tiny).map((c) => c.iso3))

let mapInstance: MlMap | null = null
const resetHooks = new Set<() => void>()
/** The live map (for PNG export and camera resets). */
export function getMap(): MlMap | null {
  return mapInstance
}

export function resetView(): void {
  const map = mapInstance
  if (!map) return
  resetHooks.forEach((fn) => fn())
  map.fitBounds(WORLD_BOUNDS, { padding: framePadding(), duration: prefersReducedMotion(store.get().prefs.motion) ? 0 : 900 })
}

function framePadding() {
  const w = window.innerWidth
  const narrow = w < 640
  return { top: narrow ? 150 : 120, bottom: narrow ? 120 : 60, left: narrow ? 8 : 24, right: narrow ? 8 : 24 }
}


export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new MlMap({
      container,
      style: buildStyle(),
      bounds: WORLD_BOUNDS,
      fitBoundsOptions: { padding: framePadding() },
      minZoom: 0.4,
      maxZoom: 8,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false, // credit lives in About and the info popover; the corner is taken by controls
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    mapInstance = map
    ;(window as unknown as { __terrachromeMap?: MlMap }).__terrachromeMap = map // inspection hook for e2e screenshots

    const colors = new globalThis.Map<string, string>() // iso3 -> colour currently shown
    let loaded = false
    let hoverIso: string | null = null
    let selectedIso: string | null = null
    let dimmed = new Set<string>()
    let highlighted = new Set<string>()
    let raf = 0
    let lastNonce = -1
    let userMoved = false
    const markMoved = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved = true
    }
    map.on('dragstart', markMoved)
    map.on('zoomstart', markMoved)
    map.on('resize', () => {
      if (!userMoved) map.fitBounds(WORLD_BOUNDS, { padding: framePadding(), duration: 0 })
    })
    resetHooks.add(() => (userMoved = false))

    const setState = (iso3: string, patch: Record<string, unknown>) => {
      map.setFeatureState({ source: 'countries', id: iso3 }, patch)
      if (TINY.has(iso3)) map.setFeatureState({ source: 'markers', id: iso3 }, patch)
    }

    const bandLayers = Array.from({ length: BANDS }, (_, i) => `countries-next-${i}`)
    const animateReveal = (mode: 'sweep' | 'fade' | 'none') => {
      cancelAnimationFrame(raf)
      const set = (opacity: number, timing: (i: number) => { duration: number; delay: number }) =>
        bandLayers.forEach((id, i) => {
          map.setPaintProperty(id, 'fill-opacity-transition', timing(i))
          map.setPaintProperty(id, 'fill-opacity', opacity)
        })
      if (mode === 'none') {
        set(1, () => ({ duration: 0, delay: 0 }))
        return
      }
      set(0, () => ({ duration: 0, delay: 0 }))
      // Let one frame render at opacity 0, then hand the fade-in to MapLibre's transition engine.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() =>
          set(1, (i) => (mode === 'sweep' ? { duration: 560, delay: i * 70 } : { duration: 240, delay: 0 })),
        )
      })
    }

    /** Recolour every country from the current map + view; animate a sweep for new maps, a fade otherwise. */
    const paint = (mode: 'sweep' | 'fade' | 'none') => {
      if (!loaded) return
      const { map: result, view, prefs } = store.get()
      const reduce = prefersReducedMotion(prefs.motion)
      const rows: MapRow[] = result?.status === 'ok' ? result.rows : []
      const classes = result?.binning?.classes ?? 0
      const palette = rampColors(view.palette, classes, view.reverse)
      const byIso = new globalThis.Map(rows.map((r) => [r[0], r]))
      const naCodes: string[] = []
      for (const country of COUNTRIES) {
        const row = byIso.get(country.iso3)
        const bin = row?.[4]
        let next = EMPTY_COLOR
        if (result?.status === 'ok') {
          if (bin == null) {
            next = NA_COLOR
            naCodes.push(country.iso3)
          } else {
            next = palette[Math.min(bin, palette.length - 1)] ?? NA_COLOR
          }
        }
        const prev = colors.get(country.iso3) ?? EMPTY_COLOR
        colors.set(country.iso3, next)
        setState(country.iso3, { prev, color: next, hasData: bin != null })
      }
      if (map.getLayer('countries-na')) {
        map.setFilter('countries-na', ['in', ['get', 'iso3'], ['literal', naCodes]])
      }
      animateReveal(reduce ? 'none' : mode)
    }

    const applyHighlight = () => {
      if (!loaded) return
      const { map: result, legendHover } = store.get()
      const nextDim = new Set<string>()
      const nextHighlight = new Set<string>()
      if (legendHover !== null && result?.status === 'ok') {
        for (const row of result.rows) {
          const inBin = legendHover === -1 ? row[4] == null : row[4] === legendHover
          if (inBin) nextHighlight.add(row[0])
          else nextDim.add(row[0])
        }
      }
      for (const iso of dimmed) if (!nextDim.has(iso)) setState(iso, { dim: false })
      for (const iso of nextDim) if (!dimmed.has(iso)) setState(iso, { dim: true })
      for (const iso of highlighted) if (!nextHighlight.has(iso)) setState(iso, { highlight: false })
      for (const iso of nextHighlight) if (!highlighted.has(iso)) setState(iso, { highlight: true })
      dimmed = nextDim
      highlighted = nextHighlight
    }

    const applySelected = () => {
      if (!loaded) return
      const next = store.get().selected
      if (next === selectedIso) return
      if (selectedIso) setState(selectedIso, { selected: false })
      if (next) setState(next, { selected: true })
      selectedIso = next
    }

    const setHover = (iso3: string | null, x = 0, y = 0) => {
      if (iso3 !== hoverIso) {
        if (hoverIso) setState(hoverIso, { hover: false })
        if (iso3) setState(iso3, { hover: true })
        hoverIso = iso3
        map.getCanvas().style.cursor = iso3 ? 'pointer' : ''
      }
      store.set({ hover: iso3 ? { iso3, x, y } : null })
    }

    const pick = (point: { x: number; y: number }): string | null => {
      const layers = map.getZoom() < MARKER_FADE_ZOOM[1] ? ['markers-hit', 'countries-prev'] : ['countries-prev']
      const features: MapGeoJSONFeature[] = map.queryRenderedFeatures([point.x, point.y], { layers })
      const marker = features.find((f) => f.layer.id === 'markers-hit')
      const hit = marker ?? features[0]
      const iso3 = hit?.properties?.iso3
      return typeof iso3 === 'string' && COUNTRY_BY_ISO3[iso3] ? iso3 : null
    }

    map.on('load', async () => {
      map.addImage('hatch', hatchImage(), { pixelRatio: 2 })
      map.addLayer(
        { id: 'countries-na', type: 'fill', source: 'countries', filter: ['in', ['get', 'iso3'], ['literal', []]], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.95 } },
        'countries-dim',
      )
      const geo = await (await fetch(geoUrl)).json()
      for (const feature of geo.features) {
        const c = COUNTRY_BY_ISO3[feature.properties.iso3]
        const lon = c ? (c.bbox[0] + c.bbox[2]) / 2 : 0
        feature.properties.band = Math.min(BANDS - 1, Math.max(0, Math.floor(((lon + 180) / 360) * BANDS)))
      }
      ;(map.getSource('countries') as GeoJSONSource).setData(geo)
      map.once('idle', () => {
        loaded = true
        lastNonce = store.get().mapNonce
        paint('sweep')
        applySelected()
        applyHighlight()
      })
    })

    map.on('mousemove', (e) => {
      const iso3 = pick(e.point)
      setHover(iso3, e.point.x, e.point.y)
    })
    map.on('mouseout', () => setHover(null))
    map.on('dragstart', () => setHover(null))
    map.on('click', (e) => {
      const iso3 = pick(e.point)
      const { map: result } = store.get()
      selectCountry(iso3 && result?.status === 'ok' ? iso3 : null)
      if (iso3 && !result) selectCountry(null)
    })

    // React to store changes without re-rendering React: palette/bins/map -> repaint, etc.
    let prev = store.get()
    const unsubscribe = store.subscribe(() => {
      const s = store.get()
      if (s.mapNonce !== lastNonce && loaded) {
        lastNonce = s.mapNonce
        paint('sweep')
      } else if (s.map !== prev.map || s.view !== prev.view) {
        paint(s.map?.slug !== prev.map?.slug ? 'sweep' : 'fade')
      }
      if (s.legendHover !== prev.legendHover || s.map !== prev.map) applyHighlight()
      if (s.selected !== prev.selected) applySelected()
      if (s.flyTo && s.flyTo !== prev.flyTo) {
        const c = COUNTRY_BY_ISO3[s.flyTo.iso3]
        if (c) {
          userMoved = true
          const [w, so, e, n] = c.bbox
          const reduce = prefersReducedMotion(s.prefs.motion)
          map.fitBounds([[w, so], [e, n]], { padding: { ...framePadding(), right: window.innerWidth > 900 ? 400 : 24 }, maxZoom: c.tiny ? 7 : 5.5, duration: reduce ? 0 : 1400 })
        }
      }
      prev = s
    })

    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
      mapInstance = null
      map.remove()
    }
  }, [])

  // MapLibre's stylesheet makes the container `position: relative`, so size it from an absolute wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="World map" role="region" />
    </div>
  )
}
