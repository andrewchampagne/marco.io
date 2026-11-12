import { KeyPrompt } from './components/KeyPrompt'
import { Legend } from './components/Legend'
import { MapControls } from './components/MapControls'
import { DataTable, DetailPanel, HistoryDrawer } from './components/Panels'
import { RegionModal } from './components/RegionModal'
import { SettingsModal } from './components/SettingsModal'
import { EmptyHint, ErrorCard, LoadingOverlay, Toasts } from './components/States'
import { Tooltip } from './components/Tooltip'
import { CommandBar, SettingsButton, TopLeft } from './components/TopBar'
import MapView from './map/MapView'

/** The map fills the viewport; everything else floats on top as glass panels. */
export default function App() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas text-ink">
      <MapView />
      <div className="vignette pointer-events-none absolute inset-0" aria-hidden="true" />
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

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 max-[640px]:bottom-[62px] max-[640px]:left-2 max-[640px]:right-2">
        <Legend />
        <EmptyHint />
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 max-[640px]:bottom-2 max-[640px]:right-2">
        <MapControls />
      </div>

      <DetailPanel />
      <DataTable />
      <ErrorCard />
      <Toasts />
      <SettingsModal />
      <RegionModal />
      <KeyPrompt />
    </div>
  )
}
