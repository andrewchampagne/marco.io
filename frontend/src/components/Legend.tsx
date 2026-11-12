import { useState } from 'react'
import { formatRange } from '../lib/format'
import { ZERO_BIN, ZERO_COLOR, paletteGradient, rampColors } from '../lib/palettes'
import { store, useStore } from '../state/store'
import { useMediaQuery } from './primitives'

const METHOD_LABEL: Record<string, string> = { quantile: 'Quantile', equal: 'Equal interval', log: 'Log scale' }

/** Bottom-left legend: one row per class (range + country count), plus "No data". Hover or focus highlights. */
export function Legend() {
  const map = useStore((s) => s.map)
  const view = useStore((s) => s.view)
  const legendHover = useStore((s) => s.legendHover)
  const rebinning = useStore((s) => s.rebinning)
  const narrow = useMediaQuery('(max-width: 640px)')
  const [expanded, setExpanded] = useState(false)

  if (!map || map.status !== 'ok' || !map.binning || !map.stats) return null
  const { binning, legend, stats, meta } = map
  const colors = rampColors(view.palette, binning.classes, view.reverse)
  const entries = legend.map((e, i) => ({ ...e, index: i, color: colors[i] })).reverse() // high values on top
  const hover = (index: number | null) => store.set({ legendHover: index })
  const unit = meta.unit ? meta.unit : ''

  if (narrow && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="glass pointer-events-auto flex w-full flex-col gap-1.5 px-3 py-2.5 text-left"
        aria-label="Show legend"
      >
        <span className="truncate text-[12px] font-medium text-ink">{meta.metric_label || meta.title}</span>
        <span className="h-2 w-full rounded-full" style={{ background: paletteGradient(view.palette, view.reverse) }} />
        <span className="num flex justify-between text-[10.5px] text-ink-3">
          <span>{formatRange(legend[0]?.min ?? 0, legend[0]?.min ?? 0)}</span>
          <span>{formatRange(legend.at(-1)?.max ?? 0, legend.at(-1)?.max ?? 0)}</span>
        </span>
      </button>
    )
  }

  return (
    <section
      aria-label="Legend"
      className={`glass pointer-events-auto flex max-h-[min(52vh,440px)] w-[264px] flex-col overflow-hidden transition-opacity ${rebinning ? 'opacity-70' : ''}`}
    >
      <header className="border-b border-line px-3.5 pt-3 pb-2.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-[-0.01em] text-ink">{meta.metric_label || meta.title}</h2>
          {narrow && (
            <button type="button" className="icon-btn -mr-1.5 -mt-1 size-7" onClick={() => setExpanded(false)} aria-label="Collapse legend">
              ×
            </button>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
          {[unit, meta.time_scope].filter(Boolean).join(' · ')}
        </p>
      </header>
      <ul className="scrollbar-thin flex-1 overflow-y-auto px-1.5 py-1.5" onMouseLeave={() => hover(null)}>
        {entries.map((e) => (
          <li key={e.index}>
            <button
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left transition-colors ${legendHover === e.index ? 'bg-white/8' : 'hover:bg-white/5'}`}
              onMouseEnter={() => hover(e.index)}
              onFocus={() => hover(e.index)}
              onBlur={() => hover(null)}
              aria-label={`${formatRange(e.min, e.max)}: ${e.count} countries`}
            >
              <span className="h-3 w-5 shrink-0 rounded-[4px] ring-1 ring-black/40" style={{ background: e.color }} aria-hidden="true" />
              <span className="num flex-1 truncate text-[12px] text-ink-2">{formatRange(e.min, e.max)}</span>
              <span className="num text-[11.5px] text-ink-3">{e.count}</span>
            </button>
          </li>
        ))}
        {binning.zero_class && (
          <li className="mt-0.5 border-t border-line pt-1">
            <button
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left transition-colors ${legendHover === ZERO_BIN ? 'bg-white/8' : 'hover:bg-white/5'}`}
              onMouseEnter={() => hover(ZERO_BIN)}
              onFocus={() => hover(ZERO_BIN)}
              onBlur={() => hover(null)}
              aria-label={`Exactly zero: ${stats.zero_count ?? 0} countries`}
            >
              <span className="h-3 w-5 shrink-0 rounded-[4px] ring-1 ring-black/40" style={{ background: ZERO_COLOR }} aria-hidden="true" />
              <span className="num flex-1 text-[12px] text-ink-2">0</span>
              <span className="num text-[11.5px] text-ink-3">{stats.zero_count ?? 0}</span>
            </button>
          </li>
        )}
        <li className={binning.zero_class ? '' : 'mt-0.5 border-t border-line pt-1'}>
          <button
            type="button"
            className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left transition-colors ${legendHover === -1 ? 'bg-white/8' : 'hover:bg-white/5'}`}
            onMouseEnter={() => hover(-1)}
            onFocus={() => hover(-1)}
            onBlur={() => hover(null)}
            aria-label={`No data: ${stats.na_count} countries`}
          >
            <span className="hatch h-3 w-5 shrink-0 rounded-[4px] ring-1 ring-black/40" aria-hidden="true" />
            <span className="flex-1 text-[12px] text-ink-2">No data</span>
            <span className="num text-[11.5px] text-ink-3">{stats.na_count}</span>
          </button>
        </li>
      </ul>
      <footer className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2">
        <span className="label">{METHOD_LABEL[binning.method]} · {binning.classes} {binning.classes === 1 ? 'class' : 'classes'}</span>
        <span className="label">{stats.count} with data</span>
      </footer>
      {binning.fallback_reason && binning.fallback_reason !== 'unknown method' && (
        <p className="border-t border-line px-3.5 py-1.5 text-[11px] text-ink-3">{binning.fallback_reason}</p>
      )}
    </section>
  )
}
