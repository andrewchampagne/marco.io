/**
 * The background grid (meridians every 15°, parallels every 15° up to 75° and evenly beyond), drawn in
 * screen space from the map's camera so it fills the whole screen, not just the map.
 *
 * Two canvases use it: one behind the (transparent) map canvas, which shows through wherever there's no
 * country, and one in front that covers only what lies outside the map (past the Bering Strait seams, where
 * MapLibre would draw copies of the world, and past the poles) with the same background and grid.
 */
import type { Map as MlMap } from 'maplibre-gl'
import { CANVAS, SEAM_EAST, SEAM_WEST, mercY } from './style'

const TILE = 512
const STEP = 15
const LINE = 'rgba(140,170,255,0.055)'
const AXIS = 'rgba(140,170,255,0.11)' // the equator and the prime meridian
const Y75N = mercY(75)
const Y75S = mercY(-75)
/** Past 75° the parallels keep the 60°-75° spacing, so the grid goes on past the poles. */
const POLAR_STEP = mercY(60) - Y75N

/** Parallels (as Mercator y, 0..1 inside the world) between y0 and y1, flagging the equator. */
export function parallelsBetween(y0: number, y1: number): { y: number; axis: boolean }[] {
  const out: { y: number; axis: boolean }[] = []
  for (let lat = -75; lat <= 75; lat += STEP) {
    const y = mercY(lat)
    if (y >= y0 && y <= y1) out.push({ y, axis: lat === 0 })
  }
  for (let y = Y75N - POLAR_STEP; y >= y0; y -= POLAR_STEP) if (y <= y1) out.push({ y, axis: false })
  for (let y = Y75S + POLAR_STEP; y <= y1; y += POLAR_STEP) if (y >= y0) out.push({ y, axis: false })
  return out
}

/** The map's own rectangle on screen (seam to seam, pole to pole), in CSS pixels. */
export function worldRect(map: MlMap): { left: number; right: number; top: number; bottom: number } {
  const worldPx = TILE * 2 ** map.getZoom()
  const origin = map.project([0, 0])
  return {
    left: origin.x + (SEAM_WEST / 360) * worldPx,
    right: origin.x + (SEAM_EAST / 360) * worldPx,
    top: origin.y - worldPx / 2,
    bottom: origin.y + worldPx / 2,
  }
}

/** Draw the background and grid. `outsideOnly` limits it to what lies outside the map's rectangle. */
export function drawGrid(canvas: HTMLCanvasElement, map: MlMap, outsideOnly: boolean): void {
  const container = map.getContainer()
  const w = container.clientWidth
  const h = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const worldPx = TILE * 2 ** map.getZoom()
  const origin = map.project([0, 0]) // lng 0 on the equator
  ctx.save()
  if (outsideOnly) {
    const r = worldRect(map)
    if (r.left <= 0 && r.right >= w && r.top <= 0 && r.bottom >= h) {
      ctx.restore()
      return // the map covers the screen
    }
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top)
    ctx.clip('evenodd')
  }
  ctx.fillStyle = CANVAS
  ctx.fillRect(0, 0, w, h)

  const normal = new Path2D()
  const axis = new Path2D()
  const lngAt = (x: number) => ((x - origin.x) / worldPx) * 360
  for (let k = Math.ceil(lngAt(0) / STEP); k <= Math.floor(lngAt(w) / STEP); k++) {
    const x = origin.x + ((k * STEP) / 360) * worldPx
    const path = (k * STEP) % 360 === 0 ? axis : normal
    path.moveTo(x, 0)
    path.lineTo(x, h)
  }
  const yAt = (py: number) => 0.5 + (py - origin.y) / worldPx
  for (const p of parallelsBetween(yAt(0), yAt(h))) {
    const y = origin.y + (p.y - 0.5) * worldPx
    const path = p.axis ? axis : normal
    path.moveTo(0, y)
    path.lineTo(w, y)
  }
  ctx.lineWidth = 0.6
  ctx.strokeStyle = LINE
  ctx.stroke(normal)
  ctx.strokeStyle = AXIS
  ctx.stroke(axis)
  ctx.restore()
}
