import { useMemo } from 'react'
import { COUNTRY_BY_ISO3 } from '../lib/countries'
import { REGIONS, WORLD, type Region, type RegionGroup } from '../lib/regions'
import { THUMB_H, THUMB_W, useThumbPaths } from '../lib/regionThumbs'
import { closeRegionPicker, setFocus } from '../state/actions'
import { useStore } from '../state/store'
import { IconCheck } from './icons'
import { Modal } from './primitives'

const GROUPS: { id: RegionGroup; title: string; description: string; grid: string }[] = [
  {
    id: 'continent',
    title: 'Continents',
    description: 'Russia counts in both Europe and Asia; Turkey, Cyprus and the Caucasus too.',
    grid: 'grid-cols-3 max-[600px]:grid-cols-2',
  },
  {
    id: 'hemisphere',
    title: 'Hemispheres',
    description: 'Split at the equator or the prime meridian. Countries that straddle the line are in both halves.',
    grid: 'grid-cols-4 max-[600px]:grid-cols-2',
  },
]

/** Sovereign countries in a region (territories are mapped too, but "countries" reads truest without them). */
function countryCount(region: Region): number {
  return region.members.filter((iso) => !COUNTRY_BY_ISO3[iso]?.sovereign).length
}

function Thumb({ region, paths }: { region: Region; paths: Map<string, string> | null }) {
  const layers = useMemo(() => {
    if (!paths) return null
    const members = new Set(region.members)
    let rest = ''
    let inside = ''
    for (const [iso, d] of paths) {
      if (region.id === WORLD || members.has(iso)) inside += d
      else rest += d
    }
    return { rest, inside }
  }, [paths, region])
  const divider = { northern: 'h', southern: 'h', eastern: 'v', western: 'v' }[region.id]
  const equatorY = 84 // latitude 0 in the thumbnail's 84..-56 frame
  return (
    <svg viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} className="block h-auto w-full" aria-hidden="true">
      {layers ? (
        <>
          <path d={layers.rest} fill="rgb(255 255 255 / 0.08)" />
          <path d={layers.inside} fill="currentColor" />
        </>
      ) : (
        <rect width={THUMB_W} height={THUMB_H} rx="6" fill="rgb(255 255 255 / 0.03)" />
      )}
      {divider === 'h' && <line x1="0" x2={THUMB_W} y1={equatorY} y2={equatorY} stroke="currentColor" strokeOpacity="0.55" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      {divider === 'v' && <line x1={THUMB_W / 2} x2={THUMB_W / 2} y1="0" y2={THUMB_H} stroke="currentColor" strokeOpacity="0.55" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function SelectedBadge() {
  return (
    <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_2px_8px_rgb(0_0_0/0.5)]" aria-hidden="true">
      <IconCheck size={12} strokeWidth={2.4} />
    </span>
  )
}

function RegionCard({ region, active, paths, label }: { region: Region; active: boolean; paths: Map<string, string> | null; label: string }) {
  const count = countryCount(region)
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${region.label}, ${count} countries`}
      onClick={() => setFocus(region.id)}
      className={`group relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors ${
        active ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-line-2 hover:bg-white/[0.03]'
      }`}
    >
      <span className={`block rounded-lg bg-black/35 p-1.5 transition-colors ${active ? 'text-accent' : 'text-accent/60 group-hover:text-accent/85'}`}>
        <Thumb region={region} paths={paths} />
      </span>
      <span className="flex items-baseline justify-between gap-2 px-1 pb-0.5">
        <span className="truncate text-[13px] font-medium text-ink">{label}</span>
        <span className="num shrink-0 text-[11px] text-ink-3">{count}</span>
      </span>
      {active && <SelectedBadge />}
    </button>
  )
}

function WorldCard({ active, paths }: { active: boolean; paths: Map<string, string> | null }) {
  const world = REGIONS.find((r) => r.id === WORLD)!
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setFocus(WORLD)}
      className={`group relative flex w-full items-center gap-4 rounded-xl border p-2 pr-4 text-left transition-colors ${
        active ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-line-2 hover:bg-white/[0.03]'
      }`}
    >
      <span className={`block w-[176px] shrink-0 rounded-lg bg-black/35 p-1.5 transition-colors max-[480px]:w-[120px] ${active ? 'text-accent' : 'text-accent/60 group-hover:text-accent/85'}`}>
        <Thumb region={world} paths={paths} />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-ink">Whole world</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
          Every country, <span className="num">{countryCount(world)}</span> in all, plus territories.
        </span>
      </span>
      {active && <SelectedBadge />}
    </button>
  )
}

/** Pick the focus region: the map flies there, other countries dim, and the next question covers only it. */
export function RegionModal() {
  const open = useStore((s) => s.regionPickerOpen)
  const focus = useStore((s) => s.focus.region)
  const paths = useThumbPaths(open)

  return (
    <Modal
      open={open}
      onClose={closeRegionPicker}
      title="Focus region"
      initialFocus='[aria-pressed="true"]'
      className="w-[760px] max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] max-[767px]:h-full max-[767px]:max-h-none max-[767px]:w-full max-[767px]:max-w-none max-[767px]:rounded-none"
    >
      <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5 max-[767px]:px-4">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Zoom the map to part of the world and ask only about its countries. Focused questions finish faster, cost less and
          cover more of the countries you care about.
        </p>
        <WorldCard active={focus === WORLD} paths={paths} />
        {GROUPS.map((group) => (
          <section key={group.id} className="space-y-3" aria-labelledby={`region-group-${group.id}`}>
            <div>
              <h3 id={`region-group-${group.id}`} className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{group.title}</h3>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{group.description}</p>
            </div>
            <div className={`grid gap-2 ${group.grid}`}>
              {REGIONS.filter((r) => r.group === group.id).map((r) => (
                <RegionCard
                  key={r.id}
                  region={r}
                  active={focus === r.id}
                  paths={paths}
                  label={group.id === 'hemisphere' ? r.label.replace(' Hemisphere', '') : r.label}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-3 text-[12px] text-ink-3 max-[767px]:px-4">
        The region applies to your next question. Maps you already made keep the countries they were asked about.
      </footer>
    </Modal>
  )
}
