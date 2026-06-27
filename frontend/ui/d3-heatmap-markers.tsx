import type { Signal, JSX } from '../dep.ts'

/** Coordinates and parameters for <rect> elements that represent markers */
export type MarkerParameters = {
    key:    string,
    x:      number,
    y:      number,
    width:  number,
    height: number,
    fill:   string,
    fill_opacity: string,
}

/** Convert marker value to a column index using x-axis interpolation */
export function marker_column_position(
    marker: number,
    x_axis: number[],
    cols: number,
): number | null {
    if(!Number.isFinite(marker))
        return null
    if(x_axis.length < 2) {
        if(marker >= 0 && marker <= cols)
            return marker
        return null
    }

    const first_x: number = x_axis[0]!
    const last_x: number = x_axis[x_axis.length - 1]!
    if(marker < first_x || marker > last_x) {
        if(marker >= 0 && marker <= cols)
            return marker
        return null
    }

    let left: number = 0
    let right: number = x_axis.length - 1
    while(left < right) {
        const mid: number = Math.floor((left + right) / 2)
        const mid_value: number = x_axis[mid]!
        if(mid_value < marker)
            left = mid + 1
        else
            right = mid
    }

    const upper: number = left
    if(upper <= 0)
        return 0

    const lower: number = upper - 1
    const lower_value: number = x_axis[lower]!
    const upper_value: number = x_axis[upper]!
    const delta: number = upper_value - lower_value
    if(delta == 0)
        return lower

    const ratio: number = (marker - lower_value) / delta
    return lower + ratio
}

/** Map marker values from x-axis space to x plot coordinates */
export function compute_x_marker_positions(
    x_values:   number[] | undefined,
    x_axis:     number[],
    plot_width: number,
    n_cols:     number,
): number[] {
    if(x_values == undefined || x_values.length == 0)
        return []
    if(n_cols <= 0)
        return []

    const positions: number[] = []
    for(const value of x_values) {
        const col_position: number | null = marker_column_position(value, x_axis, n_cols)
        if(col_position == null)
            continue

        const x_position: number = (col_position / n_cols) * plot_width
        positions.push(x_position)
    }
    return positions
}

/** Map marker values from y-axis space to y plot coordinates */
export function compute_y_marker_positions(
    y_values:    number[] | undefined,
    plot_height: number,
    n_rows:      number,
): number[] {
    if(y_values == undefined || y_values.length == 0)
        return []
    if(n_rows <= 0)
        return []

    const positions: number[] = []
    for(const value of y_values) {
        if(!Number.isFinite(value))
            continue
        if(value < 0 || value >= n_rows)
            continue

        const row_from_top:number = n_rows - 1 - value
        positions.push((row_from_top / n_rows) * plot_height)
    }
    return positions
}

/** Build x marker rectangle models in plot space */
export function get_x_marker_rects(
    marker_positions: number[],
    plot_width: number,
    plot_height: number,
    cols: number,
): MarkerParameters[] {
    if(cols <= 0)
        return []

    const marker_width: number = plot_width / cols
    return marker_positions.map((x: number, marker_index: number) => ({
        key: `${marker_index}-${x}`,
        x,
        y: 0,
        width: marker_width,
        height: plot_height,
        fill: '#4cc9f0',
        fill_opacity: '0.8',
    }))
}

/** Build y marker rectangle models in plot space */
export function get_y_marker_parameters(
    marker_positions: number[],
    plot_width: number,
    plot_height: number,
    rows: number,
): MarkerParameters[] {
    if(rows <= 0)
        return []

    const marker_height: number = plot_height / rows
    return marker_positions.map((y: number, marker_index: number) => ({
        key: `${marker_index}-${y}`,
        x: 0,
        y,
        width: plot_width,
        height: marker_height,
        fill: '#4cc9f0',
        fill_opacity: '0.3',
    }))
}

/** Marker layer with vertical lines/rectangles */
export function VerticalMarkerLayer(props: {
    $x_values?:   Readonly<Signal<number[]>>,
    $x_axis:      Readonly<Signal<number[]>>,
    $plot_width:  Readonly<Signal<number>>,
    $plot_height: Readonly<Signal<number>>,
    $cols:        Readonly<Signal<number>>,
}): JSX.Element {
    const marker_positions_within_plot:number[] = compute_x_marker_positions(
        props.$x_values?.value ?? [],
        props.$x_axis.value,
        props.$plot_width.value,
        props.$cols.value,
    )

    const marker_rects:MarkerParameters[] =  get_x_marker_rects(
        marker_positions_within_plot,
        props.$plot_width.value,
        props.$plot_height.value,
        props.$cols.value,
    )
    return <MarkerRects rects={ marker_rects } />
}

/** Marker layer with horizontal lines/rectangles */
export function HorizontalMarkerLayer(props: {
    $y_values?:   Readonly<Signal<number[]>>,
    $plot_width:  Readonly<Signal<number>>,
    $plot_height: Readonly<Signal<number>>,
    $rows:        Readonly<Signal<number>>,
}): JSX.Element {
    const marker_positions_within_plot:number[] = compute_y_marker_positions(
        props.$y_values?.value,
        props.$plot_height.value,
        props.$rows.value,
    )

    const marker_rects:MarkerParameters[] = get_y_marker_parameters(
        marker_positions_within_plot,
        props.$plot_width.value,
        props.$plot_height.value,
        props.$rows.value,
    )
    return <MarkerRects rects={ marker_rects } />
}


/** Render a marker rectangle list as SVG <rect> elements */
function MarkerRects(props: {
    rects: MarkerParameters[],
}): JSX.Element[] {
    return props.rects.map((rect: MarkerParameters) => (
        <rect
            key = {rect.key}
            x = {`${rect.x}`}
            y = {`${rect.y}`}
            width  = {`${rect.width}`}
            height = {`${rect.height}`}
            fill = {rect.fill}
            fill-opacity = {rect.fill_opacity}
            stroke = 'none'
        />
    ))
}
