import { KEY_HEADER } from '../state/keyStorage'
import { createSseParser } from './sse'
import type {
  ApiErrorBody,
  AppConfig,
  Examples,
  HistoryItem,
  KeyCheck,
  MapResult,
  Method,
  RebinResult,
} from './types'

/** Every mutating request carries this header (backend CSRF check, docs/DECISIONS.md D-24). */
const BASE_HEADERS: Record<string, string> = { 'X-Requested-With': 'terrachrome' }

export class ApiError extends Error {
  status: number
  code: string
  body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed (${status})`)
    this.status = status
    this.code = body.code || 'http_error'
    this.body = body
  }
}

export class NetworkError extends Error {
  code = 'network'
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = { code: 'http_error', message: `Request failed (${res.status})` }
  try {
    const json = await res.json()
    if (json && typeof json === 'object' && 'code' in json) body = json as ApiErrorBody
  } catch {
    /* non-JSON error page */
  }
  return new ApiError(res.status, body)
}

/** The visitor's OpenAI key goes in X-OpenAI-Key, only on requests that need it. */
function addKeyHeader(headers: Record<string, string>, apiKey?: string | null): void {
  if (apiKey) headers[KEY_HEADER] = apiKey
}

async function request<T>(path: string, init: RequestInit = {}, apiKey?: string | null): Promise<T> {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...(init.headers as Record<string, string>) }
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  addKeyHeader(headers, apiKey)
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers })
  } catch {
    throw new NetworkError('Network error: check your connection and try again.')
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  examples: () => request<Examples>('/api/examples'),
  getMap: (slug: string) => request<MapResult>(`/api/maps/${encodeURIComponent(slug)}`),
  rebin: (slug: string, method: Method, classes: number) =>
    request<RebinResult>(`/api/maps/${encodeURIComponent(slug)}/rebin`, {
      method: 'POST',
      body: JSON.stringify({ method, classes }),
    }),
  history: () => request<{ items: HistoryItem[] }>('/api/history'),
  clearHistory: () => request<{ deleted: number }>('/api/history', { method: 'DELETE' }),
  validateKey: (apiKey: string) => request<KeyCheck>('/api/key/validate', { method: 'POST' }, apiKey),
}

export interface StreamHandlers {
  onStatus?: (stage: string, message: string) => void
  onProgress?: (countries: number) => void
}

/** POST /api/maps and follow the SSE stream to its final `result` (or throw on `error`). */
export async function streamMap(
  query: string,
  { apiKey, signal, region, ...handlers }: StreamHandlers & { apiKey?: string | null; signal?: AbortSignal; region?: string },
): Promise<MapResult> {
  const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  addKeyHeader(headers, apiKey)
  let res: Response
  try {
    res = await fetch('/api/maps', { method: 'POST', headers, body: JSON.stringify({ query, region: region ?? 'world' }), credentials: 'same-origin', signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new NetworkError('Network error: check your connection and try again.')
  }
  if (!res.ok) throw await parseError(res)
  if (!res.body) throw new NetworkError('The server closed the connection.')

  let result: MapResult | null = null
  let failure: ApiError | null = null
  const parse = createSseParser(({ event, data }) => {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (event === 'status') handlers.onStatus?.(String(payload.stage ?? ''), String(payload.message ?? ''))
    else if (event === 'progress') handlers.onProgress?.(Number(payload.countries ?? 0))
    else if (event === 'result') result = payload as unknown as MapResult
    else if (event === 'error') {
      const status = typeof payload.status === 'number' ? payload.status : 502
      failure = new ApiError(status, payload as unknown as ApiErrorBody)
    }
  })

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      parse(value)
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new NetworkError('The connection dropped while the map was being generated.')
  }
  if (failure) throw failure
  if (!result) throw new NetworkError('The map stream ended unexpectedly.')
  return result
}
