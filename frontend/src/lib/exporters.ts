/** PNG (map + title + legend + disclaimer, composited) and CSV exports, generated in the browser. */
import type { Map as MlMap } from 'maplibre-gl'
import type { MapResult } from '../api/types'
import type { View } from '../state/store'
import { countryName } from './countries'
import { CONFIDENCE_LABEL, formatRange } from './format'
import { rampColors } from './palettes'

export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'terrachrome-map'
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Text cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheets don't run them as formulas. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildCsv(result: MapResult): string {
  const header = ['iso3', 'country', 'value', 'unit', 'time_scope', 'confidence', 'note', 'class', 'class_min', 'class_max']
  const lines = [header.join(',')]
  for (const [iso3, value, conf, note, bin] of result.rows) {
    const entry = bin != null ? result.legend[bin] : null
    lines.push([
      iso3, countryName(iso3), value, value != null ? result.meta.unit : '', value != null ? result.meta.time_scope : '',
      conf ? CONFIDENCE_LABEL[conf] : '', note ?? '', bin != null ? bin + 1 : '', entry?.min ?? '', entry?.max ?? '',
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export function exportCsv(result: MapResult): void {
  download(new Blob(['﻿' + buildCsv(result)], { type: 'text/csv;charset=utf-8' }), `${slugify(result.meta.title)}.csv`)
}

export async function exportPng(map: MlMap, result: MapResult, view: View): Promise<void> {
  map.triggerRepaint()
  await new Promise<void>((resolve) => map.once('render', () => resolve()))
  const src = map.getCanvas()
  const scale = src.width / Math.max(1, src.clientWidth)
  const W = src.width
  const header = 92 * scale
  const footer = 44 * scale
  const out = document.createElement('canvas')
  out.width = W
  out.height = src.height + header + footer
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  const px = (n: number) => n * scale
  const font = (weight: number, size: number, mono = false) =>
    `${weight} ${px(size)}px ${mono ? '"Geist Mono Variable", ui-monospace, monospace' : '"Geist Variable", system-ui, sans-serif'}`

  ctx.fillStyle = '#07070A'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, header)

  // Title block
  ctx.fillStyle = '#EDEDF3'
  ctx.font = font(600, 24)
  ctx.fillText(result.meta.title || result.query, px(28), px(42))
  ctx.fillStyle = '#A6A6B5'
  ctx.font = font(400, 14)
  ctx.fillText([result.meta.metric_label, result.meta.unit, result.meta.time_scope].filter(Boolean).join(' · '), px(28), px(68))

  // Legend, bottom-left over the map
  if (result.binning) {
    const colors = rampColors(view.palette, result.binning.classes, view.reverse)
    const entries = result.legend.map((e, i) => ({ ...e, color: colors[i] })).reverse()
    const rowH = px(20)
    const boxW = px(210)
    const boxH = px(16) + rowH * (entries.length + 1) + px(10)
    const x0 = px(20)
    const y0 = header + src.height - boxH - px(20)
    ctx.fillStyle = 'rgba(13,13,19,0.86)'
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = px(1)
    ctx.beginPath()
    ctx.roundRect(x0, y0, boxW, boxH, px(10))
    ctx.fill()
    ctx.stroke()
    ctx.font = font(400, 12, true)
    entries.forEach((e, i) => {
      const y = y0 + px(12) + i * rowH
      ctx.fillStyle = e.color
      ctx.beginPath()
      ctx.roundRect(x0 + px(12), y + px(3), px(20), px(12), px(3))
      ctx.fill()
      ctx.fillStyle = '#A6A6B5'
      ctx.fillText(formatRange(e.min, e.max), x0 + px(42), y + px(13))
      ctx.fillStyle = '#71717F'
      ctx.textAlign = 'right'
      ctx.fillText(String(e.count), x0 + boxW - px(12), y + px(13))
      ctx.textAlign = 'left'
    })
    const y = y0 + px(12) + entries.length * rowH
    ctx.fillStyle = '#3B3B47'
    ctx.fillRect(x0 + px(12), y + px(3), px(20), px(12))
    ctx.fillStyle = '#A6A6B5'
    ctx.fillText('No data', x0 + px(42), y + px(13))
    ctx.fillStyle = '#71717F'
    ctx.textAlign = 'right'
    ctx.fillText(String(result.stats?.na_count ?? 0), x0 + boxW - px(12), y + px(13))
    ctx.textAlign = 'left'
  }

  // Footer: provenance and disclaimer
  ctx.fillStyle = '#71717F'
  ctx.font = font(400, 12)
  const source = result.source.kind === 'worldbank' ? 'Data: World Bank WDI' : 'AI-generated estimates: verify before citing'
  ctx.fillText(`${source} · Boundaries: Natural Earth`, px(28), out.height - px(17))
  ctx.textAlign = 'right'
  ctx.fillText(`terrachrome · /m/${result.slug}`, out.width - px(28), out.height - px(17))

  const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the PNG')
  download(blob, `${slugify(result.meta.title)}.png`)
}
