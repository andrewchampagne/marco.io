import { useEffect, useId, useState } from 'react'
import { removeApiKey, saveApiKey } from '../state/actions'
import { maskKey, PROVIDERS, type Provider } from '../state/keyStorage'
import { useStore } from '../state/store'
import { IconExternal, IconEye, IconEyeOff, IconShield } from './icons'
import { Segmented, Spinner, Toggle } from './primitives'

export function KeyStatusBadge() {
  const status = useStore((s) => s.apiKey.status)
  const has = useStore((s) => !!s.apiKey.key)
  const label = status === 'checking' ? 'Checking…' : status === 'invalid' ? 'Invalid' : has ? 'Connected' : 'Not set'
  const tone = status === 'invalid' ? 'border-danger/40 bg-danger/10 text-danger' : has && status !== 'checking' ? 'border-ok/35 bg-ok/10 text-ok' : 'border-line-2 bg-white/5 text-ink-3'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  )
}

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: 'openai', label: PROVIDERS.openai.label },
  { value: 'anthropic', label: PROVIDERS.anthropic.label },
]

/** Masked API key entry: provider choice (OpenAI by default), validate and save, remember toggle, remove.
 * Used in Settings and the Access modal. */
export function KeyForm({ autoFocus = false, compact = false }: { autoFocus?: boolean; compact?: boolean }) {
  const apiKey = useStore((s) => s.apiKey)
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [remember, setRemember] = useState(apiKey.remember)
  const [provider, setProvider] = useState<Provider>(apiKey.provider)
  const inputId = useId()
  const rememberId = useId()
  const checking = apiKey.status === 'checking'
  const info = PROVIDERS[provider]

  useEffect(() => setRemember(apiKey.remember), [apiKey.remember])
  useEffect(() => setProvider(apiKey.provider), [apiKey.provider])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    const ok = await saveApiKey(value, remember, provider)
    if (ok) setValue('')
  }

  return (
    <form onSubmit={submit} className="space-y-3.5" autoComplete="off">
      {apiKey.key && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5">
          <div>
            <p className="label">Saved {PROVIDERS[apiKey.provider].label} key</p>
            <p className="num mt-0.5 text-[13px] text-ink">{maskKey(apiKey.key)}</p>
          </div>
          <button type="button" className="btn btn-ghost h-8 px-3 text-[12.5px]" onClick={removeApiKey}>Remove key</button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-2">Provider</span>
        <Segmented value={provider} options={PROVIDER_OPTIONS} onChange={setProvider} label="API key provider" size="sm" />
      </div>
      <div>
        <label htmlFor={inputId} className="text-[12.5px] font-medium text-ink-2">
          {apiKey.key ? `Replace with a new ${info.label} key` : `${info.label} API key`}
        </label>
        <div className="relative mt-1.5">
          <input
            id={inputId}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={info.placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus={autoFocus}
            className="field num pr-10 text-[13px]"
            aria-describedby={`${inputId}-note`}
            aria-invalid={apiKey.status === 'invalid'}
          />
          <button type="button" className="icon-btn absolute right-1 top-1/2 size-8 -translate-y-1/2" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide key' : 'Show key'}>
            {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </button>
        </div>
        {apiKey.status === 'invalid' && apiKey.message && <p className="mt-1.5 text-[12px] text-danger" role="alert">{apiKey.message}</p>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={rememberId} className="text-[12.5px] text-ink-2">Remember on this device</label>
        <Toggle id={rememberId} checked={remember} onChange={setRemember} label="Remember on this device" />
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'pt-0.5'}`}>
        <button type="submit" className="btn btn-primary" disabled={!value.trim() || checking}>
          {checking ? <><Spinner size={14} /> Validating…</> : 'Validate and save'}
        </button>
        <a href={info.keysUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 text-[12.5px] text-accent hover:underline">
          Get an {info.label} key <IconExternal size={13} />
        </a>
      </div>
      <p id={`${inputId}-note`} className="flex gap-2 rounded-xl border border-line bg-white/[0.025] px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">
        <IconShield size={15} className="mt-px shrink-0 text-ok" />
        <span>
          Your key stays in this browser ({remember ? 'remembered until you remove it' : 'only for this tab'}) and is sent only with your own map requests. It is
          never stored on our servers or written to logs.
        </span>
      </p>
    </form>
  )
}
