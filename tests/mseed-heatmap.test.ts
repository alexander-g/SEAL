import { assert } from 'asserts'
import { create_station_palette } from '../frontend/ui/mseed-heatmap.tsx'
import {
    compute_heatmap_x_for_time,
    XAxisTimeIndicator,
} from '../frontend/ui/mseed-heatmap-overlays.tsx'





Deno.test('create_station_palette: different outputs for A02 and A03', () => {
    const color_A02 = create_station_palette('A02')
    const color_A03 = create_station_palette('A03')

    assert( 
        color_A02.b != color_A03.b
        || color_A02.g != color_A03.g
        || color_A02.r != color_A03.r
    )
})

Deno.test('compute_heatmap_x_for_time maps in-bounds time to plot x coordinate', () => {
    const x_axis: Date[] = [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:00:10Z'),
        new Date('2024-01-01T00:00:20Z'),
    ]
    const x = compute_heatmap_x_for_time(
        new Date('2024-01-01T00:00:05Z'),
        x_axis,
        300,
    )
    assert(x == 50)
})

Deno.test('compute_heatmap_x_for_time returns null when out of bounds or invalid', () => {
    const x_axis: Date[] = [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:00:10Z'),
    ]
    assert(compute_heatmap_x_for_time(new Date('2023-12-31T23:59:59Z'), x_axis, 200) == null)
    assert(compute_heatmap_x_for_time(new Date('2024-01-01T00:00:11Z'), x_axis, 200) == null)
    assert(compute_heatmap_x_for_time(null, x_axis, 200) == null)
    assert(compute_heatmap_x_for_time(x_axis[0]!, [], 200) == null)
    assert(compute_heatmap_x_for_time(x_axis[0]!, x_axis, 0) == null)
})

Deno.test('compute_heatmap_x_for_time handles boundary timestamps', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const end_time   = new Date('2024-01-01T00:00:10Z')
    const x_axis: Date[] = [start_time, end_time]
    assert(compute_heatmap_x_for_time(start_time, x_axis, 200) == 0)
    assert(compute_heatmap_x_for_time(end_time, x_axis, 200) == 100)
})

Deno.test('XAxisTimeIndicator renders datetime badge by default', () => {
    const element = XAxisTimeIndicator({
        x:           50,
        time:        new Date('2024-01-01T00:00:05Z'),
        plot_width:  200,
        plot_height: 100,
    })
    assert(element != null)
    const children = Array.isArray(element.props.children)
        ? element.props.children.filter(Boolean)
        : [element.props.children]
    assert(children.length == 2)
})

Deno.test('XAxisTimeIndicator omits datetime badge when show_badge is false', () => {
    const element = XAxisTimeIndicator({
        x:           50,
        time:        new Date('2024-01-01T00:00:05Z'),
        plot_width:  200,
        plot_height: 100,
        show_badge:  false,
    })
    assert(element != null)
    const children = Array.isArray(element.props.children)
        ? element.props.children.filter(Boolean)
        : [element.props.children]
    assert(children.length == 1)
})

Deno.test('XAxisTimeIndicator returns null for non-positive plot dimensions', () => {
    assert(XAxisTimeIndicator({
        x:           50,
        time:        new Date('2024-01-01T00:00:05Z'),
        plot_width:  0,
        plot_height: 100,
    }) == null)
})


