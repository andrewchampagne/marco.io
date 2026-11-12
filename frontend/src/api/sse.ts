/**
 * Minimal server-sent-events parser for a fetch() body stream (EventSource can't POST).
 * Handles events split across chunk boundaries, CRLF line endings, comments (keep-alives) and
 * multi-line data fields.
 */

export interface SseEvent {
  event: string
  data: string
}

export function createSseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n?/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length) onEvent({ event, data: data.join('\n') })
      boundary = buffer.indexOf('\n\n')
    }
  }
}
