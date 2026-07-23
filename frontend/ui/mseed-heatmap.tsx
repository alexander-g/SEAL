import { preact, Signal, signals, JSX } from "../dep.ts"

import { combine_mseed_codes }    from "../lib/mseed-parsing.ts";
import type { MSeedMetadata }     from "../lib/mseed-parsing.ts";
import type { QuakeEvent }        from "../lib/quakeml.ts";
import type { MSEED_FileAndMeta } from "../lib/file-input.ts";
import { tremorwasm }             from "../lib/file-input.ts";
import { WorkerPool }             from "../lib/workerpool.ts"
import { is_deno }                from "../lib/util.ts"

import { D3Heatmap }              from "../ui/d3-heatmap.tsx"
import { SettingsContainer, SettingsEntry } from "../ui/component-settings.tsx"
import { type Station }           from "../lib/station-xml.ts";
import {
    type HoverCallbackPosition, 
    type DataItem as HeatmapDataItem,
    type RGB,
} from "../ui/d3-heatmap.tsx"
import { ContainerWithOverlay } from "../ui/plot-image.tsx"

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

type EnvelopeHeatmapItem = HeatmapDataItemWithFile & {
    // override
    color: number
}

export type InferenceEvent = {
    code:string,
    time:Date
}


/** Wrapper around the MSEED-agnostic D3Heatmap */
export class MSEED_Heatmap extends preact.Component<{
    /** Metadata loaded from MSEED files */
    $mseed_meta:Readonly< Signal<MSeedMetadata[]> >,

    /** MSEED files and metadata */
    $mseeds: Readonly<Signal<MSEED_FileAndMeta[]>>,

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
        return <>
        <ContainerWithOverlay
            $is_loading     = {this.$overlay_on}
            loading_message = {this.$overlay_message}
        >
            <SettingsContainer
                settings_entries = {this.settings.to_component_settings_entries()}
                on_apply         = {this.on_new_settings}
            >
                <D3Heatmap
                    $data    = {this.$transformed_files}
                    $x_axis  = {this.$x_axis}
                    $y_axis  = {this.$y_axis}
                    $y_axis_tick_values = {this.$y_axis_tick_values}
                    $x_axis_markers = { this.$itemized_event_timestamps }
                    $y_axis_markers = { this.$highlighted_rows }
                    on_click = {this.on_heatmap_select}
                    on_hover = {this.on_heatmap_hover}
                    y_axis_label_formatter = {this.format_station_axis_label}
                    colormap = 'magma'
                />
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    /** Parameters modified by the user. */
    settings: MSEED_HeatmapSettings = new MSEED_HeatmapSettings()


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

    /** Heatmap colors and axes, itemized in bins of equal size */
    $transformed:Readonly<Signal<TransformedHeatmapData>> = signals.computed(() => {
        const files:MSeedMetadata[] = this.props.$mseed_meta.value
        const inference:InferenceEvent[] = this.props.$inference.value
        const transformed:TransformedHeatmapData = this.transform_heatmap_data(
            files,
            inference,
            HARDCODED_BIN_LENGTH_SECONDS,
        )

        return transformed;
    })

    $transformed_files:Readonly<Signal<HeatmapDataItemWithFile[]>> = signals.computed(() => {
        const mode: HeatmapColorMode = this.settings.$heatmap_color_mode.value
        if(mode == 'envelope' && this.$envelope_items.value.length > 0)
            return this.$envelope_items.value
        if(mode == 'band_power_ratio' && this.$bandratio_items.value.length > 0)
            return this.$bandratio_items.value
        return this.$transformed.value.items
    })

    $x_axis:Readonly<Signal<number[]>> = signals.computed(() => {
        return this.$transformed.value.x_axis
    })

    $y_axis:Readonly<Signal<string[]>> = signals.computed(() => {
        return this.$transformed.value.y_axis
    })

    $y_axis_tick_values:Readonly<Signal<number[]>> = signals.computed(() => {
        return build_station_group_ticks(this.$y_axis.value)
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
            const t1:number = meta_end_s - (meta_end_s % bin_length_seconds) + (bin_length_seconds - 0.1)
            const index0:number = (t0 - tstart) / bin_length_seconds
            const index1:number = (t1 - tstart) / bin_length_seconds
            const yindex:number = all_codes.indexOf(code)

            for(let j:number = index0; j < index1 + 1; j++) {
                const timestamp:number = Math.round(j * bin_length_seconds + tstart)
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
        
        const meta_start_s = meta.starttime.getTime() / 1000
        const t0: number = item.timestamp;

        const start_seconds_within_file = t0 - meta_start_s;
        
        const i0: number = 
            Math.floor( Math.max(start_seconds_within_file * meta.samplerate, 0) )
        const i1: number = 
            Math.floor( i0 + HARDCODED_BIN_LENGTH_SECONDS * meta.samplerate )
        this.props.on_click(item.mseedindex, i0, i1)
    }

    format_station_axis_label = (index:number, y_axis:string[]): string => {
        return get_station_group_label_at(y_axis, index) ?? ''
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

    
    /** Individual pixels when mode == 'envelope' */
    $envelope_items: Signal<EnvelopeHeatmapItem[]> = new Signal([])

    /** Individual pixels when mode == 'band_power_ratio' */
    $bandratio_items: Signal<HeatmapDataItemWithFile[]> = new Signal([])

    /** Whether to show the overlay on top of this component */
    $overlay_on:      Signal<boolean> = new Signal(false)
    /** What message to show in the overlay */
    $overlay_message: Signal<string> = new Signal('Loading...')

    $action_label: Readonly<Signal<string>> = signals.computed(() => {
        if(this.$overlay_on.value)
            return 'Heatmap settings (loading...)'
        return 'Heatmap settings'
    })




    on_new_settings = async () => {
        const mode: HeatmapColorMode = this.settings.$heatmap_color_mode.value
        
        if(mode == 'envelope' && this.$envelope_items.value.length == 0)
            this.compute_signal_envelope()
        
        if(mode == 'band_power_ratio' && this.$bandratio_items.value.length == 0) {
            try {
                this.$overlay_on.value = true

                const ratios: HeatmapDataItemWithFile[]|Error = 
                    await this.compute_band_power_ratio()
                if(ratios instanceof Error){
                    console.error('Failed to compute band power ratios', ratios)
                    return
                }
                this.$bandratio_items.value = ratios
            } finally {
                this.$overlay_on.value = false
            }
        }
    }


    compute_signal_envelope = async (): Promise<void> => {
        if(this.$overlay_on.value)
            return

        const files:MSeedMetadata[] = this.props.$mseed_meta.value
        if(files.length == 0) {
            this.$envelope_items.value = []
            return
        }

        this.$overlay_on.value = true
        try {
            const computed:EnvelopeHeatmapItem[]|Error =
                await this.compute_envelope_heatmap_items()
            if(computed instanceof Error) {
                console.error(computed as Error)
                return
            }

            this.$envelope_items.value = computed
        } finally {
            this.$overlay_on.value = false
        }
    }

    async compute_band_power_ratio(): Promise<HeatmapDataItemWithFile[]|Error> {
        const mseeds: MSEED_FileAndMeta[] = this.props.$mseeds.value
        const file_indices: Set<number> = 
            new Set(this.$transformed_files.value.map(item => item.mseedindex))
        
        const f_min: number = this.settings.$envelope_bandpass_fmin.value
        const f_max: number = this.settings.$envelope_bandpass_fmax.value


        const promises: {promise:Promise<HeatmapDataItemWithFile[]>, index:number}[] = []

        for(const index of file_indices) {
            this.$overlay_message.value = 
                `Loading ${index}/${file_indices.size}`

            const mseed: MSEED_FileAndMeta|undefined = mseeds[index]
            if(mseed == undefined){
                console.error(`band power ratio: could not mseed #${index}`)
                continue
            }


            const file: File = mseed.file
            const signal:Float32Array|Error = await tremorwasm.read_data(file!)
            if(signal instanceof Error)
                // TODO: should continue and collect errors instead of returning on first failure
                return signal as Error
            
            const fs: number = mseed.meta.samplerate
            const window: number = Math.floor( HARDCODED_BIN_LENGTH_SECONDS * fs )
            
            const ratios_promise: Promise<Float32Array|Error> = 
                (await this.#pool!.compute_band_power_ratio(signal, fs, f_min, f_max, window)).promise
            const heatmapitems_promise: Promise<HeatmapDataItemWithFile[]> = 
                convert_band_power_ratios_to_heatmap_items(
                    ratios_promise, 
                    this.$transformed.value.items,
                    index, 
                    mseed, 
                )
            promises.push({index, promise:heatmapitems_promise})
        }

        const all_items: HeatmapDataItemWithFile[] = []
        for(const {index, promise} of promises) {
            const items: HeatmapDataItemWithFile[] = await promise;
            
            all_items.push(...items)
        }
        return all_items
    }



    #pool:WorkerPool|undefined;
    override componentWillMount(): void {
        // NOTE: will block build.ts otherwise
        if(!is_deno())
            this.#pool = new WorkerPool()
    }
    override componentWillUnmount(): void {
        this.#pool?.terminate()
    }

    async compute_envelope_heatmap_items(): Promise<EnvelopeHeatmapItem[]|Error> {
        const mseeds: MSEED_FileAndMeta[] = this.props.$mseeds.value
        const file_indices: Set<number> = 
            new Set(this.$transformed_files.value.map(item => item.mseedindex))
        
        const f_min: number = this.settings.$envelope_bandpass_fmin.value
        const f_max: number = this.settings.$envelope_bandpass_fmax.value


        //const promises: {promise:Promise<Float32Array|Error>, index:number}[] = []
        const promises: {promise:Promise<EnvelopeHeatmapItem[]>, index:number}[] = []
        
        for(const index of file_indices) {
            this.$overlay_message.value = 
                `Loading ${index}/${file_indices.size}`

            const mseed: MSEED_FileAndMeta|undefined = mseeds[index]
            const file:  File|undefined = mseed?.file
            if(mseed == undefined)
                continue;

            const data:Float32Array|Error = await tremorwasm.read_data(file!)
            if(data instanceof Error)
                return data as Error
            
            const fs:number = mseed.meta.samplerate

            const envelope_promise: Promise<Float32Array|Error> = 
                (await this.#pool!.compute_envelope(data, fs, f_min, f_max)).promise
            const heatmapitems_promise: Promise<EnvelopeHeatmapItem[]> = 
                convert_envelope_to_heatmap_items(
                    envelope_promise, 
                    mseed.meta, 
                    index, 
                    this.$transformed.value.items
                )
            promises.push({index, promise:heatmapitems_promise})
        }


        // mapping "network.station.location.channel" its maximum envelope value
        const per_channel_maxima: Record<string, number> = {}
        const all_items: EnvelopeHeatmapItem[] = []
        for(const {index, promise} of promises) {
            const items: EnvelopeHeatmapItem[] = await promise;

            const mseed: MSEED_FileAndMeta|undefined = mseeds[index]!
            const code: string = combine_mseed_codes(mseed.meta)
            for(const item of items)
                per_channel_maxima[code] = 
                    Math.max(item.color, per_channel_maxima[code] ?? 0);

            all_items.push(...items)
        }

        for(const index in all_items) {
            const item: EnvelopeHeatmapItem = all_items[index]!
            const mseed: MSEED_FileAndMeta = mseeds[item.mseedindex]!
            const code: string = combine_mseed_codes(mseed.meta)
            const channel_maximum: number|undefined = per_channel_maxima[code]
            if(channel_maximum == undefined)
                // should not happen
                continue
            
            item.color = item.color / channel_maximum
        }

        return all_items;
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

/** Build y-axis ticks at station group boundaries */
function build_station_group_ticks(y_axis:string[]): number[] {
    if(y_axis.length == 0)
        return []

    const ticks:number[] = []
    let previous_station_code:string|null = null
    for(let row_index:number = 0; row_index < y_axis.length; row_index++) {
        const station_code:string = extract_station_code(y_axis[row_index]!)
        if(previous_station_code == null || station_code != previous_station_code)
            ticks.push(row_index)
        previous_station_code = station_code
    }

    const last_boundary:number = y_axis.length
    const last_tick:number|undefined = ticks[ticks.length - 1]
    if(last_tick != last_boundary)
        ticks.push(last_boundary)
    return ticks
}

/** Resolve the label for a station group at a tick */
function get_station_group_label_at(y_axis:string[], tick_index:number): string | null {
    if(tick_index < 0 || tick_index >= y_axis.length)
        return null
    return extract_station_code(y_axis[tick_index]!)
}

/** Extract station code from combined MSEED code */
function extract_station_code(code:string): string {
    const parts:string[] = code.split('.')
    if(parts.length < 2)
        return code
    return parts[1]!
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



function slice_signal_at_time(
    signal:         Float32Array, 
    frequency:      number, 
    start_seconds:  number, 
    length_seconds: number
): Float32Array|null {
    start_seconds = Math.max(0, start_seconds)
    const end_seconds: number = Math.max(0, start_seconds + length_seconds)
    
    const index0: number = Math.min( start_seconds * frequency, signal.length )
    const index1: number = Math.min( end_seconds * frequency, signal.length )

    if(index1 <= index0)
        return null

    return signal.slice(index0, index1)
}

function maximum(x: Float32Array): number {
    let max: number = -Infinity
    for(const i of x)
        max = Math.max(max, i)
    return max;
}

function mean(x: Float32Array): number {
    let sum: number = 0
    for(const i of x)
        sum = sum + i;
    const mean: number = sum / x.length
    return mean
}

function log1p(x: Float32Array): Float32Array {
    const output: Float32Array = new Float32Array(x.length)
    for(let i:number = 0; i < x.length; i++) 
        output[i] = Math.log1p(x[i]!)
    
    return output;
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


/** Helper function to finalize creation of a heatmap, with the envelopes
 *  created by a worker pool */
async function convert_envelope_to_heatmap_items(
    envelope:   Float32Array|Promise<Float32Array|Error>, 
    meta:       MSeedMetadata, 
    mseedindex: number,
    og_items:   HeatmapDataItemWithFile[],
): Promise<EnvelopeHeatmapItem[]> {
    const maybe_envelope: Float32Array|Error = await envelope;
    if(maybe_envelope instanceof Error) {
        console.error('Error computing envelope in pool.', maybe_envelope)
        return []
    }
    envelope = maybe_envelope;

    const fs: number = meta.samplerate

    let file_max: number = 0
    const items: EnvelopeHeatmapItem[] = []
    for(const og_item of og_items) {
        if(og_item.mseedindex != mseedindex)
            continue;

        const t0: number = meta.starttime.getTime() / 1000
        const envelope_slice: Float32Array|null = slice_signal_at_time(
            envelope, 
            fs, 
            og_item.timestamp - t0, 
            HARDCODED_BIN_LENGTH_SECONDS
        )
        if(envelope_slice == null)
            continue;

        const slice_max: number = maximum(envelope_slice)
        file_max = Math.max(file_max, slice_max)

        items.push({
            ...og_item,
            color: slice_max,
        })
    }
    return items
}


async function convert_band_power_ratios_to_heatmap_items(
    ratios:     Float32Array|Promise<Float32Array|Error>,
    og_items:   HeatmapDataItemWithFile[],
    file_index: number,
    mseed:      MSEED_FileAndMeta,
): Promise<HeatmapDataItemWithFile[]> {
    const maybe_ratios: Float32Array|Error = await ratios
    if(maybe_ratios instanceof Error) {
        console.error('Error computing band power ratios in pool.', maybe_ratios)
        return []
    }
    ratios = maybe_ratios
    
    const ratio_items: HeatmapDataItemWithFile[] = []
    for(const og_item of og_items) {
        if(og_item.mseedindex != file_index)
            continue

        const t0: number = Math.round(mseed.meta.starttime.getTime() / 1000)
        const ratio: Float32Array|null = slice_signal_at_time(
            ratios, 
            1/HARDCODED_BIN_LENGTH_SECONDS, 
            og_item.timestamp - t0, 
            HARDCODED_BIN_LENGTH_SECONDS
        )
        if(ratio == null) {
            console.error(`Could not find the correct band ratio at time ${new Date(og_item.timestamp * 1000).toISOString()}`)
            continue
        }
        if(ratio.length != 1)
            console.warn(`Unexpected number of band ratios (${ratio.length}) at time ${new Date(og_item.timestamp * 1000).toISOString()}`)

        ratio_items.push({
            ...og_item,
            color: ratio[0] ?? 0
        })
    }
    return ratio_items
}



export type HeatmapColorMode =
    'station_colors'
    | 'envelope'
    | 'band_power_ratio'

export class MSEED_HeatmapSettings {
    /** Select which value drives the heatmap color. */
    $heatmap_color_mode: Signal<HeatmapColorMode> =
        new Signal<HeatmapColorMode>('station_colors');

    /** Lower end of the bandpass filter to apply before envelope computation */
    $envelope_bandpass_fmin: Signal<number> = new Signal<number>(0.0);

    /** Upper end of the bandpass filter to apply before envelope computation */
    $envelope_bandpass_fmax: Signal<number> = new Signal<number>(99999);


    to_component_settings_entries(): SettingsEntry[] {
        return [
            {
                type:    'enum',
                label:   'Heatmap color mode',
                options: [
                    {label: 'Station colors', value: 'station_colors'},
                    {label: 'Envelope', value: 'envelope'},
                    {label: 'Band Power Ratio', value: 'band_power_ratio'},
                ],
                $signal: this.$heatmap_color_mode,
            },
            {
                type:    'number',  
                label:   'Envelope bandpass lower bound (Hz)', 
                step:    1, 
                $signal: this.$envelope_bandpass_fmin
            },
            {
                type:    'number',  
                label:   'Envelope bandpass upper bound (Hz)', 
                step:    1, 
                $signal: this.$envelope_bandpass_fmax
            },
        ]
    }
}
