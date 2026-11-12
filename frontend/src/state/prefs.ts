/** Appearance preferences, per browser (localStorage, tolerant of storage failures). */
import type { Method } from '../api/types'
import type { PaletteId } from '../lib/palettes'

export interface Prefs {
  palette: PaletteId | 'auto' // auto = use the palette the AI suggests for each map
  classes: number
  method: Method | 'auto' // auto = the AI's suggested scale
  motion: 'system' | 'reduce' | 'full'
}

export const DEFAULT_PREFS: Prefs = { palette: 'auto', classes: 7, method: 'auto', motion: 'system' }
const KEY = 'terrachrome.prefs'

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    const classes = Number(parsed.classes)
    return {
      palette: (parsed.palette as Prefs['palette']) ?? 'auto',
      classes: classes >= 3 && classes <= 9 ? classes : 7,
      method: (parsed.method as Prefs['method']) ?? 'auto',
      motion: parsed.motion === 'reduce' || parsed.motion === 'full' ? parsed.motion : 'system',
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* preferences are a convenience */
  }
}

export function applyMotionPref(motion: Prefs['motion']): void {
  const root = document.documentElement
  if (motion === 'system') delete root.dataset.motion
  else root.dataset.motion = motion
}

export function prefersReducedMotion(motion: Prefs['motion']): boolean {
  if (motion === 'reduce') return true
  if (motion === 'full') return false
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
