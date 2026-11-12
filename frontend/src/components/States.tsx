import { formatCountdown } from '../lib/format'
import { dismissError, dismissToast, openSettings, runQuery, signIn, useSuggestion } from '../state/actions'
import { useStore } from '../state/store'
import { IconAlert, IconCheck, IconClose, IconInfo, IconRefresh, IconSpark } from './icons'
import { useNow } from './primitives'

/** A beam sweeping across the map while the AI gathers data (static under reduced motion). */
export function LoadingOverlay() {
  const loading = useStore((s) => s.loading)
  if (!loading) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-canvas/25 animate-[fade_300ms_ease-out]" />
      <div className="scan-beam" />
    </div>
  )
}

function Card({ tone, icon, title, children, onClose }: { tone: 'info' | 'warn' | 'error'; icon: React.ReactNode; title: string; children: React.ReactNode; onClose: () => void }) {
  const ring = tone === 'error' ? 'text-danger bg-danger/12' : tone === 'warn' ? 'text-warn bg-warn/12' : 'text-accent bg-accent/12'
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[40%] z-20 flex justify-center px-3">
      <section role="alert" className="glass pointer-events-auto w-[460px] max-w-full p-5 animate-[pop_220ms_var(--ease-out-expo)]">
        <div className="flex items-start gap-3.5">
          <span className={`grid size-9 shrink-0 place-items-center rounded-full ${ring}`} aria-hidden="true">{icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            <div className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</div>
          </div>
          <button type="button" className="icon-btn -mr-2 -mt-1.5 shrink-0" onClick={onClose} aria-label="Dismiss">
            <IconClose size={16} />
          </button>
        </div>
      </section>
    </div>
  )
}

export function ErrorCard() {
  const error = useStore((s) => s.error)
  const loading = useStore((s) => s.loading)
  const signedIn = useStore((s) => !!s.me?.signed_in)
  const now = useNow(1000)
  if (!error || loading) return null

  if (error.kind === 'unmappable') {
    return (
      <Card tone="info" icon={<IconSpark size={17} />} title="That one doesn't map" onClose={dismissError}>
        <p>{error.reason || "It isn't something measured country by country."}</p>
        {error.suggestions.length > 0 && (
          <>
            <p className="mt-3 label">Try instead</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {error.suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => useSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
    )
  }
  if (error.kind === 'budget') {
    return (
      <Card tone="warn" icon={<IconAlert size={17} />} title="Free maps are paused for today" onClose={dismissError}>
        <p>The shared daily budget for free maps is used up. Saved maps still work{error.resetAt ? <>, and free maps return in <span className="num text-ink">{formatCountdown(error.resetAt, now)}</span></> : ''}.</p>
        <div className="mt-3.5 flex gap-2">
          {signedIn ? (
            <button type="button" className="btn btn-primary h-9" onClick={() => openSettings('key')}>Add your API key</button>
          ) : (
            <button type="button" className="btn btn-primary h-9" onClick={signIn}>Sign in to use your own key</button>
          )}
        </div>
      </Card>
    )
  }
  const retry = () => {
    dismissError()
    void runQuery(error.query)
  }
  if (error.kind === 'network') {
    return (
      <Card tone="error" icon={<IconAlert size={17} />} title="Can't reach Terrachrome" onClose={dismissError}>
        <p>{error.message}</p>
        <button type="button" className="btn btn-ghost mt-3.5 h-9" onClick={retry}><IconRefresh size={15} /> Try again</button>
      </Card>
    )
  }
  return (
    <Card tone="error" icon={<IconAlert size={17} />} title={error.code === 'no_data' ? 'No usable data came back' : "That map didn't come together"} onClose={dismissError}>
      <p>{error.message}</p>
      <p className="mt-1 text-[12px] text-ink-3">Failed attempts don't use your free maps.</p>
      {error.retryable && <button type="button" className="btn btn-ghost mt-3.5 h-9" onClick={retry}><IconRefresh size={15} /> Try again</button>}
    </Card>
  )
}

/** Bottom-left card before the first map: what this is and how the free tier works. */
export function EmptyHint() {
  const hasMap = useStore((s) => s.map !== null)
  const loading = useStore((s) => s.loading)
  const config = useStore((s) => s.config)
  if (hasMap || loading) return null
  return (
    <section className="glass pointer-events-auto w-[300px] max-w-[calc(100vw-24px)] p-4 animate-[rise_400ms_var(--ease-out-expo)]">
      <p className="label">Ask the world anything</p>
      <h2 className="mt-1.5 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">Every question becomes a map.</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        Type anything measured country by country. One AI call fetches every country it knows; repeat questions and common statistics are free.
      </p>
      <ul className="mt-3 space-y-1.5 text-[12px] text-ink-2">
        <li className="flex items-center gap-2"><IconCheck size={14} className="text-ok" /> {config?.free_maps_per_day ?? 3} free maps a day, no sign-up</li>
        <li className="flex items-center gap-2"><IconCheck size={14} className="text-ok" /> Unlimited with your own OpenAI or Anthropic key</li>
        <li className="flex items-center gap-2"><IconInfo size={14} className="text-warn" /> AI estimates: verify before citing</li>
      </ul>
      {config?.llm_mode === 'mock' && <p className="mt-3 rounded-md border border-accent/25 bg-accent/8 px-2.5 py-1.5 text-[11.5px] text-accent-2">Mock mode: answers are fixtures, no API key used.</p>}
    </section>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed right-3 top-[68px] z-[60] flex w-[360px] max-w-[calc(100vw-24px)] flex-col gap-2 max-[640px]:left-3 max-[640px]:top-auto max-[640px]:bottom-3" aria-live="polite">
      {toasts.map((t) => {
        const dot = t.tone === 'success' ? 'bg-ok' : t.tone === 'warn' ? 'bg-warn' : t.tone === 'error' ? 'bg-danger' : 'bg-accent'
        return (
          <div key={t.id} role="status" className="glass pointer-events-auto flex items-start gap-3 px-3.5 py-3 animate-[slide-in-right_240ms_var(--ease-out-expo)]">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.body && <p className="mt-0.5 break-words text-[12px] leading-relaxed text-ink-3">{t.body}</p>}
              {t.action && (
                <button type="button" className="mt-2 text-[12.5px] font-medium text-accent hover:underline" onClick={() => { t.action!.run(); dismissToast(t.id) }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" className="icon-btn -mr-1.5 -mt-1 size-7 shrink-0" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
              <IconClose size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
