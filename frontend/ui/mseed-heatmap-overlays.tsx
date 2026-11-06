import { JSX, Signal } from '../dep.ts'

import type { MSeedMetadata }     from "../lib/mseed-parsing.ts";
import type { DataSignalSlice }   from './mseed-heatmap.tsx'
import type {
    DataItem,
    HoverPosition,
    RowsCols,
    Size,
} from './d3-heatmap.tsx'

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



