import { assert } from 'asserts'
import * as d3 from 'd3'

import {
    compute_map_dimensions,
    compute_visible_coordinate_bounds,
    format_coordinate_axis_label,
} from '../frontend/ui/d3-map.tsx'


Deno.test('format_coordinate_axis_label formats degrees and minutes with hemisphere', () => {
    const north = format_coordinate_axis_label(1.5, 'latitude')
    assert(!(north instanceof Error))
    assert(north == "1°30'N")

    const south = format_coordinate_axis_label(-1.5, 'latitude')
    assert(!(south instanceof Error))
    assert(south == "1°30'S")

    const east = format_coordinate_axis_label(12, 'longitude')
    assert(!(east instanceof Error))
    assert(east == "12°00'E")

    const west = format_coordinate_axis_label(-123.25, 'longitude')
    assert(!(west instanceof Error))
    assert(west == "123°15'W")
})

Deno.test('format_coordinate_axis_label handles zero and rounding edge cases', () => {
    const zero_lat = format_coordinate_axis_label(0, 'latitude')
    assert(!(zero_lat instanceof Error))
    assert(zero_lat == "0°00'N")

    const single_digit_min = format_coordinate_axis_label(1 + 5 / 60, 'longitude')
    assert(!(single_digit_min instanceof Error))
    assert(single_digit_min == "1°05'E")

    const rollover = format_coordinate_axis_label(1.999999, 'latitude')
    assert(!(rollover instanceof Error))
    assert(rollover == "2°00'N")
})

Deno.test('format_coordinate_axis_label returns error for non-finite values', () => {
    const nan_result = format_coordinate_axis_label(Number.NaN, 'latitude')
    assert(nan_result instanceof Error)

    const inf_result = format_coordinate_axis_label(Number.POSITIVE_INFINITY, 'longitude')
    assert(inf_result instanceof Error)
})

Deno.test('compute_visible_coordinate_bounds returns expected bounds and handles invalid size', () => {
    const transform = d3.zoomIdentity.translate(200, 150).scale(1 << 12)
    const bounds = compute_visible_coordinate_bounds(transform, 400, 300)
    assert(!(bounds instanceof Error))
    assert(bounds.longitude_domain[0] < 0)
    assert(bounds.longitude_domain[1] > 0)
    assert(bounds.latitude_domain[0] < 0)
    assert(bounds.latitude_domain[1] > 0)

    const invalid = compute_visible_coordinate_bounds(transform, 0, 300)
    assert(invalid instanceof Error)
})

Deno.test('compute_map_dimensions computes plot dimensions and clamps minimum', () => {
    const valid = compute_map_dimensions({ width: 500, height: 400 })
    assert(valid.svg_width == 500)
    assert(valid.svg_height == 400)
    assert(valid.plot_width < 500 && valid.plot_width > 0)
    assert(valid.plot_height < 400 && valid.plot_height > 0)

    const tiny = compute_map_dimensions({ width: 5, height: 5 })
    assert(tiny.plot_width == 1)
    assert(tiny.plot_height == 1)
})
