import { JSX, Signal } from '../dep.ts'

import type { MSeedMetadata }     from "../lib/mseed-parsing.ts";
import type { DataSignalSlice }   from './mseed-heatmap.tsx'
import type {
    DataItem,
    HoverPosition,
    RowsCols,
    Size,
} from './d3-heatmap.tsx'
import { marker_column_position } from './d3-heatmap-markers.tsx'
import {
    compute_x_coordinate_for_time,
    type SignalPlotData,
} from './d3-signal-plot.tsx'

import {
    find_exact,
    find_last_below,
    strftime_ISO8601_datetime,
} from "../lib/util.ts"
import { combine_mseed_codes }         from '../lib/mseed-parsing.ts'



/** A collection of rects in the heatmap, indicating which segments are selected */
export function MSEED_SelectionOverlays(props:{
    $x_axis:    Readonly<Signal<Date[]>>,
    $y_axis:    Readonly<Signal<string[]>>,
    $mseeds:    Readonly<Signal<MSeedMetadata[]>>,
    $slices:    Readonly<Signal<DataSignalSlice[]>>,
    $item_size: Readonly<Signal<Size>>,
    $n_rows:    Readonly<Signal<number>>,
}): JSX.Element[] {
    const x_axis:Date[]            = props.$x_axis.value
    const y_axis:string[]          = props.$y_axis.value
    const mseeds: MSeedMetadata[]  = props.$mseeds.value
    const slices:DataSignalSlice[] = props.$slices.value
    const item_size:Size           = props.$item_size.value
    const rows:number              = props.$n_rows.value

    if(slices == undefined)
        return []

    const x_axis_timestamps:number[] = x_axis.map(Number)

    const output:JSX.Element[] = []
    for(const slice of  slices) {
        // slice.end_time

        const item:MSeedMetadata|undefined = mseeds[slice.mseed_index]
        if(item == undefined)
            continue

        const code:string = combine_mseed_codes(item)
        const item_y:number|null = find_exact(y_axis, code)
        if(item_y == null)
            continue

        const item_x0:number|null = 
            find_last_below(x_axis_timestamps, Number(slice.start_time))
        const item_x1:number|null = 
            find_last_below(x_axis_timestamps, Number(slice.end_time))
        if(item_x0 == null || item_x1 == null)
            continue

        const x:number = item_size.width * (item_x0 + 1);
        const y:number = item_size.height * (rows - 1 - item_y)
        const w:number = Math.max(1, (item_x1 - item_x0)) * item_size.width

        output.push(
            <rect 
                x              = {x} 
                y              = {y} 
                width          = {w} 
                height         = {item_size.height} 
                fill           = "#f0f0f0"
                fill-opacity   = "0.3"
                stroke         = "none"
                pointer-events = "none"
            />
        )
    }
    return output
}


/** Show hover details in a fixed-size tooltip box */
export function HoverOverlay(props: {
    $position: Readonly<Signal<HoverPosition | null>>,
    $x_axis:   Readonly<Signal<Date[] | number[]>>,
    $y_axis:   Readonly<Signal<string[]>>,
}): JSX.Element | null {
    const hover:HoverPosition|null  = props.$position.value
    const x_axis:Date[] | number[]  = props.$x_axis.value
    const y_axis:string[]           = props.$y_axis.value
    if(hover == null)
        return null

    const x_value:Date | number | undefined = x_axis[hover.x]
    const y_value:string | undefined        = y_axis[hover.y]
    if(x_value == undefined || y_value == undefined)
        return null

    const x_date:Date = typeof x_value == 'number'
        ? new Date(x_value * 1000)
        : x_value
    const x_label:string    = strftime_ISO8601_datetime(x_date)
    const y_label:string    = y_value
    const data_label:string = (hover.item_index == null) ? 'no data' : ''

    return <g
        transform = {`translate(${hover.overlay_x},${hover.overlay_y})`}
        style = {{ pointerEvents: 'none', fontFamily:'sans' }}
    >
        <rect
            x = '0'
            y = '0'
            width = '200'
            height = '56'
            fill = '#000000'
            fill-opacity = '0.75'
            stroke = '#ffffff'
            stroke-opacity = '0.4'
        />
        <text x = '8' y = '17' fill = '#ffffff' font-size = '11'>
            {`${x_label}`}
        </text>
        <text x = '8' y = '33' fill = '#ffffff' font-size = '11'>
            {`${y_label}`}
        </text>
        <text x = '8' y = '49' fill = '#ffffff' font-size = '11'>
            {data_label}
        </text>
    </g>
}


/** Overlay of the size of one heatmap pixel at the current position of the cursor */
export function HoverMarker(props:{
    $position:  Readonly<Signal<HoverPosition|null>>,
    $plotsize:  Readonly<Signal<Size>>,
    $dataitems: Readonly<Signal<DataItem[]>>,
    $rowscols:  Readonly<Signal<RowsCols|null>>
}): JSX.Element|null {

    // NOTE: subscribing to signals here before early exit returns
    const {width, height}        = props.$plotsize.value;
    const item_index:number|null = props.$position.value?.item_index ?? null
    const data_items:DataItem[]  = props.$dataitems.value;
    const colsrows:RowsCols|null = props.$rowscols.value

    if(item_index == null || colsrows == null)
        return null;

    const item:DataItem|undefined = data_items[item_index];
    if(item == undefined)
        return null;

    const item_width:number  = width / colsrows.cols;
    const item_height:number = height / colsrows.rows;
    
    const x:number = item_width * item.x;
    const y:number = item_height * (colsrows.rows - 1 - item.y)

    return <rect
        x            = {`${x}`}
        y            = {`${y}`}
        width        = {`${item_width}`}
        height       = {`${item_height}`}
        fill         = "#f0f0f0"
        fill-opacity = "0.3"
        stroke       = "none"
        pointer-events = "none"
    />
}


/** Map a timestamp to an x coordinate within a heatmap plot, or null if out of bounds */
export function compute_heatmap_x_for_time(
    time:       Date | null,
    x_axis:     Date[] | number[],
    plot_width: number,
    zoom_k_x:   number = 1,
    zoom_tx:    number = 0,
): number | null {
    if(time == null || x_axis.length < 2 || plot_width <= 0)
        return null

    const x_seconds: number[] = x_axis.map(
        (v: Date | number) => typeof v == 'number' ? v : v.getTime() / 1000
    )
    const col: number | null = marker_column_position(
        time.getTime() / 1000,
        x_seconds,
        x_axis.length,
    )
    if(col == null)
        return null

    const base_x: number = (col / x_axis.length) * plot_width
    const x: number = base_x * zoom_k_x + zoom_tx
    if(!Number.isFinite(x) || x < 0 || x > plot_width)
        return null

    return x
}


/** Vertical cursor line and datetime badge at a given x coordinate */
export function XAxisTimeIndicator(props: {
    x:           number,
    time:        Date,
    plot_width:  number,
    plot_height: number,
}): JSX.Element | null {
    if(props.plot_width <= 0 || props.plot_height <= 0)
        return null

    const label: string = strftime_ISO8601_datetime(props.time)
    const box_w: number = 136
    const box_h: number = 18
    const box_x: number = Math.max(
        0,
        Math.min(props.x - box_w / 2, Math.max(0, props.plot_width - box_w)),
    )

    return <g style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}>
        <line
            x1             = {props.x}
            y1             = {0}
            x2             = {props.x}
            y2             = {props.plot_height}
            stroke         = '#f57c00'
            stroke-width   = '1.5'
            stroke-opacity = '0.50'
        />
        <rect
            x              = {box_x}
            y              = {0}
            width          = {box_w}
            height         = {box_h}
            fill           = '#000000'
            fill-opacity   = '0.75'
            stroke         = '#ffffff'
            stroke-opacity = '0.4'
        />
        <text
            x           = {box_x + box_w / 2}
            y           = {13}
            text-anchor = 'middle'
            fill        = '#ffffff'
            font-size   = '11'
        >
            {label}
        </text>
    </g>
}


/** Synchronized x-axis hover time indicator for a D3Heatmap */
export function HeatmapTimeIndicatorOverlay(props: {
    $hover_time:      Readonly<Signal<Date | null>>,
    $x_axis:          Readonly<Signal<Date[] | number[]>>,
    $plot_size:       Readonly<Signal<Size>>,
    $zoom_transform?: Readonly<Signal<{ k: number, x: number }>>,
}): JSX.Element | null {
    const time: Date | null                       = props.$hover_time.value
    const x_axis: Date[] | number[]               = props.$x_axis.value
    const size: Size                              = props.$plot_size.value
    const zoom: { k: number, x: number } | null   = props.$zoom_transform?.value ?? null

    const x: number | null = compute_heatmap_x_for_time(
        time,
        x_axis,
        size.width,
        zoom?.k ?? 1,
        zoom?.x ?? 0,
    )
    if(x == null || time == null)
        return null

    return <XAxisTimeIndicator
        x           = {x}
        time        = {time}
        plot_width  = {size.width}
        plot_height = {size.height}
    />
}


/** Synchronized x-axis hover time indicator for a D3SignalPlot */
export function SignalPlotTimeIndicatorOverlay(props: {
    $hover_time:  Readonly<Signal<Date | null>>,
    $plot_data:   Readonly<Signal<SignalPlotData | null>>,
    $plot_width:  Readonly<Signal<number>>,
    $plot_height: Readonly<Signal<number>>,
}): JSX.Element | null {
    const time: Date | null               = props.$hover_time.value
    const plot_data: SignalPlotData | null = props.$plot_data.value
    const width: number                   = props.$plot_width.value
    const height: number                  = props.$plot_height.value

    const x: number | null = compute_x_coordinate_for_time(time, plot_data, width)
    if(x == null || time == null)
        return null

    return <XAxisTimeIndicator
        x           = {x}
        time        = {time}
        plot_width  = {width}
        plot_height = {height}
    />
}



