import { closeKeyPrompt } from '../state/actions'
import { useStore } from '../state/store'
import { IconKey } from './icons'
import { KeyForm } from './KeyForm'
import { Modal } from './primitives'

/** Asks for the visitor's OpenAI key: on the first visit, when a question needs it, or after a key is
 * rejected. A question that was waiting runs as soon as the key is saved. */
export function KeyPrompt() {
  const prompt = useStore((s) => s.keyPrompt)
  const invalid = useStore((s) => s.apiKey.status === 'invalid' && !!s.apiKey.key)

  return (
    <Modal
      open={prompt.open}
      onClose={closeKeyPrompt}
      title={invalid ? 'Update your OpenAI API key' : 'Add your OpenAI API key'}
      className="w-[480px] max-w-[calc(100vw-24px)] max-[767px]:max-h-[calc(100vh-24px)]"
      initialFocus="input"
    >
      <div className="scrollbar-thin space-y-5 overflow-y-auto px-6 py-5">
        <div className="flex gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/12 text-accent" aria-hidden="true"><IconKey size={19} /></span>
          <div>
            <p className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">Terrachrome makes maps with your own OpenAI key.</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              {prompt.pendingQuery
                ? <>Once it's saved, your question <span className="text-ink-2">"{prompt.pendingQuery}"</span> will run automatically.</>
                : 'Each map costs a fraction of a cent, billed to your OpenAI account. Shared maps open without a key.'}
            </p>
          </div>
        </div>
        <KeyForm autoFocus compact />
        <button type="button" className="btn btn-ghost h-9 w-full" onClick={closeKeyPrompt}>
          Not now
        </button>
      </div>
    </Modal>
  )
}
