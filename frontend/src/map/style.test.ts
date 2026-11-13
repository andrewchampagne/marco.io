import { describe, expect, it } from 'vitest'
import { MAP_NORTH, MAP_SOUTH, SEAM_EAST, SEAM_WEST, constrainLat, constrainLng, mercY, minZoomFor, topInsetFor } from './style'

const worldPx = (z: number) => 512 * 2 ** z
const halfDeg = (z: number, w: number) => (w / 2 / worldPx(z)) * 360
/** Screen y (px from the top) of a latitude, for a camera at `lat` and `z` on a screen `h` tall. */
const screenY = (latOf: number, lat: number, z: number, h: number) => (mercY(latOf) - mercY(lat)) * worldPx(z) + h / 2

describe('zoom limits: zoomed all the way out, the whole map just fits', () => {
  it('on a desktop the height decides, with the map between the search bar and the bottom', () => {
    const [w, h] = [1280, 720]
    const z = minZoomFor(w, h)
    expect(z).toBeGreaterThan(0.85)
    expect(z).toBeLessThan(1)
    expect(worldPx(z)).toBeLessThan(w) // dark space at the sides (masked)
    // The camera can't move, and Greenland's top sits just under the search bar, Cape Horn at the bottom.
    const lat = constrainLat(0, z, w, h)
    expect(constrainLat(70, z, w, h)).toBeCloseTo(lat, 9)
    expect(screenY(MAP_NORTH, lat, z, h)).toBeCloseTo(topInsetFor(w), 6)
    expect(screenY(MAP_SOUTH, lat, z, h)).toBeCloseTo(h - 8, 6)
  })

  it('on a phone in portrait the width decides', () => {
    expect(worldPx(minZoomFor(375, 812))).toBeCloseTo(375, 6)
  })
})

describe('vertical panning', () => {
  it('zoomed in, stops with Greenland just under the search bar or Cape Horn at the bottom', () => {
    const [w, h, z] = [1280, 720, 3]
    expect(screenY(MAP_NORTH, constrainLat(89, z, w, h), z, h)).toBeCloseTo(topInsetFor(w), 6)
    expect(screenY(MAP_SOUTH, constrainLat(-89, z, w, h), z, h)).toBeCloseTo(h - 8, 6)
    expect(constrainLat(20, z, w, h)).toBeCloseTo(20, 9)
  })

  it('a map shorter than the screen stays on it', () => {
    const [w, h] = [375, 812]
    const z = minZoomFor(w, h)
    expect(screenY(MAP_NORTH, constrainLat(-89, z, w, h), z, h)).toBeGreaterThanOrEqual(topInsetFor(w) - 1e-6)
    expect(screenY(MAP_SOUTH, constrainLat(89, z, w, h), z, h)).toBeLessThanOrEqual(h - 8 + 1e-6)
  })
})

describe('no wrapping: the edges are the Bering Strait', () => {
  it('fully zoomed out, the map is centred and can\'t move sideways', () => {
    // Phone: the map fills the width exactly, Alaska at the left edge and Chukotka at the right.
    const zp = minZoomFor(375, 812)
    for (const lng of [-120, 0, 11, 100, 179]) {
      const c = constrainLng(lng, zp, 375)
      expect(c - halfDeg(zp, 375)).toBeCloseTo(SEAM_WEST, 6)
      expect(c + halfDeg(zp, 375)).toBeCloseTo(SEAM_EAST, 6)
    }
    // Desktop: the map is narrower than the screen and sits in the middle.
    const zd = minZoomFor(1280, 720)
    for (const lng of [-120, 0, 100]) expect(constrainLng(lng, zd, 1280)).toBe(SEAM_WEST + 180)
  })

  it('stops panning at either edge and leaves the middle alone', () => {
    const z = 6 // the screen spans about 14 degrees
    const w = 1280
    expect(constrainLng(-165, z, w) - halfDeg(z, w)).toBeCloseTo(SEAM_WEST, 6) // can't pan west of Alaska
    expect(constrainLng(20, z, w)).toBe(20)
    expect(constrainLng(-175, z, w) + halfDeg(z, w)).toBeCloseTo(SEAM_EAST, 6) // -175 is the far east
    expect(constrainLng(178, z, w)).toBe(178) // east Russia, still inside
    expect(constrainLng(185, z, w)).toBeLessThanOrEqual(SEAM_EAST - halfDeg(z, w))
  })

  it('treats longitudes from the other side of the date line as the east end', () => {
    // Deep zoom into Chukotka past 180 degrees: -174 and 186 are the same place.
    expect(constrainLng(-174, 7, 1280)).toBeCloseTo(186, 9)
    expect(constrainLng(186, 7, 1280)).toBeCloseTo(186, 9)
  })
})
