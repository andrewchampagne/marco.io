import { describe, expect, it } from 'vitest'
import { parallelsBetween } from './grid'
import { MAP_NORTH, MAP_SOUTH, SEAM_EAST, SEAM_WEST, constrainLat, constrainLng, homeCamera, mercY, minZoomFor, topInsetFor } from './style'

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
  it('fully zoomed out, the map is centred and cannot move sideways', () => {
    // Phone: the map fills the width exactly, Alaska at the left edge and Chukotka at the right.
    const zp = minZoomFor(375, 812)
    for (const lng of [-120, 0, 11, 100, 179]) {
      const c = constrainLng(lng, zp, 375, 812)
      expect(c - halfDeg(zp, 375)).toBeCloseTo(SEAM_WEST, 6)
      expect(c + halfDeg(zp, 375)).toBeCloseTo(SEAM_EAST, 6)
    }
    // Desktop: the map is narrower than the screen and sits in the middle.
    const zd = minZoomFor(1280, 720)
    for (const lng of [-120, 0, 100]) expect(constrainLng(lng, zd, 1280, 720)).toBeCloseTo(SEAM_WEST + 180, 9)
  })

  it('pans sideways as soon as it is zoomed in a little, on a desktop too', () => {
    const [w, h] = [1280, 720]
    const z = minZoomFor(w, h) + 0.15 // still narrower than the screen
    expect(worldPx(z)).toBeLessThan(w)
    const room = (worldPx(z) - worldPx(minZoomFor(w, h))) / 2 // px each way
    expect(room).toBeGreaterThan(40)
    expect(constrainLng(-100, z, w, h)).toBeCloseTo(SEAM_WEST + 180 - (room / worldPx(z)) * 360, 6)
    expect(constrainLng(120, z, w, h)).toBeCloseTo(SEAM_WEST + 180 + (room / worldPx(z)) * 360, 6)
  })

  it('zoomed in, stops with the screen edge at the seam (phone) or the zoomed-out margin past it (desktop)', () => {
    const z = 6 // the screen spans about 14 degrees
    // Phone: exactly at the seams.
    expect(constrainLng(-168.5, z, 375, 812) - halfDeg(z, 375)).toBeCloseTo(SEAM_WEST, 6)
    expect(constrainLng(-171, z, 375, 812) + halfDeg(z, 375)).toBeCloseTo(SEAM_EAST, 6) // -171 is the far east
    // Desktop: past each seam by the dark margin the zoomed-out map had at the sides.
    const margin = (1280 - worldPx(minZoomFor(1280, 720))) / 2
    const leftEdgePx = (constrainLng(-167, z, 1280, 720) - halfDeg(z, 1280) - SEAM_WEST) / 360 * worldPx(z)
    expect(leftEdgePx).toBeCloseTo(-margin, 4)
    expect(constrainLng(20, z, 1280, 720)).toBe(20)
    expect(constrainLng(178, z, 1280, 720)).toBe(178) // east Russia, still inside
  })

  it('treats longitudes from the other side of the date line as the east end', () => {
    // Deep zoom into Chukotka past 180 degrees: -174 and 186 are the same place.
    expect(constrainLng(-174, 7, 1280, 720)).toBeCloseTo(186, 9)
    expect(constrainLng(186, 7, 1280, 720)).toBeCloseTo(186, 9)
  })
})

describe('the grid', () => {
  it('has the 15 degree parallels and keeps going evenly past the poles', () => {
    const lines = parallelsBetween(-0.5, 1.5).map((p) => p.y).sort((a, b) => a - b)
    expect(lines.filter((y) => y >= 0 && y <= 1).length).toBeGreaterThanOrEqual(11)
    expect(lines.some((y) => y < 0)).toBe(true) // north of the world's top
    expect(lines.some((y) => y > 1)).toBe(true) // south of its bottom
    expect(parallelsBetween(0, 1).filter((p) => p.axis).map((p) => p.y)).toEqual([0.5]) // the equator
  })
})

describe('the starting view', () => {
  it('fills the width with the whole earth, centred left to right, at the height it is given', () => {
    const [w, h] = [1280, 720]
    // 38.3 is where MapLibre's fit of the world box below the search bar puts the centre at 1280x720.
    const home = homeCamera(w, h, 38.3)
    expect(worldPx(home.zoom)).toBeCloseTo(w, 6) // Alaska at the left edge, Chukotka at the right
    expect(home.center[0]).toBe(SEAM_WEST + 180)
    expect(home.center[1]).toBeCloseTo(38.3, 9)
    expect(home.zoom).toBeGreaterThan(minZoomFor(w, h) + 0.3) // you can still zoom out from here
    // South America shows down to about 51 degrees south, as it always did.
    expect(screenY(-51, 38.3, home.zoom, h)).toBeLessThan(h)
    expect(constrainLng(home.center[0], home.zoom, w, h)).toBeCloseTo(home.center[0], 9)
  })

  it('on a phone it is the fully zoomed-out view, kept on screen', () => {
    const [w, h] = [375, 812]
    const home = homeCamera(w, h, 30)
    expect(home.zoom).toBeCloseTo(minZoomFor(w, h), 9)
    expect(screenY(MAP_NORTH, home.center[1], home.zoom, h)).toBeGreaterThanOrEqual(topInsetFor(w) - 1e-6)
    expect(screenY(MAP_SOUTH, home.center[1], home.zoom, h)).toBeLessThanOrEqual(h - 8 + 1e-6)
  })
})
