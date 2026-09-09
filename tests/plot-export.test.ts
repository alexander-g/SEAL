import { assert } from 'asserts'

import {
    compute_stacked_export_layout,
    normalize_device_pixel_ratio,
} from '../frontend/ui/plot-export.ts'




Deno.test('compute_stacked_export_layout returns error on empty list', () => {
    const layout = compute_stacked_export_layout([])
    assert(layout instanceof Error)
})

Deno.test('compute_stacked_export_layout stacks multiple plot sizes', () => {
    const layout = compute_stacked_export_layout([
        { width: 300, height: 200 },
        { width: 500, height: 100 },
        { width: 400, height: 50 },
    ])
    assert(!(layout instanceof Error))

    assert(layout.width == 500)
    assert(layout.height == 350)
    assert(layout.offsets.length == 3)

    assert(layout.offsets[0]?.x == 0)
    assert(layout.offsets[0]?.y == 0)
    assert(layout.offsets[1]?.x == 0)
    assert(layout.offsets[1]?.y == 200)
    assert(layout.offsets[2]?.x == 0)
    assert(layout.offsets[2]?.y == 300)
})

Deno.test('normalize_device_pixel_ratio defaults and clamps invalid values', () => {
    assert(normalize_device_pixel_ratio(undefined) == 1)
    assert(normalize_device_pixel_ratio(Number.NaN) == 1)
    assert(normalize_device_pixel_ratio(Infinity) == 1)
    assert(normalize_device_pixel_ratio(0) == 1)
})

Deno.test('normalize_device_pixel_ratio keeps values above one', () => {
    assert(normalize_device_pixel_ratio(1) == 1)
    assert(normalize_device_pixel_ratio(1.5) == 1.5)
    assert(normalize_device_pixel_ratio(2) == 2)
})
