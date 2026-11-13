import { useEffect, useState } from 'react'
import { IconEye } from './components/icons'
import { KeyPrompt } from './components/KeyPrompt'
import { Legend } from './components/Legend'
import { FileDropZone, LibraryDrawer } from './components/Library'
import { MapControls } from './components/MapControls'
import { ChartsPanel } from './components/Charts'
import { DataTable, DetailPanel, HistoryDrawer } from './components/Panels'
import { RegionModal } from './components/RegionModal'
import { SettingsModal } from './components/SettingsModal'
import { EmptyHint, ErrorCard, LoadingOverlay, Toasts } from './components/States'
import { Tooltip } from './components/Tooltip'
import { CommandBar, SettingsButton, TopLeft } from './components/TopBar'
import MapView from './map/MapView'
import { setUiHidden } from './state/actions'
import { store, useStore } from './state/store'

/** H hides or shows every control; Esc brings them back. Ignored while typing or with a dialog open. */
function useHideShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const hidden = store.get().uiHidden
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setUiHidden(!hidden)
      } else if (e.key === 'Escape' && hidden) {
        setUiHidden(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The only control left when the rest is hidden: faint until hovered, with a short hint when it appears. */
function ShowControlsButton() {
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 2600)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-2 max-[640px]:bottom-2 max-[640px]:right-2">
      <p className={`rounded-full bg-canvas/70 px-3 py-1 text-[12.5px] text-ink-2 backdrop-blur-md transition-opacity duration-500 ${hint ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!hint}>
        Press H or Esc to show the controls
      </p>
      <button
        type="button"
        className="glass pointer-events-auto grid size-11 place-items-center rounded-full p-0 text-ink-2 opacity-50 transition-opacity hover:text-ink hover:opacity-100 focus-visible:opacity-100"
        aria-label="Show controls (H)"
        title="Show controls (H)"
        onClick={() => setUiHidden(false)}
      >
        <IconEye />
      </button>
    </div>
  )
}

/** The map fills the viewport; everything else floats on top as glass panels. */
export default function App() {
  const hidden = useStore((s) => s.uiHidden)
  useHideShortcut()
  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas text-ink">
      <MapView />
      <div className="vignette pointer-events-none absolute inset-0" aria-hidden="true" />
      {hidden ? (
        <ShowControlsButton />
      ) : (
        <>
          <LoadingOverlay />
          <Tooltip />

          <header className="pointer-events-none absolute inset-x-0 top-0 z-30 grid grid-cols-[1fr_minmax(0,640px)_1fr] items-start gap-3 p-3 max-[767px]:grid-cols-[1fr_auto] max-[767px]:gap-2 max-[767px]:p-2">
            <div className="flex justify-start">
              <TopLeft />
            </div>
            <div className="max-[767px]:col-span-2 max-[767px]:row-start-2">
              <CommandBar />
            </div>
            <div className="flex justify-end max-[767px]:col-start-2 max-[767px]:row-start-1">
              <SettingsButton />
            </div>
          </header>

          <HistoryDrawer />
          <LibraryDrawer />

          <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 max-[640px]:bottom-[62px] max-[640px]:left-2 max-[640px]:right-2">
            <Legend />
            <EmptyHint />
          </div>
          <div className="pointer-events-none absolute bottom-3 right-3 z-20 max-[640px]:bottom-2 max-[640px]:right-2">
            <MapControls />
          </div>

          <DetailPanel />
          <DataTable />
          <ChartsPanel />
          <ErrorCard />
          <Toasts />
          <SettingsModal />
          <RegionModal />
        </>
      )}
      <KeyPrompt />
      <FileDropZone />
    </div>
  )
}
