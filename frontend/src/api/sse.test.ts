import { describe, expect, it } from 'vitest'
import { createSseParser, type SseEvent } from './sse'

const STREAM =
  'event: status\ndata: {"stage":"interpreting"}\n\n' +
  ': keep-alive\n\n' +
  'event: progress\ndata: {"countries":12}\n\n' +
  'event: result\ndata: {"slug":"abc","meta":{"title":"x\\ny"}}\n\n'

function collect(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = []
  const parse = createSseParser((e) => events.push(e))
  chunks.forEach(parse)
  return events
}

describe('SSE parser', () => {
  it('parses a whole stream', () => {
    const events = collect([STREAM])
    expect(events.map((e) => e.event)).toEqual(['status', 'progress', 'result'])
    expect(JSON.parse(events[2].data).slug).toBe('abc')
  })

  it('is indifferent to chunk boundaries', () => {
    for (const size of [1, 2, 5, 17, 64]) {
      const chunks = []
      for (let i = 0; i < STREAM.length; i += size) chunks.push(STREAM.slice(i, i + size))
      expect(collect(chunks)).toEqual(collect([STREAM]))
    }
  })

  it('handles CRLF line endings and multi-line data', () => {
    const events = collect(['event: error\r\ndata: line one\r\ndata: line two\r\n\r\n'])
    expect(events).toEqual([{ event: 'error', data: 'line one\nline two' }])
  })

  it('ignores comments and waits for complete events', () => {
    const events = collect([': ping\n\n', 'event: status\ndata: {"a":1}'])
    expect(events).toEqual([])
  })
})
