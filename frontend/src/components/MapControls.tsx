import { useMemo, useRef, useState } from 'react'
import type { Method } from '../api/types'
import { searchCountries } from '../lib/countries'
import { exportCsv, exportPng } from '../lib/exporters'
import { formatUsd } from '../lib/format'
import { PALETTES, paletteGradient } from '../lib/palettes'
import { getMap, resetView } from '../map/MapView'
import { changeBins, flyToCountry, setPalette, toast, toggleReverse } from '../state/actions'
import { store, useStore } from '../state/store'
import {
  IconCheck, IconDownload, IconExternal, IconHome, IconInfo, IconLink, IconMinus, IconPalette, IconPlus,
  IconSearch, IconShare, IconSliders, IconSwap, IconTable,
} from './icons'
import { Popover, Segmented, Stepper, useMediaQuery } from './primitives'

const METHODS: { value: Method; label: string; title: string }[] = [
  { value: 'quantile', label: 'Quantile', title: 'Equal number of countries per class' },
  { value: 'equal', label: 'Equal', title: 'Equal-width value ranges' },
  { value: 'log', label: 'Log', title: 'Logarithmic ranges, for values spanning orders of magnitude' },
]

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-line-2" aria-hidden="true" />
}

function PalettePicker() {
  const view = useStore((s) => s.view)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div className="relative">
      <button ref={ref} type="button" className="icon-btn w-auto gap-2 px-2" aria-expanded={open} aria-label="Palette" title="Palette" onClick={() => setOpen((o) => !o)}>
        <IconPalette size={17} />
        <span className="h-2.5 w-9 rounded-full ring-1 ring-black/40" style={{ background: paletteGradient(view.palette, view.reverse) }} aria-hidden="true" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Choose a palette" className="bottom-full right-0 mb-2 w-[272px] p-1.5">
        <ul role="listbox" aria-label="Palettes">
          {PALETTES.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={view.palette === p.id}
                onClick={() => setPalette(p.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${view.palette === p.id ? 'bg-white/8' : 'hover:bg-white/5'}`}
              >
                <span className="h-3 w-16 shrink-0 rounded-full ring-1 ring-black/40" style={{ background: paletteGradient(p.id, view.reverse) }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{p.hint}</span>
                </span>
                {view.palette === p.id && <IconCheck size={15} className="text-accent" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-center justify-between border-t border-line px-2.5 pt-2 pb-1">
          <span className="text-[12px] text-ink-2">Reverse direction</span>
          <button type="button" className="icon-btn size-8" aria-pressed={view.reverse} onClick={toggleReverse} aria-label="Reverse palette">
            <IconSwap size={16} />
          </button>
        </div>
      </Popover>
    </div>
  )
}

function BinControls({ stacked = false }: { stacked?: boolean }) {
  const view = useStore((s) => s.view)
  return (
    <div className={`flex items-center gap-1.5 ${stacked ? 'flex-col items-stretch gap-3' : ''}`}>
      {stacked && <span className="label">Classes</span>}
      <Stepper value={view.classes} min={3} max={9} onChange={(v) => void changeBins(view.method, v)} label="Classes" />
      {stacked && <span className="label">Binning</span>}
      <Segmented<Method> value={view.method} options={METHODS} onChange={(m) => void changeBins(m, view.classes)} label="Binning method" size="sm" />
    </div>
  )
}

function OptionsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const view = useStore((s) => s.view)
  return (
    <div className="relative">
      <button ref={ref} type="button" className="icon-btn" aria-expanded={open} aria-label="Map options" onClick={() => setOpen((o) => !o)}>
        <IconSliders />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Map options" className="bottom-full right-0 mb-2 w-[280px] space-y-3 p-3">
        <span className="label">Palette</span>
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" onClick={() => setPalette(p.id)} aria-pressed={view.palette === p.id}
              className={`flex flex-col gap-1 rounded-lg border px-2 py-1.5 text-left ${view.palette === p.id ? 'border-accent/60 bg-white/8' : 'border-line'}`}>
              <span className="h-2 w-full rounded-full" style={{ background: paletteGradient(p.id, view.reverse) }} />
              <span className="truncate text-[11px] text-ink-2">{p.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost h-8 w-full text-[12.5px]" aria-pressed={view.reverse} onClick={toggleReverse}>
          <IconSwap size={15} /> {view.reverse ? 'Reversed' : 'Reverse direction'}
        </button>
        <BinControls stacked />
      </Popover>
    </div>
  )
}

function InfoPopover() {
  const map = useStore((s) => s.map)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  if (!map) return null
  const src = map.source
  const sources = src.info?.sources ?? []
  const isWb = src.kind === 'worldbank'
  return (
    <div className="relative">
      <button ref={ref} type="button" className="icon-btn" aria-expanded={open} aria-label="About this map" title="About this map" onClick={() => setOpen((o) => !o)}>
        <IconInfo />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="About this map" className="bottom-full right-0 mb-2 w-[340px] max-w-[calc(100vw-24px)] p-4">
        <div className={`rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed ${isWb ? 'border-ok/25 bg-ok/8 text-ink-2' : 'border-warn/30 bg-warn/8 text-ink-2'}`}>
          {isWb ? (
            <><strong className="font-semibold text-ink">Official statistics</strong> from the World Bank's World Development Indicators, latest year per country.</>
          ) : (
            <><strong className="font-semibold text-ink">AI-generated estimates, verify before citing.</strong> Values come from a language model's knowledge{src.kind === 'llm+web' ? ' and a quick web search' : ''}, not from an official dataset.</>
          )}
        </div>
        {src.mock && <p className="mt-2 rounded-md border border-accent/25 bg-accent/8 px-2.5 py-1.5 text-[11.5px] text-accent-2">Mock mode: fixture data for development.</p>}
        {map.meta.caveats.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {map.meta.caveats.map((c) => (
              <li key={c} className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        )}
        {sources.length > 0 && (
          <div className="mt-3">
            <p className="label">Web sources consulted</p>
            <ul className="mt-1.5 space-y-1">
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 truncate text-[12px] text-accent hover:underline">
                    <IconExternal size={13} /> <span className="truncate">{s.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 text-[11.5px]">
          <dt className="text-ink-3">Source</dt>
          <dd className="truncate text-ink-2">
            {isWb ? (
              <a href={src.info?.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">World Bank · {src.info?.indicator}</a>
            ) : (
              <>{src.model}{src.kind === 'llm+web' ? ' + web search' : ''}</>
            )}
          </dd>
          {!isWb && (
            <>
              <dt className="text-ink-3">Generation</dt>
              <dd className="num text-ink-2">{map.generation.tokens_out.toLocaleString('en')} output tokens · {formatUsd(map.generation.cost_usd)}</dd>
              {src.info?.gap_fill && (
                <>
                  <dt className="text-ink-3">Gap check</dt>
                  <dd className="text-ink-2">
                    {src.info.gap_fill.added} of {src.info.gap_fill.asked} missing countries added
                  </dd>
                </>
              )}
            </>
          )}
          <dt className="text-ink-3">This view</dt>
          <dd className="text-ink-2">{map.request.cached ? 'Served from cache · 0 tokens' : 'Freshly generated'}</dd>
        </dl>
      </Popover>
    </div>
  )
}

function ShareMenu() {
  const map = useStore((s) => s.map)
  const view = useStore((s) => s.view)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  if (!map || map.status !== 'ok') return null
  const link = `${location.origin}/m/${map.slug}`
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-white/6 hover:text-ink'
  return (
    <div className="relative">
      <button ref={ref} type="button" className="icon-btn" aria-expanded={open} aria-label="Share or export" title="Share or export" onClick={() => setOpen((o) => !o)}>
        <IconShare />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Share or export" className="bottom-full right-0 mb-2 w-[230px] p-1.5">
        <button type="button" className={item} onClick={async () => {
          try {
            await navigator.clipboard.writeText(link)
            toast({ tone: 'success', title: 'Link copied', body: link }, 2600)
          } catch {
            toast({ tone: 'info', title: 'Copy this link', body: link }, 8000)
          }
          setOpen(false)
        }}>
          <IconLink size={16} /> Copy share link
        </button>
        <button type="button" className={item} onClick={async () => {
          setOpen(false)
          const m = getMap()
          if (!m) return
          try {
            await exportPng(m, map, view)
          } catch (err) {
            toast({ tone: 'error', title: "Couldn't export the PNG", body: (err as Error).message })
          }
        }}>
          <IconDownload size={16} /> Download PNG
        </button>
        <button type="button" className={item} onClick={() => { exportCsv(map); setOpen(false) }}>
          <IconTable size={16} /> Download CSV
        </button>
      </Popover>
    </div>
  )
}

function CountrySearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchCountries(q, 7), [q])
  const inputRef = useRef<HTMLInputElement>(null)
  const pick = (iso3: string) => {
    flyToCountry(iso3, store.get().map?.status === 'ok')
    setOpen(false)
    setQ('')
  }
  if (!open) {
    return (
      <button type="button" className="icon-btn" aria-label="Find a country" title="Find a country" onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }}>
        <IconSearch />
      </button>
    )
  }
  return (
    <div className="relative flex items-center">
      <IconSearch size={16} className="pointer-events-none absolute left-2.5 text-ink-3" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0) }}
        onBlur={() => setTimeout(() => { setOpen(false); setQ('') }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQ('') }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && results[active]) pick(results[active].iso3)
        }}
        placeholder="Find a country"
        aria-label="Find a country"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="country-results"
        aria-activedescendant={results[active] ? `country-${results[active].iso3}` : undefined}
        className="h-[34px] w-48 rounded-[10px] border border-line-2 bg-black/40 pl-8 pr-2 text-[13px] text-ink outline-none focus:border-accent/60"
      />
      {results.length > 0 && (
        <ul id="country-results" role="listbox" className="glass absolute bottom-full right-0 mb-2 w-56 p-1">
          {results.map((c, i) => (
            <li key={c.iso3} id={`country-${c.iso3}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c.iso3)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] ${i === active ? 'bg-white/8 text-ink' : 'text-ink-2 hover:bg-white/5'}`}>
                <span className="truncate">{c.name}</span>
                <span className="num text-[10.5px] text-ink-3">{c.iso3}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ZoomControls() {
  const zoom = (delta: number) => {
    const m = getMap()
    if (m) m.easeTo({ zoom: m.getZoom() + delta, duration: 250 })
  }
  return (
    <div className="glass flex flex-col p-1" role="group" aria-label="Zoom">
      <button type="button" className="icon-btn size-8" onClick={() => zoom(1)} aria-label="Zoom in"><IconPlus size={16} /></button>
      <button type="button" className="icon-btn size-8" onClick={() => zoom(-1)} aria-label="Zoom out"><IconMinus size={16} /></button>
      <button type="button" className="icon-btn size-8" onClick={resetView} aria-label="Reset view" title="Reset view"><IconHome size={15} /></button>
    </div>
  )
}

export function MapControls() {
  const map = useStore((s) => s.map)
  const tableOpen = useStore((s) => s.tableOpen)
  const panelOpen = useStore((s) => s.selected !== null || s.tableOpen)
  const narrow = useMediaQuery('(max-width: 900px)')
  const hasData = map?.status === 'ok' && !!map.binning
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      {!panelOpen && <div className="max-[640px]:hidden"><ZoomControls /></div>}
      <div className="glass flex h-11 items-center gap-0.5 px-1.5" role="toolbar" aria-label="Map controls">
        <CountrySearch />
        {hasData && (
          <>
            <Divider />
            {narrow ? <OptionsMenu /> : (<><PalettePicker /><Divider /><BinControls /></>)}
            <Divider />
            <button type="button" className="icon-btn" aria-pressed={tableOpen} aria-label="Data table" title="Data table" onClick={() => store.set({ tableOpen: !tableOpen, selected: null, historyOpen: false })}>
              <IconTable />
            </button>
            <InfoPopover />
            <ShareMenu />
          </>
        )}
      </div>
    </div>
  )
}
