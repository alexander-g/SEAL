import { assert } from 'asserts'

import {
    compute_time_domain,
    compute_signal_y_domain,
} from '../frontend/ui/d3-signal-plot.tsx'



Deno.test('compute_time_domain returns valid time range', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const domain = compute_time_domain(start_time, 2, 6, 2)
    assert(!(domain instanceof Error))
    assert(domain[0].getTime() == start_time.getTime() + 1000)
    assert(domain[1].getTime() == start_time.getTime() + 2500)
})

Deno.test('compute_time_domain returns error for invalid inputs', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const invalid_rate = compute_time_domain(start_time, 0, 2, 0)
    assert(invalid_rate instanceof Error)

    const empty_range = compute_time_domain(start_time, 3, 3, 10)
    assert(empty_range instanceof Error)
})

Deno.test('compute_signal_y_domain enforces minimum std range', () => {
    const full_data = new Float32Array([9, 10, 11, 12])
    const sliced_data = new Float32Array([10, 10])
    const domain = compute_signal_y_domain(full_data, sliced_data)
    assert(!(domain instanceof Error))
    assert(domain[0] < 10)
    assert(domain[1] > 10)
})

Deno.test('compute_signal_y_domain uses sliced min max when valid', () => {
    const full_data = new Float32Array([10, 20, 10, 20])
    const sliced_data = new Float32Array([10, 20])
    const domain = compute_signal_y_domain(full_data, sliced_data)
    assert(!(domain instanceof Error))
    assert(domain[0] == 10)
    assert(domain[1] == 20)
})
