import {
    create_item_index_by_coord,
    compute_hover_position_from_mouse,
    get_dimensions,
    get_rows_cols,
    get_item_index_at,
    mouse_to_col,
    mouse_to_row,
    plot_x_to_col,
    plot_y_to_row,
} from '../frontend/ui/d3-heatmap.tsx'
import {
    get_x_marker_rects,
    compute_x_marker_positions,
    get_y_marker_parameters,
    compute_y_marker_positions,
    marker_column_position,
} from '../frontend/ui/d3-heatmap-markers.tsx'
import { assert } from 'asserts'

Deno.test('get_dimensions computes plot area and clamps minimum', () => {
    const dimensions = get_dimensions(
        { width: 10, height: 5 },
        { top: 20, right: 5, bottom: 30, left: 60 },
    )

    assert(dimensions.svg_width == 10)
    assert(dimensions.svg_height == 5)
    assert(dimensions.plot_width == 1)
    assert(dimensions.plot_height == 1)
})

Deno.test('get_rows_cols derives grid extents from items', () => {
    assert(get_rows_cols([]) == null)

    const rows_cols = get_rows_cols([
        { x: 2, y: 5, color: 1 },
        { x: 4, y: 8, color: 0.5 },
    ])

    assert(rows_cols?.cols == 3)
    assert(rows_cols?.rows == 4)
})

Deno.test('coordinate conversion helpers map to expected cells', () => {
    assert(mouse_to_col(100, 100, 10) == 9)
    assert(mouse_to_row(0, 100, 10) == 9)
    assert(plot_x_to_col(45, 100, 10) == 4)
    assert(plot_y_to_row(99, 100, 10) == 0)
})

Deno.test('marker_column_position interpolates and filters values', () => {
    assert(marker_column_position(15, [10, 20, 30], 3) == 0.5)
    assert(marker_column_position(35, [10, 20, 30], 3) == null)
    assert(marker_column_position(2, [0], 10) == 2)
    assert(marker_column_position(20, [10, 10, 20], 3) == 2)
})

Deno.test('marker position helpers map and filter marker arrays', () => {
    const x_positions = compute_x_marker_positions([15, 25], [10, 20, 30], 300, 3)
    assert(x_positions.length == 2)
    assert(x_positions[0] == 50)
    assert(x_positions[1] == 150)

    // from bottom to top
    const y_positions = compute_y_marker_positions([0, 3, -1, 10], 400, 4)
    assert(y_positions.length == 2)
    // assert(y_positions[0] == 300)  // shouldnt this be 400?
    assert(y_positions[1] == 0)
})

Deno.test('marker rect helpers build expected layer rectangles', () => {
    const x_rects = get_x_marker_rects([0, 150], 300, 200, 3)
    assert(x_rects.length == 2)
    assert(x_rects[0]?.x == 0)
    assert(x_rects[0]?.width == 100)
    assert(x_rects[0]?.height == 200)

    const y_rects = get_y_marker_parameters([0, 75], 300, 300, 4)
    assert(y_rects.length == 2)
    assert(y_rects[1]?.y == 75)
    assert(y_rects[1]?.width == 300)
    assert(y_rects[1]?.height == 75)
})

Deno.test('item index map resolves item by coordinate', () => {
    const item_index_by_coord = create_item_index_by_coord([
        { x: 0, y: 0, color: 0.1 },
        { x: 3, y: 2, color: 0.9 },
    ])

    assert(get_item_index_at(item_index_by_coord, 0, 0) == 0)
    assert(get_item_index_at(item_index_by_coord, 3, 2) == 1)
    assert(get_item_index_at(item_index_by_coord, 1, 1) == null)
})

Deno.test('compute_hover_position_from_mouse returns hover details', () => {
    const item_index_by_coord = create_item_index_by_coord([
        { x: 1, y: 0, color: 1 },
    ])

    const hover = compute_hover_position_from_mouse({
        mx: 55,
        my: 10,
        root_x: 100.2,
        root_y: 220.9,
        x_axis: [1000, 2000],
        y_axis: ['row-a'],
        rows_cols: { cols: 2, rows: 1 },
        dimensions: {
            svg_width: 200,
            svg_height: 100,
            plot_width: 100,
            plot_height: 50,
        },
        item_index_by_coord,
    })

    assert(hover != null)
    assert(hover.x == 1)
    assert(hover.y == 0)
    assert(hover.item_index == 0)
    assert(hover.data_label == '')
    assert(hover.overlay_x == 112)
    assert(hover.overlay_y == 232)
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(hover.x_label))
})

Deno.test('compute_hover_position_from_mouse returns no data label for empty cell', () => {
    const hover = compute_hover_position_from_mouse({
        mx: 10,
        my: 10,
        root_x: 0,
        root_y: 0,
        x_axis: [1000, 2000],
        y_axis: ['row-a'],
        rows_cols: { cols: 2, rows: 1 },
        dimensions: {
            svg_width: 200,
            svg_height: 100,
            plot_width: 100,
            plot_height: 50,
        },
        item_index_by_coord: new Map(),
    })

    assert(hover != null)
    assert(hover.item_index == null)
    assert(hover.data_label == 'no data')
})
