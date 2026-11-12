/** Focus regions (data/regions.json, built by data/build_regions.py), shared with the backend. */
import raw from '@data/regions.json'

export type RegionGroup = 'world' | 'continent' | 'hemisphere'

export interface Region {
  id: string
  label: string
  /** Fits the search bar's region pill, e.g. "N. Hemisphere". */
  short: string
  group: RegionGroup
  members: string[]
  /** Camera box: [west, south, east, north]. */
  bounds: [number, number, number, number]
}

export const WORLD = 'world'
export const REGIONS: Region[] = (raw as unknown as { regions: Region[] }).regions
export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]))

const MEMBER_SETS = new Map<string, Set<string>>(REGIONS.map((r) => [r.id, new Set(r.members)]))

/** The region for an id; unknown or missing ids are the whole world. */
export function regionOf(id: string | null | undefined): Region {
  return REGION_BY_ID[id ?? WORLD] ?? REGION_BY_ID[WORLD]
}

export function inRegion(regionId: string | null | undefined, iso3: string): boolean {
  const id = regionId ?? WORLD
  if (id === WORLD) return true
  return MEMBER_SETS.get(id)?.has(iso3) ?? true
}

export function regionBounds(id: string | null | undefined): [[number, number], [number, number]] {
  const [w, s, e, n] = regionOf(id).bounds
  return [[w, s], [e, n]]
}
