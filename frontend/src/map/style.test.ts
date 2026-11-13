import { describe, expect, it } from 'vitest'
import { SEAM_EAST, SEAM_WEST, constrainLat, constrainLng, minZoomFor } from './style'

const worldPx = (z: number) => 512 * 2 ** z
const mercY = (lat: number) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const halfDeg = (z: number, w: number) => (w / 2 / worldPx(z)) * 360

describe('zoom limits', () => {
  it('stops zooming out where the whole earth exactly fills the width', () => {
    expect(worldPx(minZoomFor(1280))).toBeCloseTo(1280, 6)
    expect(worldPx(minZoomFor(375))).toBeCloseTo(375, 6)
  })

  it('lets the North Pole come 40% down the screen when zoomed in, and keeps a small world on screen', () => {
    const z = 1.5
    const h = 720
    const lat = constrainLat(89.9, z, h)
    const topOfWorldPx = (0 - (mercY(lat) - h / 2 / worldPx(z))) * worldPx(z) // pole's distance from the top edge
    expect(topOfWorldPx).toBeCloseTo(0.4 * h, 3)
    // A phone in portrait: the width-fitted world is shorter than the screen and can't leave it.
    const zs = minZoomFor(375)
    const y = mercY(constrainLat(85, zs, 812))
    expect(y - 812 / 2 / worldPx(zs)).toBeLessThanOrEqual(0.0000001)
  })
})

describe('no wrapping: the edges are the Bering Strait', () => {
  it('fully zoomed out, Alaska is at the left edge and Chukotka at the right', () => {
    const z = minZoomFor(1280)
    for (const lng of [-120, 0, 11, 100, 179]) {
      const c = constrainLng(lng, z, 1280)
      expect(c - halfDeg(z, 1280)).toBeCloseTo(SEAM_WEST, 6)
      expect(c + halfDeg(z, 1280)).toBeCloseTo(SEAM_EAST, 6)
    }
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
