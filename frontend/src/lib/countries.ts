/** The canonical country list (data/countries.json), shared with the backend and the LLM prompt. */
import raw from '@data/countries.json'

export interface Country {
  iso3: string
  iso2: string | null
  name: string
  aliases: string[]
  continent: string | null
  subregion: string | null
  sovereign: string | null
  area_km2: number
  tiny: boolean
  marker: [number, number]
  bbox: [number, number, number, number]
}

export const COUNTRIES: Country[] = (raw as unknown as { countries: Country[] }).countries
export const COUNTRY_BY_ISO3: Record<string, Country> = Object.fromEntries(COUNTRIES.map((c) => [c.iso3, c]))

export function countryName(iso3: string): string {
  return COUNTRY_BY_ISO3[iso3]?.name ?? iso3
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const INDEX = COUNTRIES.map((c) => ({
  country: c,
  name: fold(c.name),
  aliases: c.aliases.map(fold),
}))

/** Prefix matches on name first, then on aliases, then substring matches; ISO codes match exactly. */
export function searchCountries(query: string, limit = 8): Country[] {
  const q = fold(query)
  if (!q) return []
  const scored: [number, Country][] = []
  for (const entry of INDEX) {
    let score = -1
    if (entry.country.iso3.toLowerCase() === q || entry.country.iso2?.toLowerCase() === q) score = 100
    else if (entry.name.startsWith(q)) score = 90 - entry.name.length / 100
    else if (entry.aliases.some((a) => a.startsWith(q))) score = 70
    else if (entry.name.includes(q)) score = 50
    else if (entry.aliases.some((a) => a.includes(q))) score = 30
    if (score >= 0) scored.push([score, entry.country])
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, c]) => c)
}
