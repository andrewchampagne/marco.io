import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal dialog: aria-modal, labelled title, focus trap, Esc and backdrop close,
 * focus restored to the opener on close. 180 ms fade+scale (disabled under reduced motion).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className = '',
  labelledBy,
  initialFocus,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  className?: string
  labelledBy?: string
  initialFocus?: string // CSS selector inside the dialog
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const autoId = useId()
  const titleId = labelledBy ?? `${autoId}-title`

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const target = (initialFocus && panel?.querySelector<HTMLElement>(initialFocus)) || panel?.querySelector<HTMLElement>(FOCUSABLE) || panel
    requestAnimationFrame(() => target?.focus())
    return () => {
      const el = returnFocus.current
      if (el && document.contains(el)) requestAnimationFrame(() => el.focus())
    }
  }, [open, initialFocus])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-[fade_180ms_ease-out]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glass-strong relative flex flex-col outline-none animate-[pop_180ms_var(--ease-out-expo)] ${className}`}
      >
        {title !== undefined && (
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            <button type="button" className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A popover anchored to its trigger; closes on outside click and Esc. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  className = '',
  label,
}: {
  open: boolean
  onClose: () => void
  anchor: React.RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        anchor.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchor])
  if (!open) return null
  return (
    <div ref={ref} role="dialog" aria-label={label} className={`glass absolute z-30 animate-[pop_160ms_var(--ease-out-expo)] ${className}`}>
      {children}
    </div>
  )
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-150 ${
        checked ? 'border-accent/60 bg-accent/80' : 'border-line-2 bg-white/10'
      }`}
    >
      <span
        className={`absolute left-0 top-[2px] size-4 rounded-full shadow transition-transform duration-150 ${
          checked ? 'translate-x-[18px] bg-accent-ink' : 'translate-x-[2px] bg-ink'
        }`}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-line bg-black/30 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const i = options.findIndex((x) => x.value === value)
            const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
            onChange(next.value)
            ;(e.currentTarget.parentElement?.querySelectorAll('button')[options.indexOf(next)] as HTMLButtonElement)?.focus()
          }}
          tabIndex={value === o.value ? 0 : -1}
          className={`rounded-[7px] font-medium transition-colors duration-150 ${size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]'} ${
            value === o.value ? 'bg-white/12 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center rounded-[10px] border border-line bg-black/30" role="group" aria-label={label}>
      <button type="button" className="grid h-8 w-8 place-items-center text-ink-2 hover:text-ink disabled:opacity-30" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
        −
      </button>
      <output className="num w-6 text-center text-[13px] text-ink" aria-live="polite">{value}</output>
      <button type="button" className="grid h-8 w-8 place-items-center text-ink-2 hover:text-ink disabled:opacity-30" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
        +
      </button>
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}
