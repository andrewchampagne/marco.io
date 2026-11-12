import { useState, type ReactNode } from 'react'
import type { Method } from '../api/types'
import { PALETTES, paletteGradient, type PaletteId } from '../lib/palettes'
import { clearHistory, closeSettings, setSettingsTab, updatePrefs } from '../state/actions'
import type { Prefs } from '../state/prefs'
import { useStore, type SettingsTab } from '../state/store'
import { IconChevronLeft, IconChevronRight, IconDownload, IconInfo, IconKey, IconShield, IconSliders, IconTrash } from './icons'
import { KeyForm, KeyStatusBadge } from './KeyForm'
import { Modal, Segmented, Stepper, useMediaQuery } from './primitives'

const TABS: { id: SettingsTab; label: string; icon: ReactNode; blurb: string }[] = [
  { id: 'key', label: 'API key', icon: <IconKey size={17} />, blurb: 'Your OpenAI key, kept in this browser' },
  { id: 'appearance', label: 'Appearance', icon: <IconSliders size={17} />, blurb: 'Palette, classes and motion' },
  { id: 'privacy', label: 'Privacy and data', icon: <IconShield size={17} />, blurb: 'What we store, export, clear' },
  { id: 'about', label: 'About', icon: <IconInfo size={17} />, blurb: 'Version and limitations' },
]

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function KeyTab() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Your OpenAI API key</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Every map is made with your key and billed to your OpenAI account (fractions of a cent per map).</p>
        </div>
        <KeyStatusBadge />
      </div>
      <KeyForm />
    </div>
  )
}

function AppearanceTab() {
  const prefs = useStore((s) => s.prefs)
  const swatch = (id: PaletteId | 'auto', label: string, gradient: string) => (
    <button
      key={id}
      type="button"
      onClick={() => updatePrefs({ palette: id })}
      aria-pressed={prefs.palette === id}
      className={`flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-colors ${prefs.palette === id ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-line-2'}`}
    >
      <span className="h-2.5 w-full rounded-full" style={{ background: gradient }} />
      <span className="text-[12px] text-ink-2">{label}</span>
    </button>
  )
  return (
    <div className="space-y-7">
      <Section title="Default palette" description="Auto uses the palette the AI suggests for each map; you can always switch per map.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {swatch('auto', 'Auto (suggested)', 'linear-gradient(90deg,#25B46E,#7C86FF,#F7D13D,#B0223F)')}
          {PALETTES.map((p) => swatch(p.id, p.name, paletteGradient(p.id)))}
        </div>
      </Section>
      <Section title="Classes" description="How many colour steps new maps start with (3-9).">
        <Stepper value={prefs.classes} min={3} max={9} onChange={(v) => updatePrefs({ classes: v })} label="Classes" />
      </Section>
      <Section title="Binning method" description="Auto follows the AI's suggestion: quantile for skewed data, log for values spanning orders of magnitude.">
        <Segmented<Prefs['method']>
          value={prefs.method}
          onChange={(v) => updatePrefs({ method: v })}
          label="Binning method"
          options={[{ value: 'auto', label: 'Auto' }, { value: 'quantile' as Method, label: 'Quantile' }, { value: 'equal' as Method, label: 'Equal' }, { value: 'log' as Method, label: 'Log' }]}
        />
      </Section>
      <Section title="Motion" description="Map reveal sweeps, panel slides and shimmer. System follows your device's reduced-motion setting.">
        <Segmented<Prefs['motion']>
          value={prefs.motion}
          onChange={(v) => updatePrefs({ motion: v })}
          label="Motion"
          options={[{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduced' }, { value: 'full', label: 'Full' }]}
        />
      </Section>
    </div>
  )
}

function PrivacyTab() {
  return (
    <div className="space-y-7">
      <Section title="What we store">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
          <li>• <span className="text-ink">Maps</span>: your question, the result and token counts, so maps can be shared and reused.</li>
          <li>• <span className="text-ink">History</span>: the questions you asked, linked to this browser by a random id. There are no accounts.</li>
          <li>• <span className="text-ink">Usage records</span>: time, outcome and token counts, keyed by that browser id and a salted, one-way hash of your IP address (used for rate limits).</li>
        </ul>
        <div className="rounded-xl border border-ok/25 bg-ok/[0.06] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          Never stored: your OpenAI API key (it stays in your browser and is sent only with your own requests) and your raw IP address.
        </div>
      </Section>
      <Section title="Your data">
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-ghost" href="/api/export" download>
            <IconDownload size={16} /> Export my data (JSON)
          </a>
          <button type="button" className="btn btn-ghost" onClick={() => void clearHistory()}>
            <IconTrash size={16} /> Clear history
          </button>
        </div>
        <p className="text-[11.5px] text-ink-3">To forget your key too, remove it under API key.</p>
      </Section>
    </div>
  )
}

function AboutTab() {
  const config = useStore((s) => s.config)
  return (
    <div className="space-y-7">
      <Section title="Terrachrome">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
          <dt className="text-ink-3">Version</dt><dd className="num text-ink">{config?.version ?? '–'}</dd>
          <dt className="text-ink-3">Model</dt><dd className="num text-ink">{config?.model ?? '–'}</dd>
          <dt className="text-ink-3">Mode</dt><dd className="text-ink">{config?.llm_mode === 'mock' ? 'Mock AI (fixtures; keys are only shape-checked)' : 'Live AI, on your OpenAI key'}</dd>
        </dl>
      </Section>
      <div className="rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        <strong className="text-ink">AI-generated estimates, verify before citing.</strong> Values come from a language model's knowledge (or, for some common
        statistics, the World Bank). Where no official figure exists, the AI uses the best value it can find or a reasoned estimate, and confidence badges and notes flag it as unofficial or estimated.
      </div>
      <Section title="Known limitations">
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          <li>• Model knowledge has a cutoff; the model can search the web when a question is about recent data.</li>
          <li>• Countries only. Sub-national regions, cities and categorical maps (e.g. official language) aren't supported yet.</li>
          <li>• Historical states are mapped to their principal modern successor (e.g. USSR to Russia), as noted on each map.</li>
          <li>• Borders follow Natural Earth's de facto boundaries at 1:50m; tiny territories are shown as dots.</li>
        </ul>
      </Section>
      <p className="text-[11.5px] text-ink-3">Boundaries: Natural Earth (public domain). Statistics: World Bank WDI (CC BY 4.0). Rendering: MapLibre GL JS.</p>
    </div>
  )
}

export function SettingsModal() {
  const settings = useStore((s) => s.settings)
  const mobile = useMediaQuery('(max-width: 767px)')
  const [showDetail, setShowDetail] = useState(false)
  const current = TABS.find((t) => t.id === settings.tab) ?? TABS[0]
  const panel = { key: <KeyTab />, appearance: <AppearanceTab />, privacy: <PrivacyTab />, about: <AboutTab /> }[current.id]
  const close = () => {
    setShowDetail(false)
    closeSettings()
  }

  const nav = (
    <nav aria-label="Settings sections" className={mobile ? 'w-full p-3' : 'w-[214px] shrink-0 border-r border-line p-2.5'}>
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
        {TABS.map((t, i) => {
          const selected = !mobile && t.id === current.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls="settings-panel"
              tabIndex={mobile || selected ? 0 : -1}
              onClick={() => {
                setSettingsTab(t.id)
                if (mobile) setShowDetail(true)
              }}
              onKeyDown={(e) => {
                if (mobile || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
                e.preventDefault()
                const next = TABS[(i + (e.key === 'ArrowDown' ? 1 : TABS.length - 1)) % TABS.length]
                setSettingsTab(next.id)
                document.getElementById(`tab-${next.id}`)?.focus()
              }}
              className={`flex items-center gap-3 rounded-[10px] px-3 text-left transition-colors ${mobile ? 'h-14 border-b border-line/60' : 'h-10'} ${
                selected ? 'bg-white/9 text-ink' : 'text-ink-2 hover:bg-white/5 hover:text-ink'
              }`}
            >
              <span className={selected ? 'text-accent' : 'text-ink-3'}>{t.icon}</span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-medium">{t.label}</span>
                {mobile && <span className="block text-[11.5px] text-ink-3">{t.blurb}</span>}
              </span>
              {mobile && <IconChevronRight size={16} className="text-ink-3" />}
            </button>
          )
        })}
      </div>
    </nav>
  )

  return (
    <Modal
      open={settings.open}
      onClose={close}
      title={
        mobile && showDetail ? (
          <span className="flex items-center gap-1">
            <button type="button" className="icon-btn -ml-2" onClick={() => setShowDetail(false)} aria-label="Back to settings">
              <IconChevronLeft />
            </button>
            {current.label}
          </span>
        ) : (
          'Settings'
        )
      }
      className="h-[600px] w-[880px] max-h-[calc(100vh-48px)] max-w-[calc(100vw-48px)] max-[767px]:h-full max-[767px]:max-h-none max-[767px]:w-full max-[767px]:max-w-none max-[767px]:rounded-none"
    >
      <div className="flex min-h-0 flex-1">
        {(!mobile || !showDetail) && nav}
        {(!mobile || showDetail) && (
          <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${current.id}`} className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-7 py-6 max-[767px]:px-5">
            {!mobile && <h2 className="mb-5 text-[18px] font-semibold tracking-[-0.02em] text-ink">{current.label}</h2>}
            {panel}
          </div>
        )}
      </div>
    </Modal>
  )
}
