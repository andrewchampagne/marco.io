import { useMemo } from 'react'
import type { MapRow } from '../api/types'
import { countryName } from '../lib/countries'
import { CONFIDENCE_LABEL, formatWithUnit } from '../lib/format'
import { inRegion, regionOf } from '../lib/regions'
import { useStore } from '../state/store'

/** Two levels on screen: high (green, both bars) and a yellow warning for medium or low (one bar). */
export function ConfidenceBadge({ level }: { level: string | null }) {
  if (!level) return null
  const high = level === 'h'
  const tone = high ? 'text-ok border-ok/30 bg-ok/10' : 'text-warn border-warn/30 bg-warn/10'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium ${tone}`}>
      <span className="flex gap-[2px]" aria-hidden="true">
        {[0, 1].map((i) => (
          <span key={i} className={`h-[7px] w-[3px] rounded-full ${i < (high ? 2 : 1) ? 'bg-current' : 'bg-current/25'}`} />
        ))}
      </span>
      {CONFIDENCE_LABEL[level]}
    </span>
  )
}

/** Follows the pointer over the map. Value leads; the country name and unit are secondary. */
export function Tooltip() {
  const hover = useStore((s) => s.hover)
  const map = useStore((s) => s.map)
  const selected = useStore((s) => s.selected)
  const byIso = useMemo(() => new Map<string, MapRow>((map?.rows ?? []).map((r) => [r[0], r])), [map])
  if (!hover) return null
  // Touch screens can't hover (a tap is a selection), and on phones the detail sheet already shows the value.
  if (window.matchMedia('(hover: none)').matches || (selected && window.innerWidth <= 640)) return null
  const row = byIso.get(hover.iso3)
  const hasMap = map?.status === 'ok'
  const W = 260
  const left = hover.x + 18 + W > window.innerWidth ? hover.x - W - 14 : hover.x + 18
  const top = Math.min(hover.y + 18, window.innerHeight - 150)
  const formatted = row && row[1] != null && hasMap ? formatWithUnit(row[1], map!.meta.unit) : null

  return (
    <div
      className="glass pointer-events-none fixed z-40 w-max max-w-[260px] px-3 py-2.5"
      style={{ left, top, borderRadius: 12 }}
      aria-hidden="true"
    >
      <div className="text-[12px] font-medium text-ink-2">{countryName(hover.iso3)}</div>
      {hasMap && formatted ? (
        <>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="num text-[19px] font-medium leading-tight text-ink">{formatted.value}</span>
            {formatted.unit && <span className="text-[11.5px] text-ink-3">{formatted.unit}</span>}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <ConfidenceBadge level={row![2]} />
          </div>
          {row![3] && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-ink-3">{row![3]}</p>}
        </>
      ) : hasMap && !inRegion(map!.region, hover.iso3) ? (
        <div className="mt-0.5 text-[12.5px] text-ink-3">Outside this map ({regionOf(map!.region).label})</div>
      ) : hasMap ? (
        <div className="mt-0.5 text-[13px] text-ink-3">No data</div>
      ) : null}
    </div>
  )
}
