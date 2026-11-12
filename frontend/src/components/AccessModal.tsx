import { formatCountdown } from '../lib/format'
import { closeAccess, signIn } from '../state/actions'
import { useStore } from '../state/store'
import { IconClock, IconKey } from './icons'
import { KeyForm } from './KeyForm'
import { GoogleButton, Modal, useNow } from './primitives'

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 text-[11.5px]" aria-label={`Step ${step} of 2`}>
      {['Sign in with Google', 'Add your API key'].map((label, i) => {
        const n = (i + 1) as 1 | 2
        const done = n < step
        const active = n === step
        return (
          <li key={label} className="flex items-center gap-2">
            <span className={`grid size-5 place-items-center rounded-full text-[10.5px] font-semibold ${done ? 'bg-ok text-black' : active ? 'bg-accent text-accent-ink' : 'bg-white/10 text-ink-3'}`}>{done ? '✓' : n}</span>
            <span className={active ? 'text-ink' : 'text-ink-3'}>{label}</span>
            {n === 1 && <span className="mx-1 h-px w-6 bg-line-2" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

/** Opens when the free limit is hit. Signed out: sign in or wait. Signed in: add a key (then the blocked question resumes). */
export function AccessModal() {
  const access = useStore((s) => s.access)
  const me = useStore((s) => s.me)
  const usage = useStore((s) => s.usage)
  const now = useNow(1000)
  const signedIn = !!me?.signed_in
  const step: 1 | 2 = signedIn ? 2 : access.step
  const resetAt = access.resetAt ?? usage?.reset_at ?? null
  const countdown = resetAt ? formatCountdown(resetAt, now) : null
  const limit = usage?.limit ?? 3

  return (
    <Modal
      open={access.open}
      onClose={closeAccess}
      title={step === 1 ? 'Free maps used up' : 'Unlock unlimited maps'}
      className="w-[480px] max-w-[calc(100vw-24px)] max-[767px]:max-h-[calc(100vh-24px)]"
      initialFocus={step === 2 ? 'input' : undefined}
    >
      <div className="scrollbar-thin space-y-5 overflow-y-auto px-6 py-5">
        <Steps step={step} />
        {step === 1 ? (
          <>
            <div>
              <p className="text-[19px] font-semibold leading-snug tracking-[-0.02em] text-ink">You've used your {limit} free maps.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Free maps refill on a rolling 24-hour window. For unlimited maps, sign in and add your own OpenAI or Anthropic API key. It costs fractions of a cent
                per map, billed by your provider.
              </p>
              {access.pendingQuery && (
                <p className="mt-3 truncate rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[12.5px] text-ink-3">
                  Waiting to map: <span className="text-ink-2">"{access.pendingQuery}"</span>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2.5">
              <GoogleButton onClick={signIn} className="justify-center" />
              <button type="button" className="btn btn-ghost h-10" onClick={closeAccess}>
                <IconClock size={16} /> Wait{countdown && countdown !== 'now' ? <span className="text-ink-3">· next free map in <span className="num">{countdown}</span></span> : null}
              </button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-3">Signing in by itself doesn't add free maps; it lets you use your own key safely.</p>
          </>
        ) : (
          <>
            <div className="flex gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/12 text-accent" aria-hidden="true"><IconKey size={19} /></span>
              <div>
                <p className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">Add your OpenAI or Anthropic API key for unlimited maps.</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                  {access.pendingQuery ? <>Once it's saved, your question <span className="text-ink-2">"{access.pendingQuery}"</span> will run automatically.</> : 'It also enables web search for recent statistics.'}
                </p>
              </div>
            </div>
            <KeyForm autoFocus compact />
            <button type="button" className="btn btn-ghost h-9 w-full" onClick={closeAccess}>
              Not now{countdown && countdown !== 'now' ? <span className="text-ink-3">· next free map in <span className="num">{countdown}</span></span> : null}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
