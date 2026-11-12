import { describe, expect, it } from 'vitest'
import type { Method } from '../api/types'
import { assign, computeMapBins, computeStats, legendFor } from './binning'

// Reference outputs from backend/app/binning.py (compute_map_bins, legend, assign) for the same inputs.
const PYTHON: { values: number[]; method: Method; classes: number; edges: number[]; classesOut: number; methodOut: Method; fallback: string | null; zero: boolean; counts: number[]; bins: number[] }[] = [
  { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 1000], method: 'quantile', classes: 5, edges: [1, 3.2, 5.4, 7.6, 9.8, 1000], classesOut: 5, methodOut: 'quantile', fallback: null, zero: false, counts: [3, 2, 2, 2, 3], bins: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4] },
  { values: [0, 0, 1, 5, 20, 300, 4000], method: 'log', classes: 4, edges: [1, 7.952707287670506, 63.245553203367585, 502.9733718731742, 4000], classesOut: 4, methodOut: 'log', fallback: null, zero: true, counts: [2, 1, 1, 1], bins: [-2, -2, 0, 0, 1, 2, 3] },
  { values: [-5, 0, 3, 8, 12], method: 'log', classes: 3, edges: [-5, 0.9999999999999998, 6.333333333333332, 12], classesOut: 3, methodOut: 'quantile', fallback: 'log scale needs values of zero or more', zero: false, counts: [2, 1, 2], bins: [0, 0, 1, 2, 2] },
  { values: [2, 4, 6, 8, 10], method: 'equal', classes: 4, edges: [2, 4, 6, 8, 10], classesOut: 4, methodOut: 'equal', fallback: null, zero: false, counts: [1, 1, 1, 2], bins: [0, 1, 2, 3, 3] },
  { values: [1, 1, 1, 2], method: 'quantile', classes: 7, edges: [1, 2], classesOut: 1, methodOut: 'quantile', fallback: 'too many tied values for that many quantile classes', zero: false, counts: [4], bins: [0, 0, 0, 0] },
  { values: [3, 3, 3], method: 'equal', classes: 5, edges: [3, 3], classesOut: 1, methodOut: 'equal', fallback: 'all values are equal', zero: false, counts: [3], bins: [0, 0, 0] },
]

describe('browser binning matches the backend', () => {
  it.each(PYTHON)('$method with $classes classes on $values', (c) => {
    const b = computeMapBins(c.values, c.method, c.classes)
    expect(b.method).toBe(c.methodOut)
    expect(b.requested_method).toBe(c.method)
    expect(b.classes).toBe(c.classesOut)
    expect(b.fallback_reason).toBe(c.fallback)
    expect(b.zero_class).toBe(c.zero)
    expect(b.edges).toHaveLength(c.edges.length)
    b.edges.forEach((e, i) => expect(e).toBeCloseTo(c.edges[i], 9))
    expect(legendFor(c.values, b).map((l) => l.count)).toEqual(c.counts)
    expect(c.values.map((v) => assign(v, b))).toEqual(c.bins)
  })

  it('reports no data for an empty map and clamps the class count', () => {
    expect(computeMapBins([], 'quantile', 7)).toMatchObject({ classes: 0, fallback_reason: 'no data' })
    expect(computeMapBins([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'equal', 40).requested_classes).toBe(9)
  })

  it('computes stats like processing.compute_stats', () => {
    expect(computeStats([4, 0, 2, 10], 10)).toEqual({ count: 4, na_count: 6, zero_count: 1, total: 10, min: 0, max: 10, median: 3, mean: 4 })
    expect(computeStats([], 5)).toMatchObject({ count: 0, na_count: 5, median: null })
  })
})
