import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapRow } from '../api/types'
import { COUNTRY_BY_ISO3, countryName } from '../lib/countries'
import { CONFIDENCE_HINT, formatCompact, formatRange, formatWithUnit } from '../lib/format'
import { ZERO_BIN, binColor, rampColors } from '../lib/palettes'
import { WORLD, inRegion, regionOf } from '../lib/regions'
import { clearHistory, flyToCountry, openMap, selectCountry, toast } from '../state/actions'
import { store, useStore } from '../state/store'
import { IconClose, IconCrosshair, IconGlobe, IconTrash } from './icons'
import { ConfidenceBadge } from './Tooltip'

export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}

export function sideClass() {
  return 'glass-strong pointer-events-auto absolute z-20 flex flex-col overflow-hidden right-3 top-[72px] bottom-[68px] w-[360px] min-[641px]:max-[1100px]:top-[124px] max-[640px]:top-auto max-[640px]:left-2 max-[640px]:right-2 max-[640px]:bottom-2 max-[640px]:w-auto max-[640px]:max-h-[62vh] animate-[slide-in-right_240ms_var(--ease-out-expo)] max-[640px]:animate-[slide-up_240ms_var(--ease-out-expo)]'
}

/** Right-side detail panel for the clicked country. */
export function DetailPanel() {
  const selected = useStore((s) => s.selected)
  const map = useStore((s) => s.map)
  const view = useStore((s) => s.view)
  const close = () => selectCountry(null)
  useEscape(!!selected, close)
  const ranked = useMemo(
    () => (map?.rows ?? []).filter((r) => r[1] != null).sort((a, b) => (b[1] as number) - (a[1] as number)),
    [map],
  )
  if (!selected || !map || map.status !== 'ok' || !map.binning) return null
  const row = map.rows.find((r) => r[0] === selected)
  const country = COUNTRY_BY_ISO3[selected]
  const colors = rampColors(view.palette, map.binning.classes, view.reverse)
  const hasValue = row && row[1] != null
  const rank = hasValue ? ranked.findIndex((r) => r[0] === selected) + 1 : 0
  const pct = hasValue && ranked.length > 1 ? Math.round(((ranked.length - rank) / (ranked.length - 1)) * 100) : null
  const bin = row?.[4] ?? null
  const legendEntry = bin != null && bin !== ZERO_BIN ? map.legend[bin] : null
  const formatted = hasValue ? formatWithUnit(row![1] as number, map.meta.unit) : null
  const subtitle = [country?.subregion, country?.sovereign ? `Territory of ${countryName(country.sovereign)}` : null].filter(Boolean).join(' · ')

  return (
    <aside className={sideClass()} aria-label={`${country?.name ?? selected} details`}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3.5">
        <div className="min-w-0">
          <p className="label">{map.meta.title}</p>
          <h2 className="mt-1 truncate text-[20px] font-semibold tracking-[-0.02em] text-ink">{country?.name ?? selected}</h2>
          {subtitle && <p className="mt-0.5 truncate text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        <button type="button" className="icon-btn -mr-2 shrink-0" onClick={close} aria-label="Close details">
          <IconClose />
        </button>
      </header>
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {formatted ? (
          <section>
            <div className="flex items-baseline gap-2">
              <span className="num text-[34px] font-medium leading-none tracking-[-0.02em] text-ink">{formatted.value}</span>
            </div>
            {formatted.unit && <p className="mt-1.5 text-[13px] text-ink-2">{formatted.unit}</p>}
            <p className="mt-0.5 text-[12px] text-ink-3">{map.meta.time_scope}</p>
          </section>
        ) : (
          <section className="rounded-xl border border-line bg-white/[0.03] p-4">
            {inRegion(map.region, selected) ? (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="hatch h-4 w-6 rounded" aria-hidden="true" />
                  <span className="text-[14px] font-medium text-ink">No data</span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
                  The AI couldn't find or reasonably estimate a value for this country.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <IconGlobe size={16} className="text-ink-3" />
                  <span className="text-[14px] font-medium text-ink">Outside this map</span>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
                  This map covers {regionOf(map.region).label} only. Switch the region to the whole world and ask again to include it.
                </p>
              </>
            )}
          </section>
        )}

        {hasValue && (
          <section className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-line bg-white/[0.03] p-3">
              <p className="label">Rank</p>
              <p className="num mt-1 text-[17px] text-ink">
                {rank}<span className="text-ink-3"> / {ranked.length}</span>
              </p>
              {pct !== null && <p className="mt-0.5 text-[11.5px] text-ink-3">higher than {pct}%</p>}
            </div>
            <div className="rounded-xl border border-line bg-white/[0.03] p-3">
              <p className="label">Class</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-3.5 w-5 rounded-[4px] ring-1 ring-black/40" style={{ background: binColor(bin, colors) }} aria-hidden="true" />
                <span className="num text-[13px] text-ink">{bin === ZERO_BIN ? 'Zero' : bin != null ? `${bin + 1} of ${map.binning.classes}` : '–'}</span>
              </div>
              {legendEntry && <p className="num mt-1 text-[11.5px] text-ink-3">{formatRange(legendEntry.min, legendEntry.max)}</p>}
            </div>
          </section>
        )}

        {hasValue && pct !== null && (
          <section aria-label="Position among countries with data">
            <div className="relative h-2 rounded-full bg-white/8">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-white/10 to-white/40" style={{ width: `${pct}%` }} />
              <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-accent" style={{ left: `${pct}%` }} />
            </div>
            <div className="num mt-1.5 flex justify-between text-[10.5px] text-ink-3">
              <span>{formatCompact(map.stats?.min ?? 0)}</span>
              <span>median {formatCompact(map.stats?.median ?? 0)}</span>
              <span>{formatCompact(map.stats?.max ?? 0)}</span>
            </div>
          </section>
        )}

        {hasValue && (
          <section>
            <ConfidenceBadge level={row![2]} />
            <p className="mt-1.5 text-[12px] text-ink-3">{CONFIDENCE_HINT[row![2] ?? 'l']}</p>
            {row![3] && <p className="mt-3 rounded-xl border border-line bg-white/[0.03] p-3 text-[13px] leading-relaxed text-ink-2">{row![3]}</p>}
          </section>
        )}

        {map.meta.caveats.length > 0 && (
          <section>
            <p className="label">About this map</p>
            <ul className="mt-2 space-y-1.5">
              {map.meta.caveats.map((c) => (
                <li key={c} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-3">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="flex gap-2 border-t border-line px-5 py-3">
        <button type="button" className="btn btn-ghost h-9 flex-1" onClick={() => flyToCountry(selected)}>
          <IconCrosshair size={16} /> Fly to
        </button>
        {formatted && (
          <button
            type="button"
            className="btn btn-ghost h-9 flex-1"
            onClick={() => {
              void navigator.clipboard?.writeText(`${country?.name}: ${formatted.value}${formatted.unit ? ` ${formatted.unit}` : ''} (${map.meta.time_scope})`)
              toast({ tone: 'success', title: 'Copied' }, 1800)
            }}
          >
            Copy value
          </button>
        )}
      </footer>
    </aside>
  )
}

/** Ranked table of every country with data: the keyboard and screen-reader way to read the map. */
export function DataTable() {
  const open = useStore((s) => s.tableOpen)
  const map = useStore((s) => s.map)
  const view = useStore((s) => s.view)
  const [filter, setFilter] = useState('')
  const close = () => store.set({ tableOpen: false })
  useEscape(open, close)
  const rows = useMemo(() => {
    const data = (map?.rows ?? []).filter((r) => r[1] != null) as MapRow[]
    return data.sort((a, b) => (b[1] as number) - (a[1] as number))
  }, [map])
  if (!open || !map || map.status !== 'ok' || !map.binning) return null
  const colors = rampColors(view.palette, map.binning.classes, view.reverse)
  const q = filter.trim().toLowerCase()
  const visible = rows.map((r, i) => ({ r, rank: i + 1 })).filter(({ r }) => !q || countryName(r[0]).toLowerCase().includes(q) || r[0].toLowerCase() === q)
  return (
    <aside className={sideClass()} aria-label="Data table">
      <header className="border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="label">Data table</p>
            <h2 className="mt-0.5 truncate text-[14px] font-semibold text-ink">{map.meta.title}</h2>
          </div>
          <button type="button" className="icon-btn -mr-1.5" onClick={close} aria-label="Close table">
            <IconClose />
          </button>
        </div>
        <input className="field mt-2.5 h-9 text-[13px]" placeholder="Filter countries" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter countries" />
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead className="sticky top-0 bg-[#0e0e14]/95 text-ink-3 backdrop-blur">
            <tr>
              <th scope="col" className="w-10 py-2 pl-4 font-medium">#</th>
              <th scope="col" className="py-2 font-medium">Country</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">{map.meta.unit || 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ r, rank }) => (
              <tr key={r[0]} className="border-t border-line/60 hover:bg-white/5">
                <td className="num py-1.5 pl-4 text-ink-3">{rank}</td>
                <td className="py-1.5">
                  <button type="button" className="flex items-center gap-2 text-left text-ink-2 hover:text-ink" onClick={() => flyToCountry(r[0])}>
                    <span className="h-2.5 w-3.5 shrink-0 rounded-[3px]" style={{ background: binColor(r[4], colors) }} aria-hidden="true" />
                    {countryName(r[0])}
                  </button>
                </td>
                <td className="num py-1.5 pr-4 text-right text-ink">{formatWithUnit(r[1] as number, map.meta.unit).value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">No matching countries.</p>}
      </div>
      <footer className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
        {rows.length} countries with data · {map.stats?.na_count ?? 0} without
      </footer>
    </aside>
  )
}

function relativeTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Left drawer listing past questions (server-side history for this browser). */
export function HistoryDrawer() {
  const open = useStore((s) => s.historyOpen)
  const items = useStore((s) => s.history)
  const current = useStore((s) => s.map?.slug)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => store.set({ historyOpen: false })
  useEscape(open, close)
  if (!open) return null
  return (
    <aside ref={ref} className="glass pointer-events-auto absolute left-3 top-[72px] z-30 flex max-h-[calc(100vh-160px)] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden animate-[pop_180ms_var(--ease-out-expo)]" aria-label="History">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">History</h2>
          <p className="text-[11.5px] text-ink-3">Saved for this browser</p>
        </div>
        <button type="button" className="icon-btn -mr-1.5" onClick={close} aria-label="Close history">
          <IconClose />
        </button>
      </header>
      <ul className="scrollbar-thin flex-1 overflow-y-auto p-1.5">
        {items === null && <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">Loading…</li>}
        {items?.length === 0 && (
          <li className="px-3 py-8 text-center">
            <p className="text-[13px] text-ink-2">No maps yet</p>
            <p className="mt-1 text-[12px] text-ink-3">Questions you ask will show up here.</p>
          </li>
        )}
        {items?.map((item, i) => (
          <li key={`${item.slug}-${i}`}>
            <button
              type="button"
              onClick={() => {
                close()
                if (item.status === 'ok') void openMap(item.slug)
                else store.set({ draft: item.query })
              }}
              className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/6 ${current === item.slug ? 'bg-white/6' : ''}`}
            >
              <span className="flex items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${item.status === 'ok' ? 'bg-accent' : 'bg-ink-3'}`} aria-hidden="true" />
                <span className="truncate text-[13px] font-medium text-ink">{item.status === 'ok' ? item.title : 'Not mappable'}</span>
              </span>
              <span className="flex justify-between gap-3 pl-3.5 text-[11.5px] text-ink-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  {item.region && item.region !== WORLD && (
                    <span className="shrink-0 rounded-[5px] border border-accent/25 bg-accent/[0.07] px-1.5 text-[10.5px] leading-[16px] text-accent">
                      {regionOf(item.region).short}
                    </span>
                  )}
                  <span className="truncate">{item.query}</span>
                </span>
                <span className="shrink-0">{relativeTime(item.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!!items?.length && (
        <footer className="border-t border-line p-2">
          <button type="button" className="btn btn-ghost h-8 w-full text-[12.5px]" onClick={() => void clearHistory()}>
            <IconTrash size={15} /> Clear history
          </button>
        </footer>
      )}
    </aside>
  )
}
