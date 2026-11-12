/** Number and time formatting. Figures render in tabular mono numerals (.num) wherever they appear. */

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** Short form for legends and axes: 1.4M, 950K, 12.3, 0.052. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs >= 10_000) return compactFmt.format(value)
  if (abs >= 100) return Math.round(value).toLocaleString('en')
  if (abs >= 10) return trimZeros(value.toFixed(1))
  if (abs >= 1) return trimZeros(value.toFixed(2))
  if (abs === 0) return '0'
  return trimZeros(value.toPrecision(2))
}

/** Full form for tooltips and the detail panel: 1,397,800 · 72.4 · 0.0521. */
export function formatFull(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  if (abs >= 1000) return Math.round(value).toLocaleString('en')
  if (abs >= 100) return trimZeros(value.toFixed(1))
  if (abs >= 1) return trimZeros(value.toFixed(2))
  if (abs === 0) return '0'
  return trimZeros(value.toPrecision(3))
}

/** Value with its unit: "45.2% of population", "1,397,800 deaths", "$12,345 current US$ per person". */
export function formatWithUnit(value: number, unit: string, compact = false): { value: string; unit: string } {
  const num = compact ? formatCompact(value) : formatFull(value)
  const u = (unit || '').trim()
  if (u.startsWith('%')) return { value: `${num}%`, unit: u.slice(1).trim() }
  if (/^percent\b/i.test(u)) return { value: `${num}%`, unit: u.replace(/^percent\b/i, '').trim() }
  return { value: num, unit: u }
}

/** "1.2M – 3.4M" (an en dash between compact values). */
export function formatRange(min: number, max: number): string {
  if (min === max) return formatCompact(min)
  return `${formatCompact(min)} – ${formatCompact(max)}`
}

/** Human countdown to an ISO timestamp: "5h 12m", "12m 30s", "now". */
export function formatCountdown(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export const CONFIDENCE_LABEL: Record<string, string> = { h: 'High', m: 'Medium', l: 'Low' }
export const CONFIDENCE_HINT: Record<string, string> = {
  h: 'Well documented; sources agree',
  m: 'Reasonable estimate; sources differ somewhat',
  l: 'Rough estimate; treat with caution',
}
