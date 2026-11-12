/**
 * Tiny world thumbnails for the region picker, drawn from the same countries.geojson the map uses.
 *
 * Equirectangular, 360 x 140 units (longitude -180..180, latitude 84..-56), with every ring snapped to whole
 * units and repeated points dropped, so a country is a handful of points and the whole world is a few
 * thousand: cheap to build once, then each card is just two <path>s.
 */
import { useEffect, useState } from 'react'
import geoUrl from '@data/countries.geojson?url'

export const THUMB_W = 360
export const THUMB_H = 140
const TOP_LAT = 84

type Ring = number[][]
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }

export function projectRing(ring: Ring): string {
  let d = ''
  let last = ''
  let count = 0
  for (const [lon, lat] of ring) {
    const x = Math.round(lon + 180)
    const y = Math.round(Math.min(THUMB_H, Math.max(0, TOP_LAT - lat)))
    const key = `${x},${y}`
    if (key === last) continue
    d += `${count === 0 ? 'M' : 'L'}${key}`
    last = key
    count++
  }
  return count >= 3 ? `${d}Z` : ''
}

export function geometryPath(geometry: Geometry): string {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.map((rings) => projectRing(rings[0] ?? [])).join('')
}

let pending: Promise<Map<string, string>> | null = null

/** iso3 -> SVG path data. Loads once; the map has already fetched the same file, so it's a cache hit. */
export function loadThumbPaths(): Promise<Map<string, string>> {
  pending ??= fetch(geoUrl)
    .then((r) => r.json())
    .then((geo: { features: { properties: { iso3: string }; geometry: Geometry }[] }) => {
      const out = new Map<string, string>()
      for (const f of geo.features) {
        const d = geometryPath(f.geometry)
        if (d) out.set(f.properties.iso3, d)
      }
      return out
    })
    .catch((err) => {
      pending = null
      throw err
    })
  return pending
}

export function useThumbPaths(enabled: boolean): Map<string, string> | null {
  const [paths, setPaths] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    if (!enabled || paths) return
    let live = true
    loadThumbPaths().then((p) => live && setPaths(p)).catch(() => {})
    return () => {
      live = false
    }
  }, [enabled, paths])
  return paths
}
