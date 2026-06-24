import { preact, Signal, signals, JSX } from "../dep.ts"

import { combine_mseed_codes } from "../lib/mseed-parsing.ts";
import type { MSeedMetadata } from "../lib/mseed-parsing.ts";
import type { QuakeEvent } from "../lib/quakeml.ts";
import { D3Heatmap } from "../ui/d3-heatmap.tsx"
import { type Station } from "../lib/station-xml.ts";
import {
    type HoverCallbackPosition, 
    type DataItem as HeatmapDataItem,
    type RGB,
} from "../ui/d3-heatmap.tsx"

import { range } from 'd3';



// 5 minutes atm
const HARDCODED_BIN_LENGTH_SECONDS:number = 60*5;
// at least 30 seconds for an item atm
const HARDCODED_MINIMUM_BIN_LENGTH_SECONDS:number = 30;

const INFERENCE_EVENT_COLOR:RGB = { r: 248, g: 220, b: 70 }


type HeatmapDataItemWithFile = HeatmapDataItem & {
    mseedindex: number,
    timestamp:  number,
}

export type InferenceEvent = {
    code:string,
    time:Date
}


/** Wrapper around the MSEED-agnostic D3Heatmap */
export class MSEED_Heatmap extends preact.Component<{
    /** Metadata loaded from MSEED files */
    $mseed_meta:Readonly< Signal<MSeedMetadata[]> >,

    $inference: Readonly<Signal<InferenceEvent[]> >,

    /** Events loaded from QUAKEML files. To be visualized as vertical markers. */
    $events:    Readonly<Signal<QuakeEvent[]> >,

    /** Called when user clicks on a pixel in the heatmap. Receives the
     *  index of the file and the from/to data indices within the file. */
    on_click: (selected_mseed_index:number, i0:number, i1:number) => void,

    /** Called when user hovers on a pixel in the heatmap. 
     *  Receives the index of the mseed file.  */
    on_mseed_hover?: (mseed_index:number|null) => void,

    /** Called when user hovers on  a pixel with {@link QuakeEvent} events */
    on_events_hover?: (events_indices:number[]) => void,

    /** The currently highlighted station. Can be both input and output. */
    $highlighted_station?: Signal<Station|null>
}> {
    render(): JSX.Element {
        return <D3Heatmap
            $data    = {this.$transformed_files}
            $x_axis  = {this.$x_axis}
            $y_axis  = {this.$y_axis}
            $x_axis_markers = { this.$itemized_event_timestamps }
            $y_axis_markers = { this.$highlighted_rows }
            on_click = {this.on_heatmap_select}
            on_hover = {this.on_heatmap_hover}
        />
    }

    /** $events, aligned to bins/items */
    $itemized_events: Readonly<Signal<ItemizedEvent[]>> = signals.computed(() => {
        const aligned_time_to_original_event_indices: Record<number, number[]> = {}
        for(const event_index in this.props.$events.value) {
            const event:QuakeEvent = this.props.$events.value[event_index]!

            const time:number = event.time.getTime() / 1000;
            const time_aligned:number = time - (time % HARDCODED_BIN_LENGTH_SECONDS);

            const event_indices_at_this_time:number[] = 
                aligned_time_to_original_event_indices[time_aligned] ?? [];
            event_indices_at_this_time.push(Number(event_index));
            
            aligned_time_to_original_event_indices[time_aligned] = 
                event_indices_at_this_time;
        }

        return Object.entries(aligned_time_to_original_event_indices).map(
            ([timestamp, indices]) => ({
                time: new Date(Number(timestamp)*1000), 
                original_event_indices: indices
            })
        )
    })

    /** Timestamps of $itemized_events */
    $itemized_event_timestamps:Readonly<Signal<number[]>> = signals.computed(() => {
        return this.$itemized_events.value.map( e => e.time.getTime() / 1000 )
    })

    private $transformed:Readonly<Signal<TransformedHeatmapData>> = signals.computed(() => {
        const files:MSeedMetadata[] = this.props.$mseed_meta.value
        const inference:InferenceEvent[] = this.props.$inference.value
        return this.transform_heatmap_data(files, inference, HARDCODED_BIN_LENGTH_SECONDS)
    })

    $transformed_files:Readonly<Signal<HeatmapDataItemWithFile[]>> = signals.computed(() => {
        return this.$transformed.value.items
    })

    $x_axis:Readonly<Signal<number[]>> = signals.computed(() => {
        return this.$transformed.value.x_axis
    })

    $y_axis:Readonly<Signal<string[]>> = signals.computed(() => {
        return this.$transformed.value.y_axis
    })


    /** Itemize MSEED meta data into bins of equal size */
    transform_heatmap_data(
        files:     MSeedMetadata[], 
        inference: InferenceEvent[],
        bin_length_seconds: number,
    ):TransformedHeatmapData {
        if(files.length == 0) {
            return {
                items: [],
                x_axis: [],
                y_axis: [],
            }
        }

        const inferencemap:Record<string, Date[]> = inference2map(inference)
        const all_times:number[] = files
            .map((item:MSeedMetadata) => [item.starttime.getTime(), item.endtime.getTime()])
            .flat()
            .sort((a:number,b:number)=>a-b)

        const tmin:number   = all_times[0]! / 1000
        const tmax:number   = all_times[all_times.length-1]! / 1000
        // aligning to bin length
        const tstart:number = tmin - (tmin % bin_length_seconds)
        const tend:number   = tmax - (tmax % bin_length_seconds)
        const x_axis:number[] = range(tstart, tend, bin_length_seconds)

        const all_codes:string[] = Array.from(
            new Set(files.map((item:MSeedMetadata) => combine_mseed_codes(item)))
        ).sort().reverse()
        const station_colors:Record<string, RGB> = create_station_colors(all_codes)

        const all_items:HeatmapDataItemWithFile[] = []
        for(let fileindex:number = 0; fileindex < files.length; fileindex++) {
            const meta:MSeedMetadata = files[fileindex]!
            const code:string = combine_mseed_codes(meta)

            const meta_start_s:number = meta.starttime.getTime() / 1000
            const meta_end_s:number   = meta.endtime.getTime() / 1000
            // aligning to bin length
            const t0:number = meta_start_s - (meta_start_s % bin_length_seconds)
            const t1:number = meta_end_s - (meta_end_s % bin_length_seconds)
            const index0:number = (t0 - tstart) / bin_length_seconds
            const index1:number = (t1 - tstart) / bin_length_seconds
            const yindex:number = all_codes.indexOf(code)

            for(let j:number = index0; j < index1 + 1; j++) {
                const timestamp:number = j * bin_length_seconds + tstart
                if(Math.abs(t1 - timestamp) < HARDCODED_MINIMUM_BIN_LENGTH_SECONDS)
                    continue;

                const date:Date = new Date(timestamp * 1000)
                const has_inference:boolean = find_inference(
                    inferencemap,
                    code,
                    date,
                )
                const color:RGB = has_inference
                    ? INFERENCE_EVENT_COLOR
                    : station_colors[code]!
                all_items.push({
                    x: j,
                    y: yindex,
                    color,
                    mseedindex: fileindex,
                    timestamp,
                })
            }
        }

        return {
            items: all_items,
            x_axis,
            y_axis: all_codes,
        }
    }


    on_heatmap_select = (index:number) => {
        const item:HeatmapDataItemWithFile|undefined = 
            this.$transformed_files.value[index];
        if(item == undefined) {
            console.error(`No corresponding item for index ${index}`)
            return;
        }
        const meta:MSeedMetadata = this.props.$mseed_meta.value[item.mseedindex]!
        
        // starting time in the file, but not necessarily in the first item
        const meta_start_s = meta.starttime.getTime() / 1000
        // need to align to bin length
        // TODO: un-hardcode
        const first_item_start_s: number = 
            meta_start_s - (meta_start_s % HARDCODED_BIN_LENGTH_SECONDS)
        const t0: number = item.timestamp;

        const start_seconds_within_file = t0 - first_item_start_s;
        
        const i0: number = start_seconds_within_file * meta.samplerate;
        const i1: number = i0 + HARDCODED_BIN_LENGTH_SECONDS * meta.samplerate;
        this.props.on_click(item.mseedindex, i0, i1);
    }

    /** Transforming the input $highlighted_station to the y-axis */
    private $highlighted_rows:Readonly<Signal<number[]>> = signals.computed( () => {
        const y_axis:string[] = this.$transformed.value.y_axis
        const station:Station|null = this.props.$highlighted_station?.value ?? null;
        if(station == null)
            return []

        const output:number[] = []
        for(const index in y_axis)
            if(y_axis[index]!.includes(`.${station.code}.`))
                output.push(Number(index))
        return output;
    } )

    /** Called when user hovers on a pixel in the heatmap */
    on_heatmap_hover = (position:HoverCallbackPosition|null) => {
        if(position == null) {
            this.props.on_mseed_hover?.(null)
            this.props.on_events_hover?.([])
            return;
        }

        if(position.item_index != null) {
            const item:HeatmapDataItemWithFile|undefined = 
                this.$transformed_files.value[position.item_index];
            if(item == undefined) 
                console.error(`No corresponding item for index ${position}`)
                // NOTE 2 self: do not return here bc of on_events_hover()
            else 
                this.props.on_mseed_hover?.(item.mseedindex)
        }


        const timestamp:number|undefined = this.$x_axis.value[position.x]
        if(timestamp == undefined) {
            console.error(`No timestamp at x position ${position.x}`)
            return;
        }

        const event_indices:number[] = 
            this.$itemized_events.value
            .filter( e => e.time.getTime() / 1000 == timestamp )
            .map( e => e.original_event_indices )
            .flat()
        this.props.on_events_hover?.(event_indices)
    }
}


type TransformedHeatmapData = {
    items:  HeatmapDataItemWithFile[],
    x_axis: number[],
    y_axis: string[],
}


/** Proxy for QuakeML events, aligned to items */
type ItemizedEvent = {
    /** Event time aligned to bin length */
    time: Date;

    /** Potentially multiple original events that fall into this item  */
    original_event_indices: number[];
}




function inference2map(inferences:InferenceEvent[]): Record<string, Date[]> {
    const output:Record<string, Date[]> = {}
    for(const inference of inferences) {
        output[inference.code] = (output[inference.code] ?? []).concat([inference.time])
    }
    return output;
}

function find_inference(
    inferencemap:Record<string, Date[]>,
    code:string,
    date:Date,
): boolean {
    for(const eventtime of inferencemap[code] ?? []) {
        const event_time_s:number = eventtime.getTime() / 1000
        const event_time_s_aligned:number = 
            event_time_s - (event_time_s % HARDCODED_BIN_LENGTH_SECONDS);
        
        if(event_time_s_aligned * 1000 == date.getTime())
            return true;
    }
    return false;
}

/** Create stable data/background colors for stations. */
function create_station_colors(codes:string[]): Record<string, RGB> {
    const station_palette:Record<string, RGB> = {}
    const output:Record<string, RGB> = {}
    for(const code of codes) {
        const station_code:string = get_station_code_from_mseed_code(code)
        const colors:RGB = 
            station_palette[station_code] ?? create_station_palette(station_code)
        station_palette[station_code] = colors
        output[code] = colors
    }
    return output
}

/** Extract station code from a NET.STA.LOC.CHAN string. */
function get_station_code_from_mseed_code(mseed_code:string): string {
    const parts:string[] = mseed_code.split('.')
    return parts[1] ?? mseed_code
}

/** Create data and background colors from a station code. */
function create_station_palette(station_code:string): RGB {
    const hue:number = hash_string_to_unit_interval(station_code) * 360
    return hsl_to_rgb(hue, 0.30, 0.20)
}

/** Convert HSL (degrees, 0..1, 0..1) into RGB (0..255). */
function hsl_to_rgb(h:number, s:number, l:number): RGB {
    const hue:number = ((h % 360) + 360) % 360
    const chroma:number = (1 - Math.abs(2 * l - 1)) * s
    const hue_section:number = hue / 60
    const second_component:number = chroma * (1 - Math.abs(hue_section % 2 - 1))

    let r1:number = 0
    let g1:number = 0
    let b1:number = 0

    if(hue_section >= 0 && hue_section < 1) {
        r1 = chroma
        g1 = second_component
    } else if(hue_section >= 1 && hue_section < 2) {
        r1 = second_component
        g1 = chroma
    } else if(hue_section >= 2 && hue_section < 3) {
        g1 = chroma
        b1 = second_component
    } else if(hue_section >= 3 && hue_section < 4) {
        g1 = second_component
        b1 = chroma
    } else if(hue_section >= 4 && hue_section < 5) {
        r1 = second_component
        b1 = chroma
    } else {
        r1 = chroma
        b1 = second_component
    }

    const m:number = l - chroma / 2
    return {
        r: to_rgb_channel(r1 + m),
        g: to_rgb_channel(g1 + m),
        b: to_rgb_channel(b1 + m),
    }
}

/** Convert a 0..1 channel to 0..255. */
function to_rgb_channel(channel:number): number {
    return Math.max(0, Math.min(255, Math.round(channel * 255)))
}

/** Convert a string into a stable 0..1 value. */
function hash_string_to_unit_interval(value:string): number {
    let hash:number = 0
    for(let index:number = 0; index < value.length; index++)
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
    const normalized:number = Math.abs(hash % 10000) / 10000
    return normalized
}
