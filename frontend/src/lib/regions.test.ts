import { describe, expect, it } from 'vitest'
import { COUNTRIES } from './countries'
import { REGIONS, WORLD, inRegion, regionBounds, regionOf } from './regions'
import { geometryPath, projectRing } from './regionThumbs'

describe('regions', () => {
  it('falls back to the whole world for unknown or missing ids', () => {
    expect(regionOf(undefined).id).toBe(WORLD)
    expect(regionOf('atlantis').id).toBe(WORLD)
    expect(regionOf('europe').label).toBe('Europe')
  })

  it('answers membership, treating the world (and old maps without a region) as everything', () => {
    expect(inRegion('europe', 'FRA')).toBe(true)
    expect(inRegion('europe', 'BRA')).toBe(false)
    expect(inRegion(undefined, 'BRA')).toBe(true)
    expect(inRegion(WORLD, 'BRA')).toBe(true)
  })

  it('covers every country with the world region and gives each region a camera box', () => {
    expect(regionOf(WORLD).members.length).toBe(COUNTRIES.length)
    for (const r of REGIONS) {
      const [[w, s], [e, n]] = regionBounds(r.id)
      expect(w).toBeLessThan(e)
      expect(s).toBeLessThan(n)
      expect(r.short.length).toBeLessThanOrEqual(14) // fits the search bar pill
    }
  })
})

describe('region thumbnails', () => {
  it('projects to the 360x140 frame and drops repeated points', () => {
    expect(projectRing([[0, 0], [0.2, 0.1], [10, 0], [10, 10], [0, 0]])).toBe('M180,84L190,84L190,74L180,84Z')
  })

  it('skips rings that collapse below a triangle', () => {
    expect(projectRing([[0, 0], [0.1, 0.1], [0.2, 0]])).toBe('')
    expect(geometryPath({ type: 'MultiPolygon', coordinates: [[[[0, 0], [0.1, 0], [0, 0.1]]], [[[0, 0], [10, 0], [10, 10]]]] })).toBe('M180,84L190,84L190,74Z')
  })
})
