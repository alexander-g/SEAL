import { assert } from 'asserts'

import {
    compute_time_domain,
    compute_signal_y_domain,
    compute_hover_position_from_mouse,
    compute_x_coordinate_for_time,
    type SignalPlotData,
} from '../frontend/ui/d3-signal-plot.tsx'
import {
    should_show_signal_plot_x_axis,
    type MSEED_SignalPlotData,
} from '../frontend/ui/mseed-signal-plot.tsx'
import {
    should_show_spectrogram_x_axis,
} from '../frontend/ui/mseed-spectrogram.tsx'



Deno.test('should_show_signal_plot_x_axis hides x-axis for consecutive plots with same time domain', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const item: MSEED_SignalPlotData = {
        data:              new Float32Array([0, 1, 2, 3]),
        start_time:        start_time,
        sample_rate_hz:    1,
        slice_start_index: 0,
        code:              'XX.STA1..HHZ',
    }
    const plot_data: MSEED_SignalPlotData[] = [item, { ...item, code: 'XX.STA2..HHZ' }]
    assert(!should_show_signal_plot_x_axis(plot_data, 0))
    assert(should_show_signal_plot_x_axis(plot_data, 1))
})

Deno.test('should_show_signal_plot_x_axis shows x-axis when next plot time domain differs', () => {
    const item0: MSEED_SignalPlotData = {
        data:              new Float32Array([0, 1, 2, 3]),
        start_time:        new Date('2024-01-01T00:00:00Z'),
        sample_rate_hz:    1,
        slice_start_index: 0,
        code:              'XX.STA1..HHZ',
    }
    const item1: MSEED_SignalPlotData = {
        ...item0,
        start_time: new Date('2024-01-01T00:05:00Z'),
    }
    const plot_data: MSEED_SignalPlotData[] = [item0, item1]
    assert(should_show_signal_plot_x_axis(plot_data, 0))
    assert(should_show_signal_plot_x_axis(plot_data, 1))
})

Deno.test('should_show_signal_plot_x_axis handles single plot and out-of-range index', () => {
    const item: MSEED_SignalPlotData = {
        data:              new Float32Array([0, 1]),
        start_time:        new Date('2024-01-01T00:00:00Z'),
        sample_rate_hz:    1,
        slice_start_index: 0,
        code:              'XX.STA1..HHZ',
    }
    assert(should_show_signal_plot_x_axis([item], 0))
    assert(!should_show_signal_plot_x_axis([item], 5))
})

Deno.test('should_show_spectrogram_x_axis hides x-axis for consecutive plots with same t_axis', () => {
    const t0 = new Date('2024-01-01T00:00:00Z')
    const t1 = new Date('2024-01-01T00:05:00Z')
    const axes: (Date[] | null)[] = [[t0, t1], [t0, t1]]
    assert(!should_show_spectrogram_x_axis(axes, 0))
    assert(should_show_spectrogram_x_axis(axes, 1))
})

Deno.test('should_show_spectrogram_x_axis shows x-axis when next plot t_axis differs', () => {
    const t0 = new Date('2024-01-01T00:00:00Z')
    const t1 = new Date('2024-01-01T00:05:00Z')
    const t2 = new Date('2024-01-01T00:10:00Z')
    const axes: (Date[] | null)[] = [[t0, t1], [t1, t2]]
    assert(should_show_spectrogram_x_axis(axes, 0))
    assert(should_show_spectrogram_x_axis(axes, 1))
})

Deno.test('should_show_spectrogram_x_axis handles null entries and invalid index', () => {
    const t0 = new Date('2024-01-01T00:00:00Z')
    const t1 = new Date('2024-01-01T00:05:00Z')
    const axes: (Date[] | null)[] = [[t0, t1], null]
    assert(should_show_spectrogram_x_axis(axes, 0))
    assert(!should_show_spectrogram_x_axis(axes, 1))
    assert(!should_show_spectrogram_x_axis(axes, -1))
})



Deno.test('compute_x_coordinate_for_time maps in-bounds time to plot x coordinate', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const end_time   = new Date('2024-01-01T00:00:10Z')
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
        x_domain:       [start_time, end_time],
    }
    const x = compute_x_coordinate_for_time(
        new Date('2024-01-01T00:00:05Z'),
        plot_data,
        200,
    )
    assert(x == 100)
})

Deno.test('compute_x_coordinate_for_time returns null when out of bounds or invalid', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const end_time   = new Date('2024-01-01T00:00:10Z')
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
        x_domain:       [start_time, end_time],
    }
    assert(compute_x_coordinate_for_time(new Date('2023-12-31T23:59:59Z'), plot_data, 200) == null)
    assert(compute_x_coordinate_for_time(new Date('2024-01-01T00:00:11Z'), plot_data, 200) == null)
    assert(compute_x_coordinate_for_time(null, plot_data, 200) == null)
    assert(compute_x_coordinate_for_time(start_time, null, 200) == null)
    assert(compute_x_coordinate_for_time(start_time, plot_data, 0) == null)
})

Deno.test('compute_x_coordinate_for_time handles domain boundary timestamps', () => {
    const start_time = new Date('2024-01-01T00:00:00Z')
    const end_time   = new Date('2024-01-01T00:00:10Z')
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
        x_domain:       [start_time, end_time],
    }
    assert(compute_x_coordinate_for_time(start_time, plot_data, 200) == 0)
    assert(compute_x_coordinate_for_time(end_time, plot_data, 200) == 200)
})



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

Deno.test('compute_hover_position_from_mouse maps mouse coordinates to domain', () => {
    const start_time: Date = new Date('2024-01-01T00:00:00Z')
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
        x_domain:       [start_time, new Date(start_time.getTime() + 1000)],
        y_domain:       [0, 10],
    }
    const hover = compute_hover_position_from_mouse(50, 25, 100, 50, plot_data)
    assert(hover != null)
    assert(hover.x.getTime() == start_time.getTime() + 500)
    assert(hover.y == 5)
})

Deno.test('compute_hover_position_from_mouse returns null for out-of-bounds or missing data', () => {
    const start_time: Date = new Date('2024-01-01T00:00:00Z')
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
    }
    assert(compute_hover_position_from_mouse(10, 10, 100, 50, null) == null)
    assert(compute_hover_position_from_mouse(-1, 10, 100, 50, plot_data) == null)
    assert(compute_hover_position_from_mouse(10, 51, 100, 50, plot_data) == null)
    assert(compute_hover_position_from_mouse(0, 0, 0, 50, plot_data) == null)
})

Deno.test('compute_hover_position_from_mouse handles boundary coordinates', () => {
    const start_time: Date = new Date('2024-01-01T00:00:00Z')
    const end_time: Date = new Date(start_time.getTime() + 1000)
    const plot_data: SignalPlotData = {
        data:           new Float32Array([0, 10]),
        start_time:     start_time,
        sample_rate_hz: 1,
        x_domain:       [start_time, end_time],
        y_domain:       [0, 10],
    }
    const top_left = compute_hover_position_from_mouse(0, 0, 100, 50, plot_data)
    assert(top_left != null)
    assert(top_left.x.getTime() == start_time.getTime())
    assert(top_left.y == 10)

    const bottom_right = compute_hover_position_from_mouse(100, 50, 100, 50, plot_data)
    assert(bottom_right != null)
    assert(bottom_right.x.getTime() == end_time.getTime())
    assert(bottom_right.y == 0)
})
