/** Inline stroke icons (24px grid, 1.6 stroke). No icon library: these are the only ones the app needs. */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}

export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6Z" />
  </Svg>
)
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
)
export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>
)
export const IconSpark = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 13.8 9a2 2 0 0 0 1.3 1.3l5.4 1.7-5.4 1.7a2 2 0 0 0-1.3 1.3L12 20.5l-1.8-5.5a2 2 0 0 0-1.3-1.3L3.5 12l5.4-1.7A2 2 0 0 0 10.2 9L12 3.5Z" /></Svg>
)
export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></Svg>
)
export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
)
export const IconInfo = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.6v.2" /></Svg>
)
export const IconShare = (p: IconProps) => (
  <Svg {...p}><path d="M8.6 13.4 15.4 17M15.4 7 8.6 10.6" /><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /></Svg>
)
export const IconDownload = (p: IconProps) => (
  <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" /></Svg>
)
export const IconLink = (p: IconProps) => (
  <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></Svg>
)
export const IconPalette = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-2l-.3-.8c-.4-1.1.4-2.2 1.6-2.2h2.1a3.7 3.7 0 0 0 3.7-3.7C20.5 7.2 16.7 3.5 12 3.5Z" />
    <circle cx="7.8" cy="11.5" r="1" fill="currentColor" /><circle cx="10.5" cy="7.6" r="1" fill="currentColor" /><circle cx="15.2" cy="8" r="1" fill="currentColor" />
  </Svg>
)
export const IconSwap = (p: IconProps) => (
  <Svg {...p}><path d="M7 4.5 4 7.5l3 3M4 7.5h12.5M17 13.5l3 3-3 3M20 16.5H7.5" /></Svg>
)
export const IconLayers = (p: IconProps) => (
  <Svg {...p}><path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></Svg>
)
export const IconTable = (p: IconProps) => (
  <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" /></Svg>
)
export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const IconMinus = (p: IconProps) => <Svg {...p}><path d="M5 12h14" /></Svg>
export const IconHome = (p: IconProps) => (
  <Svg {...p}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" /></Svg>
)
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></Svg>
)
export const IconKey = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16.5 6.5l2 2M14 9l2 2" /></Svg>
)
export const IconUser = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5" /></Svg>
)
export const IconGauge = (p: IconProps) => (
  <Svg {...p}><path d="M4.2 16.5a8.5 8.5 0 1 1 15.6 0" /><path d="m12 13 3.5-4" /><circle cx="12" cy="13" r="1.2" /></Svg>
)
export const IconSliders = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Svg>
)
export const IconShield = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-2.5Z" /><path d="m9 12 2 2 4-4" /></Svg>
)
export const IconSparkle = IconSpark
export const IconEye = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></Svg>
)
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 3.5 20.5 20.5M10.6 6a9.7 9.7 0 0 1 1.4-.1C18 5.9 21.5 12 21.5 12a17 17 0 0 1-3 3.7M6.6 6.9A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.2-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>
)
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
export const IconAlert = (p: IconProps) => (
  <Svg {...p}><path d="M12 4 21 19.5H3L12 4Z" /><path d="M12 10v4.5M12 17.2v.2" /></Svg>
)
export const IconRefresh = (p: IconProps) => (
  <Svg {...p}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" /><path d="M19.5 4v5h-5" /></Svg>
)
export const IconChevronRight = (p: IconProps) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>
export const IconChevronLeft = (p: IconProps) => <Svg {...p}><path d="m14.5 6-6 6 6 6" /></Svg>
export const IconExternal = (p: IconProps) => (
  <Svg {...p}><path d="M14 4.5h5.5V10M19.5 4.5 11 13M17.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10" /></Svg>
)
export const IconTrash = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7" /></Svg>
)
export const IconLogout = (p: IconProps) => (
  <Svg {...p}><path d="M14.5 4.5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4M10 16.5 14.5 12 10 7.5M14.5 12H4" /></Svg>
)
export const IconCrosshair = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></Svg>
)
export const IconWorld = IconGlobe

export function GoogleG({ size = 18 }: { size?: number }) {
  // The standard multicolour Google "G", unmodified (branding guidelines).
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
