import { preact, Signal, signals, JSX } from '../dep.ts'

import { 
    create_spectrogram_for_visualization_parallelized, 
    type SpectrogramOutput,
    type Size,
} from '../lib/signal-processing-visualization.ts'

import {
    SettingsContainer,
    type SettingsEntry,
    type SettingsAction,
} from '../ui/component-settings.tsx'

import {
    D3Heatmap,
    remove_margin_from_size,
    type DataItem as HeatmapDataItem,
    type HoverCallbackPosition,
} from './d3-heatmap.tsx'
import { ContainerWithOverlay } from "../ui/plot-image.tsx"
import { HeatmapTimeIndicatorOverlay } from './mseed-heatmap-overlays.tsx'

import {
    find_first_above,
    find_last_below,
    strftime_ISO8601_datetime,
} from '../lib/util.ts'

import {
    export_visible_svgs_to_png,
    format_png_export_filename,
    trigger_file_download,
} from './plot-export.ts'





export type MSEED_Data = {
    /** Raw 1D signal */
    signal: Float32Array;

    /** Sampling rate */
    fs: number;

    /** Time of the first signal sample */
    start_time: Date;

    /** Which first index within the signal to visualize */
    slice_start_index: number;

    /** Network-Station-Location-Channel code of the displayed file */
    code: string;
}


type MSEED_SpectrogramProps = {
    $data: Readonly< Signal<MSEED_Data[]> >;

    /** Flag indicating that new data is being loaded */
    $loading: Readonly<Signal<boolean>>;

    /** The length of the signal to be displayed in seconds. 
     *  Shared with other components. Both input and output. */
    $slice_length?: Signal<number>;

    /** Shared hover timestamp synchronized across plots */
    $hover_time?: Signal<Date|null>;

    /** Current audio playback timestamp */
    $playback_time?: Readonly<Signal<Date|null>>;
}


export 
class MSEED_Spectrogram extends preact.Component<MSEED_SpectrogramProps> {
    render(): JSX.Element {
        return <>
        <ContainerWithOverlay
            $is_loading = {this.$loading_or_updating}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <SettingsContainer
                settings_entries = {this.settings.to_component_settings_entries()}
                extra_actions    = {this.to_component_settings_actions()}
                on_apply         = {this.on_new_settings}
            >
                
                <div style = {{
                    display: 'flex',
                    flexDirection:'column',
                    height: '100%',
                    // minHeight: 0,
                }} ref = {this.plot_container_ref} >

                    { this.$d3_heatmaps }

                </div>
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    override componentDidMount(): void {
        const container: HTMLDivElement | null = this.plot_container_ref.current
        if(container != null) {
            this.#update_container_size(container.clientWidth, container.clientHeight)
            this.resize_observer = new ResizeObserver(this.#on_container_resize)
            this.resize_observer.observe(container)
        }
    }

    override componentWillUnmount(): void {
        this.resize_observer?.disconnect()
        this.resize_observer = null
        this.#update_effect_cleanup_fn()
    }

    resize_observer: ResizeObserver | null = null
    $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })
    $target_size: Signal<Size | null> = new Signal(null)

    #on_container_resize = (entries: ResizeObserverEntry[]): void => {
        const first: ResizeObserverEntry | undefined = entries[0]
        if(first == undefined)
            return

        this.#update_container_size(
            first.contentRect.width,
            first.contentRect.height,
        )
    }

    #update_container_size(width: number, height: number): void {
        const next_width: number  = Math.max(Math.floor(width), 0)
        const next_height: number = Math.max(Math.floor(height), 0)
        const current: Size = this.$container_size.value
        if(current.width == next_width && current.height == next_height)
            return

        this.$container_size.value = {
            width:  next_width,
            height: next_height,
        }
        this.#refresh_target_size()
    }

    #refresh_target_size(): void {
        const container_size: Size = this.$container_size.peek()
        if(container_size.width <= 0 || container_size.height <= 0)
            return

        const plot_count: number = Math.max(1, this.props.$data.peek().length)
        const per_plot_size: Size = {
            width:  container_size.width,
            height: Math.floor(container_size.height / plot_count),
        }
        const plot_rect: Size = remove_margin_from_size(
            per_plot_size,
            { top: 24, right: 12, bottom: 18, left: 60 },
        )
        const next: Size | null =
            stabilize_spectrogram_target_size(this.$target_size.peek(), plot_rect)
        if(next != this.$target_size.peek())
            this.$target_size.value = next
    }

    /** Parameters modified by the user. */
    settings: MSEED_SpectrogramHeatmapSettings = 
        new MSEED_SpectrogramHeatmapSettings(this.props.$slice_length)

    on_new_settings = () => {
        // currently unused, settings changes are automatically adapted below
    }

    plot_container_ref: preact.RefObject<HTMLDivElement> = preact.createRef()

    /** Export the currently visible spectrogram to PNG. */
    export_png = async (): Promise<void> => {
        const data: MSEED_Data[] = this.props.$data.value
        if(data.length == 0) {
            console.warn('PNG export failed: no visible spectrogram')
            return
        }

        const container: HTMLDivElement | null = this.plot_container_ref.current
        if(container == null) {
            console.warn('PNG export failed: missing spectrogram container')
            return
        }

        const svg_elements: SVGSVGElement[] = Array.from(
            container.querySelectorAll('.d3-container svg')
        )
        if(svg_elements == null) {
            console.warn('PNG export failed: no visible spectrogram SVG')
            return
        }

        let filename:string = 'spectrogram.png'
        if(data.length == 1) {
            const item:MSEED_Data = data[0]!
            const i0: number = item.slice_start_index
            const start_time: Date = new Date(
                item.start_time.getTime() + i0 * 1000 / item.fs
            )

            filename = format_png_export_filename(
                strftime_ISO8601_datetime(start_time),
                item.code,
                'spectrogram',
            )
        }
        const png_file: File | Error = 
            await export_visible_svgs_to_png(svg_elements, filename)
        if(png_file instanceof Error) {
            console.warn('PNG export failed:', png_file.message)
            return
        }

        trigger_file_download(png_file)
    }

    to_component_settings_actions(): SettingsAction[] {
        return [
            {
                label: 'Export PNG',
                on_click: this.export_png,
            },
        ]
    }


    /** List of inputs forwarded to individual {@link D3Heatmap} elements. */
    $d3_inputs: Signal<( D3Input|null )[]> = new Signal([])


    /** Flag indicating if a new spectrogram is currently being computed */
    $updating: Signal<boolean> = new Signal(false)

    // NOTE: cannot use signals.computed() because of async
    #update_effect_cleanup_fn = signals.effect( (async () => {
    try {
        // signal subscriptions first
        const data: MSEED_Data[]    = this.props.$data.value;
        const f_min: number         = this.settings.$f_min.value
        const f_max: number         = this.settings.$f_max.value
        const signal_length: number = this.settings.$slice_length.value
        const scale: boolean        = this.settings.$scale_colors.value

        this.#refresh_target_size()
        const target_size: Size | null = this.$target_size.value

        if(this.$updating.peek())
            return
        this.$updating.value = true


        const d3_inputs: typeof this.$d3_inputs['value'] = []
        const new_cache: typeof this._spectrogram_cache = {}
        for(const item of data) {
            const i0:number = item.slice_start_index
            const i1:number = i0 + signal_length * item.fs

            const _cachekey:string = _construct_cache_key(item, i0, i1, target_size)
            const spectrogram_output:SpectrogramOutput|Error
                = this._spectrogram_cache[_cachekey]
                ?? await create_spectrogram_for_visualization_parallelized(
                        item.signal, 
                        item.fs, 
                        i0, 
                        i1,
                        undefined,
                        target_size ?? undefined,
                    )
            if(spectrogram_output instanceof Error) {
                console.log(`Could not create spectrogram`, spectrogram_output)
                d3_inputs.push(null)
                continue
            }
            new_cache[_cachekey] = spectrogram_output

            const spectrogram_start_s:number =
                item.start_time.getTime() / 1000
                + (i0 / item.fs)

            const t_axis: Date[] = Array
                .from(spectrogram_output.t_axis)
                .map( t => spectrogram_start_s + t )
                .map( t => new Date(t * 1000) )
            
            const f_axis: string[] = Array.from(spectrogram_output.f_axis)
                .filter(
                    f => (f_min == null || f >= f_min) && (f_max == null || f <= f_max)
                ).map(f => format_frequency_label(f))

            const spectrogram_heatmap_data: HeatmapDataItem[] = 
                spectrogram_to_heatmap_items(spectrogram_output, f_min, f_max, scale)
            if(spectrogram_heatmap_data.length == 0)
                // TODO: make this an actual user-visible error
                console.error('Zero spectrogram pixels.')
            
            
            d3_inputs.push({
                pixels: spectrogram_heatmap_data,
                t_axis,
                f_axis,
                code: item.code,
            })
        }

        this._spectrogram_cache = new_cache
        this.$d3_inputs.value = d3_inputs
        return
    } finally {
        this.$updating.value = false;
    }
    }) as () => void)

    _spectrogram_cache:Record<string,SpectrogramOutput> = {}



    /** List of JSX elements to be rendered */
    $d3_heatmaps: Readonly<Signal<JSX.Element[]>> = signals.computed( () => {
        const d3_elements: JSX.Element[] = []
        for(const key in this.$d3_inputs.value) {
            const index: number = Number(key)
            const inputsignals:D3InputSignals = 
                this.#get_individual_d3_input_as_signal(index)
            const $d3heatmap: Signal<D3Heatmap|null> =
                this.#get_or_create_d3_heatmap_signalref(index)
            const $overlays: Readonly<Signal<JSX.Element[]>> =
                this.#overlays_for_plot(index)
            
            d3_elements.push(
                // NOTE: this <div> is needed to constrain the height
                <div
                    key   = {key}
                    style = {{
                        flex: '1 1 0',
                        minHeight: 0,
                    }}
                >
                    <D3Heatmap 
                        $data          = {inputsignals.pixels}
                        $x_axis        = {inputsignals.t_axis}
                        $y_axis        = {inputsignals.f_axis}
                        on_click       = {() => {}}
                        on_hover       = {
                            (p:HoverCallbackPosition|null) => this.#on_heatmap_hover(index, p)
                        }
                        $plot_overlays = {$overlays}
                        $title         = {inputsignals.$title}
                        y_axis_label   = {inputsignals.$y_axis_label}
                        show_x_axis    = {inputsignals.$show_x_axis}
                        enable_zoom    = {false}
                        downsample     = 'maxpool'
                        ref            = {(ref: D3Heatmap|null) => { $d3heatmap.value = ref }}
                    />
                </div>
            )
        }
        return d3_elements
    } )

    /** Current x-axis value that the user hovers on. 
     *  Either in this plot or in another one. */
    readonly $hover_time: Signal<Date|null> = 
        this.props.$hover_time ?? new Signal(null)

    /** References to currently active d3 heatmap objects */
    #d3_heatmap_signalrefs: Record<number, Signal<D3Heatmap|null>> = {}

    #get_or_create_d3_heatmap_signalref(index:number): Signal<D3Heatmap|null> {
        if(!(index in this.#d3_heatmap_signalrefs))
            this.#d3_heatmap_signalrefs[index] = new Signal<D3Heatmap|null>(null)
        return this.#d3_heatmap_signalrefs[index]!
    }



    /** Get or create a signals.computed() to JSX elements displayed on a plot */
    #overlays_for_plot(index:number): Readonly<Signal<JSX.Element[]>> {
        if(index in this.#cached_plot_overlay_signals)
            return this.#cached_plot_overlay_signals[index]!

        const inputsignals: D3InputSignals =
            this.#get_individual_d3_input_as_signal(index)
        const $d3heatmap: Signal<D3Heatmap|null> =
            this.#get_or_create_d3_heatmap_signalref(index)

        const signal: Readonly<Signal<JSX.Element[]>> = signals.computed(() => {
            const d3heatmap: D3Heatmap | null = $d3heatmap.value
            if(d3heatmap == null)
                return []

            const t_axes: (Date[] | null)[] = this.$d3_inputs.value.map(
                item => item?.t_axis ?? null
            )
            const show_badge: boolean =
                index == 0
                || should_show_spectrogram_x_axis(t_axes, index - 1)

            const overlays: JSX.Element[] = [
                <HeatmapTimeIndicatorOverlay
                    $hover_time = {this.$hover_time}
                    $x_axis     = {inputsignals.t_axis}
                    $plot_size  = {d3heatmap.$plot_dimensions}
                    show_badge  = {show_badge}
                    key         = 'hover-time'
                />
            ]
            if(index == 0 && this.props.$playback_time != undefined) {
                overlays.push(
                    <HeatmapTimeIndicatorOverlay
                        $hover_time = {this.props.$playback_time}
                        $x_axis     = {inputsignals.t_axis}
                        $plot_size  = {d3heatmap.$plot_dimensions}
                        show_badge  = {false}
                        key         = 'playback-time'
                    />
                )
            }
            return overlays
        })
        this.#cached_plot_overlay_signals[index] = signal
        return signal
    }
    #cached_plot_overlay_signals: Record<number, Readonly<Signal<JSX.Element[]>>> = {}

    /** Called when user hovers over one of the spectrograms */
    #on_heatmap_hover (index:number, position:HoverCallbackPosition|null): void {
        if(position == null) {
            this.$hover_time.value = null
            return
        }
        const t_axis: Date[] = this.$d3_inputs.value[index]?.t_axis ?? []
        this.$hover_time.value = t_axis[position.x] ?? null
    }

    /** Create or return a cached signals.computed() to a specified 
     *  index within `$d3_inputs` */
    #get_individual_d3_input_as_signal(index:number): D3InputSignals {
        if(index in this.#cached_individual_d3_input_signals)
            return this.#cached_individual_d3_input_signals[index]!
        // else

        this.#cached_individual_d3_input_signals[index] = {
            pixels: signals.computed( () => {
                return this.$d3_inputs.value[index]?.pixels ?? []
            } ),
            f_axis: signals.computed( () => {
                return this.$d3_inputs.value[index]?.f_axis ?? []
            } ),
            t_axis: signals.computed( () => {
                return this.$d3_inputs.value[index]?.t_axis ?? []
            } ),
            code: signals.computed( () => {
                return this.$d3_inputs.value[index]?.code ?? 'Error'
            } ),
            $title: signals.computed( () => {
                const more_than_one_plot:boolean = 
                    (this.$d3_inputs.value.length > 1)
                if(more_than_one_plot)
                    return ''
                
                const code:string|undefined = this.$d3_inputs.value[index]?.code
                if(code == undefined)
                    return 'Error'
                // else
                return `${code} - Spectrogram`
            } ),
            
            $y_axis_label: signals.computed( () => {
                const code:string|undefined = this.$d3_inputs.value[index]?.code
                if(code == undefined)
                    return ''
                // else

                const more_than_one_plot:boolean = 
                    (this.$d3_inputs.value.length > 1)
                if(more_than_one_plot)
                    return code
                return `Frequency (Hz)`
            } ),

            $show_x_axis: signals.computed( () => {
                const t_axes: (Date[] | null)[] = this.$d3_inputs.value.map(
                    item => item?.t_axis ?? null
                )
                return should_show_spectrogram_x_axis(t_axes, index)
            } ),
        }
        return this.#cached_individual_d3_input_signals[index]!
    }

    #cached_individual_d3_input_signals:  Record<number, D3InputSignals > = {}


    $loading_or_updating: Readonly<Signal<boolean>> = signals.computed( () => {
        return this.props.$loading.value || this.$updating.value;
    } )
}


type D3Input = {
    pixels: HeatmapDataItem[],
    f_axis: string[],
    t_axis: Date[],
    code:  string,
}

type D3InputSignals = {
    [K in keyof D3Input]: Readonly< Signal<D3Input[K]> >;
} & {
    $title:        Readonly<Signal<string>>
    $y_axis_label: Readonly<Signal<string>>
    $show_x_axis:  Readonly<Signal<boolean>>
}


/** Return true if the spectrogram at `index` should display its x-axis */
export function should_show_spectrogram_x_axis(
    t_axes: readonly (readonly Date[] | null)[],
    index:  number,
): boolean {
    const current: readonly Date[] | null | undefined = t_axes[index]
    if(current == null || current.length == 0)
        return false

    const next: readonly Date[] | null | undefined = t_axes[index + 1]
    if(next == null || next.length == 0)
        return true

    const current_start: number = current[0]!.getTime()
    const current_end: number   = current[current.length - 1]!.getTime()
    const next_start: number    = next[0]!.getTime()
    const next_end: number      = next[next.length - 1]!.getTime()

    return current_start != next_start || current_end != next_end
}


/** Keep `previous` size if `next` is within a 1:2 to 2:1 ratio on both axes */
export function stabilize_spectrogram_target_size(
    previous: Size | null,
    next:     Size,
): Size | null {
    if(next.width <= 0 || next.height <= 0)
        return previous
    if(previous == null || previous.width <= 0 || previous.height <= 0)
        return next

    const width_ratio: number  = next.width / previous.width
    const height_ratio: number = next.height / previous.height
    const within_bounds: boolean =
        width_ratio >= 0.5
        && width_ratio <= 2.0
        && height_ratio >= 0.5
        && height_ratio <= 2.0
    if(within_bounds)
        return previous

    return next
}

function _construct_cache_key(
    item:        MSEED_Data,
    i0:          number,
    i1:          number,
    target_size: Size | null,
): string {
    const size_key: string =
        target_size != null ? `${target_size.width}x${target_size.height}` : 'default'
    return `${item.code}-${item.start_time}-${item.signal.length}-${i0}-${i1}-${size_key}`
}





export class MSEED_SpectrogramHeatmapSettings {
    /** Minimum frequency to show on the Y axis */
    $f_min = new Signal<number>(0)

    /** Maximum frequency to show on the Y axis */
    $f_max = new Signal<number>(99999)

    /** How much of the signal to show */
    $slice_length: Signal<number>;

    /** Should the pixels be scaled from 0..1 ? */
    $scale_colors = new Signal<boolean>(false)

    constructor($slice_length?:Signal<number>) {
        this.$slice_length = $slice_length ?? new Signal(300);
    }

    to_component_settings_entries(): SettingsEntry[] {
        return [
            {
                type:    'number',
                label:   'Minimum frequency (Hz)',
                step:    1,
                $signal: this.$f_min
            },
            {
                type:    'number',  
                label:   'Maximum frequency (Hz)', 
                step:    1, 
                $signal: this.$f_max
            },
            {
                type:    'number',  
                label:   'Signal length', 
                step:    10, 
                $signal: this.$slice_length
            },
            {
                type:    'boolean',  
                label:   'Scale colors', 
                $signal: this.$scale_colors
            },
        ]
    }
}



function spectrogram_to_heatmap_items(
    spectrogram: SpectrogramOutput, 
    f_min:       number|null,
    f_max:       number|null,
    scale:       boolean = false,
): HeatmapDataItem[] {
    const f_axis: Float32Array = spectrogram.f_axis
    const t_axis: Float32Array = spectrogram.t_axis
    const rows:number = f_axis.length
    const cols:number = t_axis.length

    const output:HeatmapDataItem[] = []
    if(rows == 0 || cols == 0 || spectrogram.frames.length != cols)
        return output

    const first_row: number|null = 
        (f_min != null)? find_first_above(f_axis, f_min) : 0
    const last_row: number|null = 
        (f_max != null)? find_last_below(f_axis, f_max) : rows
    if(first_row == null || last_row == null) {
        console.error('outside the frequency range', f_min, f_max, f_axis)
        return []
    }

    let min_power:number = Number.POSITIVE_INFINITY
    let max_power:number = Number.NEGATIVE_INFINITY
    for(let col:number = 0; col < cols; col++){
        const frame: Float32Array = spectrogram.frames[col]!

        for(let row:number = first_row; row < last_row; row++) {

            const power:number = frame[row] ?? 0
            if(!isFinite(power))
                continue;
            if(power < min_power)
                min_power = power
            if(power > max_power)
                max_power = power
        }    
    }

    if(!Number.isFinite(min_power) || !Number.isFinite(max_power))
        return []

    const power_range:number = Math.max(max_power - min_power, 1e-12)

    for(let col:number = 0; col < cols; col++){
        const frame: Float32Array = spectrogram.frames[col]!

        for(let row:number = first_row; row < last_row; row++) {
            const power:number = frame[row] ?? 0
            const scaled_power:number = 
                scale? (power - min_power) / power_range : power;

            output.push({
                x: col,
                y: row - first_row,
                color: scaled_power,
            })
        }
    }

    return output
}



function format_frequency_label(frequency_hz: number): string {
    if(!Number.isFinite(frequency_hz))
        return '0'

    if(frequency_hz >= 10)
        return frequency_hz.toFixed(0)

    if(frequency_hz >= 1)
        return frequency_hz.toFixed(1)

    return frequency_hz.toFixed(2)
}
