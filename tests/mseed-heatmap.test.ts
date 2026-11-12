import { assert } from 'asserts'
import { create_station_palette } from '../frontend/ui/mseed-heatmap.tsx'
import { compute_heatmap_x_for_time } from '../frontend/ui/mseed-heatmap-overlays.tsx'





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


