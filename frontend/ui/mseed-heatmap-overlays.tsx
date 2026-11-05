import { JSX, Signal } from '../dep.ts'

import type { MSeedMetadata }     from "../lib/mseed-parsing.ts";
import type { DataSignalSlice }   from './mseed-heatmap.tsx'
import type { Size }              from './d3-heatmap.tsx'

import { find_exact, find_last_below } from "../lib/util.ts"
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


