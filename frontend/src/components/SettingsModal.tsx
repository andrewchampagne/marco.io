import { useState, type ReactNode } from 'react'
import type { Method } from '../api/types'
import { formatCountdown } from '../lib/format'
import { PALETTES, paletteGradient, type PaletteId } from '../lib/palettes'
import { clearHistory, closeSettings, deleteAccount, setSettingsTab, signIn, signOut, updatePrefs } from '../state/actions'
import type { Prefs } from '../state/prefs'
import { useStore, type SettingsTab } from '../state/store'
import {
  IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconGauge, IconInfo, IconKey, IconLogout, IconShield,
  IconSliders, IconTrash, IconUser,
} from './icons'
import { KeyForm, KeyStatusBadge } from './KeyForm'
import { Avatar, GoogleButton, Modal, ProgressRing, Segmented, Stepper, useMediaQuery, useNow } from './primitives'

const TABS: { id: SettingsTab; label: string; icon: ReactNode; blurb: string }[] = [
  { id: 'account', label: 'Account', icon: <IconUser size={17} />, blurb: 'Sign-in and your data' },
  { id: 'key', label: 'API key', icon: <IconKey size={17} />, blurb: 'Unlimited maps with your own key' },
  { id: 'usage', label: 'Usage', icon: <IconGauge size={17} />, blurb: 'Free maps left and reset time' },
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

function AccountTab() {
  const me = useStore((s) => s.me)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  if (!me?.signed_in) {
    return (
      <div className="space-y-6">
        <Section title="Sign in" description="Optional. Signing in doesn't add free maps; it unlocks the features below.">
          <div className="rounded-2xl border border-line bg-gradient-to-br from-white/[0.05] to-transparent p-5">
            <ul className="space-y-2.5 text-[13px] text-ink-2">
              <li className="flex gap-2.5"><IconCheck size={16} className="mt-px text-ok" /> History saved to your account, not just this browser</li>
              <li className="flex gap-2.5"><IconCheck size={16} className="mt-px text-ok" /> Unlimited maps with your own Anthropic API key</li>
              <li className="flex gap-2.5"><IconCheck size={16} className="mt-px text-ok" /> Your earlier maps and history come with you</li>
            </ul>
            <GoogleButton onClick={signIn} className="mt-5" />
            <p className="mt-3 text-[11.5px] text-ink-3">We store only your Google account id, name, email and profile photo URL.</p>
          </div>
        </Section>
      </div>
    )
  }
  return (
    <div className="space-y-8">
      <Section title="Profile">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-white/[0.03] p-4">
          <Avatar name={me.name} url={me.avatar_url} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">{me.name}</p>
            <p className="truncate text-[13px] text-ink-3">{me.email}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
            <IconLogout size={16} /> Sign out
          </button>
        </div>
      </Section>
      <Section title="Danger zone" description="Deletes your account, your maps, your history and your usage records. This can't be undone.">
        <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/[0.06] p-4">
          <label className="block text-[12.5px] text-ink-2" htmlFor="confirm-delete">
            Type <span className="num rounded bg-black/40 px-1.5 py-0.5 text-ink">DELETE</span> to confirm
          </label>
          <div className="flex flex-wrap gap-2">
            <input id="confirm-delete" className="field h-9 max-w-[200px]" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            <button
              type="button"
              className="btn btn-danger h-9"
              disabled={confirm !== 'DELETE' || deleting}
              onClick={async () => {
                setDeleting(true)
                const ok = await deleteAccount()
                setDeleting(false)
                if (ok) {
                  setConfirm('')
                  closeSettings()
                }
              }}
            >
              <IconTrash size={15} /> {deleting ? 'Deleting…' : 'Delete account and data'}
            </button>
          </div>
        </div>
      </Section>
    </div>
  )
}

function KeyTab() {
  const signedIn = useStore((s) => !!s.me?.signed_in)
  if (!signedIn) {
    return (
      <Section title="Use your own Anthropic API key" description="Sign in first: keys can only be used from a signed-in account, which keeps the free tier from being abused.">
        <div className="rounded-2xl border border-line bg-white/[0.03] p-5">
          <p className="text-[13px] leading-relaxed text-ink-2">With your own key you get unlimited maps, and web search for recent statistics. Your key stays in your browser.</p>
          <GoogleButton onClick={signIn} className="mt-4" />
        </div>
      </Section>
    )
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Anthropic API key</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Unlimited maps, billed to your Anthropic account (fractions of a cent per map).</p>
        </div>
        <KeyStatusBadge />
      </div>
      <KeyForm />
    </div>
  )
}

function UsageTab() {
  const usage = useStore((s) => s.usage)
  const apiKey = useStore((s) => s.apiKey)
  const signedIn = useStore((s) => !!s.me?.signed_in)
  const now = useNow(1000)
  const byok = signedIn && !!apiKey.key && apiKey.status !== 'invalid'
  if (!usage) return <p className="text-[13px] text-ink-3">Loading usage…</p>
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-7">
        <ProgressRing value={usage.remaining} max={usage.limit} size={132}>
          <div>
            <p className="num text-[30px] font-medium leading-none text-ink">{usage.remaining}</p>
            <p className="mt-1 text-[11px] text-ink-3">of {usage.limit} left</p>
          </div>
        </ProgressRing>
        <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px]">
          <dt className="text-ink-3">Mode</dt>
          <dd className="font-medium text-ink">{byok ? 'Own key · unlimited' : 'Free'}</dd>
          <dt className="text-ink-3">Free maps used</dt>
          <dd className="text-ink"><span className="num">{usage.used} / {usage.limit}</span> <span className="text-ink-3">in a rolling 24 h</span></dd>
          <dt className="text-ink-3">{usage.remaining === 0 ? 'Next free map' : 'Oldest map expires'}</dt>
          <dd className="text-ink">{usage.reset_at ? <>in <span className="num">{formatCountdown(usage.reset_at, now)}</span></> : '–'}</dd>
          {usage.budget_exhausted && (<><dt className="text-ink-3">Free tier</dt><dd className="text-warn">Paused for today (daily budget reached)</dd></>)}
        </dl>
      </div>
      <Section title="How the free tier works">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
          <li>• {usage.limit} maps per rolling 24 hours per browser, network and account. Signing in doesn't reset it.</li>
          <li>• Maps someone already asked for come from the cache and are free. So are official World Bank statistics.</li>
          <li>• Changing palette, classes or binning never uses a map.</li>
          <li>• Failed attempts don't count. Questions that can't be mapped do.</li>
        </ul>
      </Section>
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
  const signedIn = useStore((s) => !!s.me?.signed_in)
  return (
    <div className="space-y-7">
      <Section title="What we store">
        <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
          <li>• <span className="text-ink">Maps</span>: your question, the result and token counts, so maps can be shared and reused.</li>
          <li>• <span className="text-ink">History</span>: the questions you asked{signedIn ? ', linked to your account' : ', linked to this browser'}.</li>
          <li>• <span className="text-ink">Usage records</span>: time, outcome and token counts, keyed by a random browser id and a salted, one-way hash of your IP address, to enforce the free limit.</li>
          {signedIn && <li>• <span className="text-ink">Account</span>: your Google account id, name, email and photo URL.</li>}
        </ul>
        <div className="rounded-xl border border-ok/25 bg-ok/[0.06] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          Never stored: your Anthropic API key (it stays in your browser) and your raw IP address.
        </div>
      </Section>
      <Section title="Your data">
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-ghost" href="/api/me/export" download>
            <IconDownload size={16} /> Export my data (JSON)
          </a>
          <button type="button" className="btn btn-ghost" onClick={() => void clearHistory()}>
            <IconTrash size={16} /> Clear history
          </button>
        </div>
        <p className="text-[11.5px] text-ink-3">Clearing history doesn't reset your free-map count. To delete everything, use Account → Danger zone.</p>
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
          <dt className="text-ink-3">Mode</dt><dd className="text-ink">{config?.llm_mode === 'mock' ? 'Mock AI (fixtures)' : 'Live AI'} · {config?.auth_mode === 'mock' ? 'mock sign-in' : 'Google sign-in'}</dd>
        </dl>
      </Section>
      <div className="rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        <strong className="text-ink">AI-generated estimates, verify before citing.</strong> Values come from a language model's knowledge (or, for some common
        statistics, the World Bank). Confidence badges and notes flag rough estimates; countries without a defensible value are left blank rather than guessed.
      </div>
      <Section title="Known limitations">
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          <li>• Model knowledge has a cutoff; recent figures may be stale unless you use your own key, which enables web search.</li>
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
  const panel = { account: <AccountTab />, key: <KeyTab />, usage: <UsageTab />, appearance: <AppearanceTab />, privacy: <PrivacyTab />, about: <AboutTab /> }[current.id]
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
