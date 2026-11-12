import { useEffect, useRef, useState } from 'react'
import { MAP_FILE_EXTENSION } from '../lib/mapFile'
import { WORLD, regionOf } from '../lib/regions'
import { deleteSavedMap, downloadSavedMap, openMapFile, openSavedMap } from '../state/actions'
import { store, useStore } from '../state/store'
import { IconClose, IconDownload, IconFolder, IconTrash, IconUpload } from './icons'

const ACCEPT = `${MAP_FILE_EXTENSION},.json,application/json`

function savedWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A button that opens the file picker for a .marco file. */
export function OpenFileButton({ className, children }: { className: string; children: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => inputRef.current?.click()}>
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label="Open a map file"
        data-testid="map-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // picking the same file again should still open it
          if (file) void openMapFile(file)
        }}
      />
    </>
  )
}

/** Left drawer: maps saved in this browser, plus opening a .marco file from disk. */
export function LibraryDrawer() {
  const open = useStore((s) => s.libraryOpen)
  const items = useStore((s) => s.library)
  const savedId = useStore((s) => s.savedId)
  const [confirming, setConfirming] = useState<string | null>(null)
  const close = () => store.set({ libraryOpen: false })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) store.set({ libraryOpen: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => setConfirming(null), [open])

  if (!open) return null
  return (
    <aside className="glass pointer-events-auto absolute left-3 top-[72px] z-30 flex max-h-[calc(100vh-160px)] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden animate-[pop_180ms_var(--ease-out-expo)] max-[767px]:top-[124px] max-[640px]:left-2" aria-label="My maps">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">My maps</h2>
          <p className="text-[11.5px] text-ink-3">Saved in this browser · no AI call to reopen</p>
        </div>
        <button type="button" className="icon-btn -mr-1.5" onClick={close} aria-label="Close My maps">
          <IconClose />
        </button>
      </header>
      <ul className="scrollbar-thin flex-1 overflow-y-auto p-1.5">
        {items === null && <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">Loading…</li>}
        {items?.length === 0 && (
          <li className="px-3 py-8 text-center">
            <p className="text-[13px] text-ink-2">No saved maps yet</p>
            <p className="mt-1 text-[12px] text-ink-3">Save a map from the share menu, or open a {MAP_FILE_EXTENSION} file someone sent you.</p>
          </li>
        )}
        {items?.map((item) => (
          <li key={item.id} className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-white/6 ${savedId === item.id ? 'bg-white/6' : ''}`}>
            <button type="button" onClick={() => void openSavedMap(item.id)} className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left">
              <span className="flex items-center gap-2">
                <IconFolder size={14} className="shrink-0 text-accent" />
                <span className="truncate text-[13px] font-medium text-ink">{item.title}</span>
              </span>
              <span className="flex justify-between gap-3 pl-[22px] text-[11.5px] text-ink-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  {item.region !== WORLD && (
                    <span className="shrink-0 rounded-[5px] border border-accent/25 bg-accent/[0.07] px-1.5 text-[10.5px] leading-[16px] text-accent">
                      {regionOf(item.region).short}
                    </span>
                  )}
                  <span className="truncate">{item.query}</span>
                </span>
                <span className="shrink-0">{savedWhen(item.savedAt)}</span>
              </span>
            </button>
            {confirming === item.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" className="h-7 rounded-md bg-danger/15 px-2 text-[11.5px] font-medium text-danger hover:bg-danger/25" onClick={() => { setConfirming(null); void deleteSavedMap(item.id) }}>
                  Delete
                </button>
                <button type="button" className="h-7 rounded-md px-1.5 text-[11.5px] text-ink-3 hover:text-ink" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100">
                <button type="button" className="icon-btn size-7" title="Download map file" aria-label={`Download ${item.title} as a file`} onClick={() => void downloadSavedMap(item.id)}>
                  <IconDownload size={14} />
                </button>
                <button type="button" className="icon-btn size-7" title="Delete" aria-label={`Delete ${item.title}`} onClick={() => setConfirming(item.id)}>
                  <IconTrash size={14} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <footer className="border-t border-line p-2">
        <OpenFileButton className="btn btn-ghost h-8 w-full text-[12.5px]">
          <IconUpload size={15} /> Open a map file…
        </OpenFileButton>
      </footer>
    </aside>
  )
}

/** Dropping a .marco file anywhere on the page opens it. */
export function FileDropZone() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) void openMapFile(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!over) return null
  return (
    <div className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-accent/60 bg-canvas/70 backdrop-blur-sm" aria-hidden="true">
      <p className="flex items-center gap-2 text-[15px] font-medium text-accent">
        <IconUpload size={20} /> Drop a {MAP_FILE_EXTENSION} file to open it
      </p>
    </div>
  )
}
