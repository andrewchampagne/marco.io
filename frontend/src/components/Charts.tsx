/**
 * Charts panel: the top N countries plus "Rest of <region>", as a pie (summable values only) or as ranked
 * bars (any map). Data comes from lib/charts.ts; the colours are the dataviz reference categorical
 * palette for slices and one hue for bars (D-46).
 */
import { useMemo, useState } from 'react'
import { BAR_COLOR, REST_COLOR, SLICE_COLORS, TOP_DEFAULT, TOP_MAX, TOP_MIN, type ChartData, type ChartItem, topAndRest } from '../lib/charts'
import { formatWithUnit } from '../lib/format'
import { regionOf } from '../lib/regions'
import { flyToCountry } from '../state/actions'
import { store, useStore } from '../state/store'
import { IconClose } from './icons'
import { sideClass, useEscape } from './Panels'
import { Segmented, Stepper } from './primitives'

type ChartKind = 'pie' | 'bars'
const KINDS: { value: ChartKind; label: string }[] = [
  { value: 'pie', label: 'Pie' },
  { value: 'bars', label: 'Bars' },
]
const SURFACE = '#0E0E14' // the panel behind the marks: slice gaps are drawn in it

const pct = (share: number | null) => (share == null ? '' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`)

function colorFor(item: ChartItem, index: number): string {
  return item.rest ? REST_COLOR : SLICE_COLORS[index % SLICE_COLORS.length]
}

/** One row of a list: swatch (pie only), name (flies to the country), value and share. */
function ItemRow({ item, color, unit, active, onHover }: { item: ChartItem; color?: string; unit: string; active: boolean; onHover: (k: string | null) => void }) {
  const v = formatWithUnit(item.value, unit, true)
  const name = item.rest ? (
    <span className="truncate text-ink-3">{item.label}</span>
  ) : (
    <button type="button" className="truncate text-left text-ink-2 hover:text-ink" onClick={() => flyToCountry(item.key, false)}>
      {item.label}
    </button>
  )
  return (
    <li
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors ${active ? 'bg-white/8' : ''}`}
      onMouseEnter={() => onHover(item.key)}
      onMouseLeave={() => onHover(null)}
    >
      {color && <span className="h-2.5 w-3.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden="true" />}
      <span className="flex min-w-0 flex-1">{name}</span>
      <span className="num shrink-0 text-ink">{v.value}</span>
      {item.share != null && <span className="num w-11 shrink-0 text-right text-ink-3">{pct(item.share)}</span>}
    </li>
  )
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${cx} ${cy}L${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}Z`
}

function Pie({ data, unit, active, onHover }: { data: ChartData; unit: string; active: string | null; onHover: (k: string | null) => void }) {
  const all = data.rest ? [...data.items, data.rest] : data.items
  const total = all.reduce((s, i) => s + i.value, 0)
  const C = 100
  const R = 92
  let angle = -Math.PI / 2
  const slices = all.map((item, i) => {
    const sweep = total > 0 ? (item.value / total) * Math.PI * 2 : 0
    const a0 = angle
    angle += sweep
    return { item, color: colorFor(item, i), a0, a1: angle, sweep }
  })
  const focus = all.find((i) => i.key === active) ?? null
  return (
    <div>
      <div className="flex justify-center py-2">
        <svg viewBox="0 0 200 200" className="size-[200px]" role="img" aria-label={`Pie chart: ${all.map((i) => `${i.label} ${pct(i.share)}`).join(', ')}`}>
          {slices.map(({ item, color, a0, a1, sweep }) =>
            sweep >= Math.PI * 2 - 1e-9 ? (
              <circle key={item.key} cx={C} cy={C} r={R} fill={color} />
            ) : sweep > 0 ? (
              <path
                key={item.key}
                d={arcPath(C, C, R, a0, a1)}
                fill={color}
                stroke={SURFACE}
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={active && active !== item.key ? 0.4 : 1}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => onHover(item.key)}
                onMouseLeave={() => onHover(null)}
                onClick={() => !item.rest && flyToCountry(item.key, false)}
              >
                <title>{`${item.label}: ${formatWithUnit(item.value, unit, true).value} (${pct(item.share)})`}</title>
              </path>
            ) : null,
          )}
        </svg>
      </div>
      <p className="h-5 text-center text-[12.5px] text-ink-2" aria-live="polite">
        {focus ? (
          <>
            <span className="text-ink">{focus.label}</span> · <span className="num">{formatWithUnit(focus.value, unit, true).value}</span>
            {focus.share != null && <span className="num text-ink-3"> · {pct(focus.share)}</span>}
          </>
        ) : (
          <span className="text-ink-3">Total {formatWithUnit(total, unit, true).value}</span>
        )}
      </p>
      <ul className="mt-2 space-y-0.5">
        {slices.map(({ item, color }) => (
          <ItemRow key={item.key} item={item} color={color} unit={unit} active={active === item.key} onHover={onHover} />
        ))}
      </ul>
    </div>
  )
}

function Bars({ data, unit, active, onHover }: { data: ChartData; unit: string; active: string | null; onHover: (k: string | null) => void }) {
  const all = data.rest ? [...data.items, data.rest] : data.items
  const lo = Math.min(0, ...all.map((i) => i.value))
  const hi = Math.max(0, ...all.map((i) => i.value))
  const span = hi - lo || 1
  const zero = ((0 - lo) / span) * 100
  return (
    <ul className="space-y-1.5 py-1" role="list">
      {all.map((item) => {
        const left = item.value >= 0 ? zero : ((item.value - lo) / span) * 100
        const width = (Math.abs(item.value) / span) * 100
        const v = formatWithUnit(item.value, unit, true)
        return (
          <li
            key={item.key}
            className={`rounded-lg px-2 py-1.5 transition-colors ${active === item.key ? 'bg-white/8' : ''}`}
            onMouseEnter={() => onHover(item.key)}
            onMouseLeave={() => onHover(null)}
            title={`${item.label}: ${v.value}${item.share != null ? ` (${pct(item.share)})` : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              {item.rest ? (
                <span className="truncate text-ink-3">{item.label}</span>
              ) : (
                <button type="button" className="truncate text-left text-ink-2 hover:text-ink" onClick={() => flyToCountry(item.key, false)}>
                  {item.label}
                </button>
              )}
              <span className="num shrink-0 text-ink">
                {v.value}
                {item.share != null && <span className="text-ink-3"> · {pct(item.share)}</span>}
              </span>
            </div>
            <div className="relative mt-1 h-2.5" aria-hidden="true">
              {lo < 0 && <span className="absolute inset-y-[-2px] w-px bg-line-2" style={{ left: `${zero}%` }} />}
              <span
                className={`absolute inset-y-0 ${item.value >= 0 ? 'rounded-r-[4px]' : 'rounded-l-[4px]'}`}
                style={{ left: `${left}%`, width: `max(${width}%, 2px)`, background: item.rest ? REST_COLOR : BAR_COLOR }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function ChartsPanel() {
  const open = useStore((s) => s.chartsOpen)
  const map = useStore((s) => s.map)
  const [kind, setKind] = useState<ChartKind>('pie')
  const [top, setTop] = useState(TOP_DEFAULT)
  const [active, setActive] = useState<string | null>(null)
  const close = () => store.set({ chartsOpen: false })
  useEscape(open, close)
  const data = useMemo(() => (map?.status === 'ok' ? topAndRest(map, top) : null), [map, top])
  if (!open || !map || map.status !== 'ok' || !data) return null
  const unit = map.meta.unit
  const showPie = kind === 'pie' && !data.pieBlocked
  const regionName = regionOf(map.region).label
  return (
    <aside className={sideClass()} aria-label="Charts">
      <header className="border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="label">Top {top} and the rest · {regionName}</p>
            <h2 className="mt-0.5 truncate text-[14px] font-semibold text-ink">{map.meta.title}</h2>
          </div>
          <button type="button" className="icon-btn -mr-1.5" onClick={close} aria-label="Close charts">
            <IconClose />
          </button>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <Segmented<ChartKind> value={kind} options={KINDS} onChange={setKind} label="Chart type" size="sm" />
          <Stepper value={top} min={TOP_MIN} max={TOP_MAX} onChange={setTop} label="Countries" />
        </div>
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3">
        {data.items.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-ink-3">No countries have a value on this map.</p>
        ) : (
          <>
            {kind === 'pie' && data.pieBlocked && (
              <p className="mx-1 mb-3 rounded-xl border border-line bg-white/[0.03] p-3 text-[12.5px] leading-relaxed text-ink-3">{data.pieBlocked}</p>
            )}
            {showPie ? <Pie data={data} unit={unit} active={active} onHover={setActive} /> : <Bars data={data} unit={unit} active={active} onHover={setActive} />}
          </>
        )}
      </div>
      <footer className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
        {data.rest
          ? `${data.rest.label} covers ${data.restCount} more ${data.restCount === 1 ? 'country' : 'countries'}${data.summable ? ' (their total)' : ''}.`
          : 'Every country with data is shown.'}
      </footer>
    </aside>
  )
}
