import { useEffect, useRef, useState } from 'react'
import { formatCountdown } from '../lib/format'
import { cancelQuery, goHome, openSettings, refreshHistory, refreshUsage, runQuery } from '../state/actions'
import { prefersReducedMotion } from '../state/prefs'
import { store, useStore } from '../state/store'
import { IconArrowUp, IconClock, IconClose, IconGear, IconSpark } from './icons'
import { Avatar, Spinner, useNow } from './primitives'

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 select-none">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#25B46E" />
            <stop offset=".5" stopColor="#F2E36B" />
            <stop offset="1" stopColor="#B0223F" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="11" fill="none" stroke="url(#logo-g)" strokeWidth="2.2" />
        <path d="M5 16h22M16 5c3.6 3.4 3.6 18.6 0 22M16 5c-3.6 3.4-3.6 18.6 0 22" fill="none" stroke="url(#logo-g)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Terrachrome</span>
    </span>
  )
}

export function TopLeft() {
  const historyOpen = useStore((s) => s.historyOpen)
  return (
    <div className="glass pointer-events-auto flex h-11 items-center gap-1 pl-3 pr-1.5">
      <button type="button" onClick={goHome} className="rounded-md pr-1.5 outline-offset-4" aria-label="Terrachrome home">
        <Logo />
      </button>
      <span className="mx-1 h-5 w-px bg-line-2" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        aria-label="Query history"
        aria-expanded={historyOpen}
        title="History"
        onClick={() => {
          if (!historyOpen) void refreshHistory()
          store.set({ historyOpen: !historyOpen, tableOpen: false })
        }}
      >
        <IconClock />
      </button>
    </div>
  )
}

export function AccountButton() {
  const me = useStore((s) => s.me)
  const signedIn = !!me?.signed_in
  return (
    <button
      type="button"
      onClick={() => openSettings(signedIn ? 'account' : 'account')}
      aria-label={signedIn ? `Settings for ${me?.name ?? 'your account'}` : 'Settings'}
      title="Settings"
      className="glass pointer-events-auto grid size-11 place-items-center rounded-full p-0 text-ink-2 transition-colors hover:text-ink"
      style={{ borderRadius: 999 }}
    >
      {signedIn ? <Avatar name={me?.name ?? null} url={me?.avatar_url ?? null} size={32} /> : <IconGear size={19} />}
    </button>
  )
}

function useRotatingPlaceholder(items: string[], active: boolean): [string, number] {
  const [index, setIndex] = useState(0)
  const motion = useStore((s) => s.prefs.motion)
  useEffect(() => {
    if (!active || items.length < 2 || prefersReducedMotion(motion)) return
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), 3600)
    return () => clearInterval(id)
  }, [active, items.length, motion])
  return [items[index % Math.max(1, items.length)] ?? 'Ask anything measured country by country…', index]
}

export function CommandBar() {
  const draft = useStore((s) => s.draft)
  const loading = useStore((s) => s.loading)
  const examples = useStore((s) => s.examples)
  const hasMap = useStore((s) => s.map !== null)
  const maxChars = useStore((s) => s.config?.max_query_chars ?? 200)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [placeholder, phIndex] = useRotatingPlaceholder(examples?.placeholders ?? [], !draft && !focused)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.closest('input, textarea, [contenteditable="true"]')
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = () => {
    if (loading) return
    const q = draft.trim()
    if (q) {
      inputRef.current?.blur()
      void runQuery(q)
    }
  }

  const showChips = !loading && (!hasMap || focused) && (examples?.chips.length ?? 0) > 0
  return (
    <div className="pointer-events-auto flex w-full flex-col items-center gap-2">
      <form
        role="search"
        className={`glass relative flex h-[52px] w-full items-center gap-2 overflow-hidden pl-4 pr-2 transition-[border-color,box-shadow] duration-200 ${
          focused ? 'border-accent/45 shadow-[0_0_0_4px_rgb(127_231_242/0.08),0_18px_50px_-18px_rgb(0_0_0/0.85)]' : ''
        }`}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className={loading ? 'text-accent' : 'text-ink-3'} aria-hidden="true">
          {loading ? <Spinner size={18} /> : <IconSpark size={19} />}
        </span>
        <div className="relative h-full min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => store.set({ draft: e.target.value.slice(0, maxChars) })}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (loading) cancelQuery()
                else inputRef.current?.blur()
              }
            }}
            maxLength={maxChars}
            aria-label="Ask a question to map"
            enterKeyHint="go"
            autoComplete="off"
            spellCheck={false}
            className="peer h-full w-full bg-transparent text-[15px] text-ink outline-none"
            readOnly={!!loading}
          />
          {!draft && (
            <span key={phIndex} className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center truncate text-[15px] text-ink-3 animate-[rise_420ms_var(--ease-out-expo)]" aria-hidden="true">
              {placeholder}
            </span>
          )}
        </div>
        {draft.length > maxChars - 40 && !loading && (
          <span className={`num text-[11px] ${draft.length >= maxChars ? 'text-warn' : 'text-ink-3'}`} aria-live="polite">
            {draft.length}/{maxChars}
          </span>
        )}
        {!draft && !loading && !focused && <span className="kbd hidden sm:inline" aria-hidden="true">/</span>}
        {loading ? (
          <button type="button" className="icon-btn" onClick={cancelQuery} aria-label="Cancel">
            <IconClose />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Map it"
            className="grid size-9 place-items-center rounded-[10px] bg-accent text-accent-ink transition-opacity disabled:bg-white/10 disabled:text-ink-3"
          >
            <IconArrowUp size={18} />
          </button>
        )}
        {loading && (
          <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden" aria-hidden="true">
            <span className="progress-sweep block h-full w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </span>
        )}
      </form>
      <StatusLine />
      {showChips && (
        <div className="flex max-w-full flex-wrap justify-center gap-1.5 animate-[rise_300ms_var(--ease-out-expo)]">
          {examples!.chips.map((chip) => (
            <button key={chip} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => { store.set({ draft: chip }); void runQuery(chip) }}>
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusLine() {
  const loading = useStore((s) => s.loading)
  const usage = useStore((s) => s.usage)
  const apiKey = useStore((s) => s.apiKey)
  const signedIn = useStore((s) => !!s.me?.signed_in)
  const now = useNow(1000)

  useEffect(() => {
    if (!usage?.reset_at) return
    const ms = new Date(usage.reset_at).getTime() - Date.now()
    if (ms <= 0 || ms > 2 ** 31 - 1) return
    const id = setTimeout(() => void refreshUsage(), ms + 1500)
    return () => clearTimeout(id)
  }, [usage?.reset_at])

  if (loading) {
    const text = loading.stage === 'gathering' && loading.countries > 0 ? `${loading.message} · ${loading.countries} countries` : loading.message
    return (
      <p className="flex h-6 items-center gap-2 rounded-full bg-canvas/60 px-3 text-[12.5px] backdrop-blur-md" role="status" aria-live="polite">
        <span className="size-1.5 rounded-full bg-accent animate-[pulse-dot_1.2s_ease-in-out_infinite]" aria-hidden="true" />
        <span className="shimmer-text font-medium">{text}</span>
      </p>
    )
  }
  if (!usage) return <p className="h-6" />
  const byok = signedIn && apiKey.key && apiKey.status !== 'invalid'
  let dot = 'bg-ok'
  let text: React.ReactNode
  if (byok) {
    text = <>Using your API key · <span className="text-ink-2">unlimited maps</span></>
  } else if (usage.budget_exhausted) {
    dot = 'bg-warn'
    text = <>Free maps paused for today{signedIn ? ' · add your API key to continue' : ''}</>
  } else {
    if (usage.remaining === 0) dot = 'bg-danger'
    else if (usage.remaining === 1) dot = 'bg-warn'
    const reset = usage.reset_at ? formatCountdown(usage.reset_at, now) : ''
    text = (
      <>
        <span className="num text-ink-2">{usage.remaining}</span> of <span className="num text-ink-2">{usage.limit}</span> free maps left
        {reset && usage.remaining < usage.limit && <> · {usage.remaining === 0 ? 'next in' : 'resets in'} <span className="num">{reset}</span></>}
      </>
    )
  }
  return (
    <p className="flex h-6 items-center gap-2 rounded-full bg-canvas/60 px-3 text-[12.5px] text-ink-3 backdrop-blur-md" aria-live="polite">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      <span>{text}</span>
    </p>
  )
}
