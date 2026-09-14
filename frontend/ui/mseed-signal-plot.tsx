import { preact, Signal, signals, JSX } from '../dep.ts'

import {
    SettingsContainer,
    type SettingsEntry,
    type SettingsAction,
} from '../ui/component-settings.tsx'
import { HoverActionContainer } from '../ui/hover-action-container.tsx'
import { 
    D3SignalPlot, 
    compute_time_domain,
    type SignalPlotData,
} from "../ui/d3-signal-plot.tsx"
import { ContainerWithOverlay } from "../ui/plot-image.tsx"
import {
    export_visible_svgs_to_png,
    format_png_export_filename,
    trigger_file_download,
} from './plot-export.ts'

import type { Response }     from "../lib/station-xml.ts"
import * as signalprocessing from "../lib/signal-processing.ts"
import { tremorwasm }        from '../lib/file-input.ts'
import { strftime_ISO8601_datetime } from '../lib/util.ts'




export type MSEED_SignalPlotData = Omit<SignalPlotData, 'x_domain'|'title'> & {
    /** Which first index within the signal to visualize */
    slice_start_index: number

    /** Network, station, channel code */
    code: string

    /** Instrument response for this channel */
    response?: Response
}


/** Signal plot customized for seismic data */
export class MSEED_SignalPlot extends preact.Component<{
    $plot_data: Readonly<Signal<MSEED_SignalPlotData[]>>;

    $loading: Readonly<Signal<boolean>>;

    /** The length of the signal to be displayed in seconds. 
     *  Shared with other components. Both input and output. */
    $slice_length?: Signal<number>;

    /** Called when user requests to remove a displayed signal */
    on_remove?: (index:number) => void;
}> {
    render(): JSX.Element {
        return <>
        <ContainerWithOverlay
            $is_loading = {this.props.$loading}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <SettingsContainer
                settings_entries = {this.settings.to_component_settings_entries()}
                extra_actions    = {
                    this.settings.to_component_settings_actions(
                        this.export_signal,
                        this.export_png,
                    )
                }
                on_apply         = {this.on_new_settings}
            >
                <div style = {{
                    display: 'flex',
                    flexDirection:'column',
                    height: '100%',
                    // minHeight: 0,
                }} ref = {this.plots_container_ref}>
                    { this.$d3_signal_plots }
                </div>
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    /** List of individual plot data, sliced and bandpass filtered */
    $processed_plot_data: Readonly<Signal<(SignalPlotData|null)[]>> = signals.computed(() => {
        // signal subscriptions first
        const plot_data: MSEED_SignalPlotData[]|null = this.props.$plot_data.value
        const f_min: number = this.settings.$bandpass_fmin.value
        const f_max: number = this.settings.$bandpass_fmax.value
        const slice_length: number = this.settings.$slice_length.value
        const use_common_y_domain: boolean =
            this.settings.$use_common_y_domain.value

        if(plot_data.length == 0)
            return []

        const processed_data:(SignalPlotData|null)[] = []
        for(const i in plot_data) {
            processed_data.push(
                convert_mseed_data_to_signal_plot(
                    plot_data[i]!, 
                    slice_length, 
                    f_min, 
                    f_max,
                    /* add_title  = */ (plot_data.length <= 1),
                    /* add_x_axis = */ (Number(i)+1 == plot_data.length),
                    /* code_on_yaxis = */ (plot_data.length > 1),
                )
            )
        }

        if(use_common_y_domain) {
            const valid_data: SignalPlotData[] = processed_data
                .filter((item): item is SignalPlotData => item != null)

            if(valid_data.length > 1) {
                const y_domain: [number, number] | Error =
                    compute_common_signal_y_domain(
                        valid_data.map((item: SignalPlotData) => item.data)
                    )
                if(y_domain instanceof Error)
                    console.warn('Could not compute common y domain', y_domain)
                else {
                    for(const item of valid_data)
                        item.y_domain = y_domain
                }
            }
        }

        return processed_data
    })

    /** Create or return a cached signals.computed() to a specified 
     *  index within `$processed_plot_data` */
    #get_individual_plot_data_as_preact_signal(index:number): Readonly<Signal<SignalPlotData|null>> {
        if(index in this.#cached_individual_plot_data_signals)
            return this.#cached_individual_plot_data_signals[index]!
        // else

        const signal:Readonly<Signal<SignalPlotData|null>> = signals.computed( () => {
            return this.$processed_plot_data.value[index] ?? null
        } )
        this.#cached_individual_plot_data_signals[index] = signal
        return signal
    }
    #cached_individual_plot_data_signals: Record<number, Readonly<Signal<SignalPlotData|null>>> = {}

    /** List of JSX elements to be rendered */
    $d3_signal_plots: Readonly<Signal<JSX.Element[]>> = signals.computed( () => {
        const more_than_one_plot:boolean = 
            (this.$processed_plot_data.value.length > 1)
        
        const d3_plots: JSX.Element[] = []
        for(const index in this.$processed_plot_data.value) {
            const $item: Readonly<Signal<SignalPlotData|null>> = 
                this.#get_individual_plot_data_as_preact_signal(Number(index))
            const d3_plot: JSX.Element = <D3SignalPlot $plot_data = {$item} />
            const d3_plot_maybe_in_container: JSX.Element =
                more_than_one_plot
                ? <HoverActionContainer 
                    label = 'X' 
                    action_position = 'top-right' 
                    on_action = {() => this.props.on_remove?.(Number(index))}
                >
                    { d3_plot }
                </HoverActionContainer>
                : d3_plot
            
            d3_plots.push(
                // NOTE: this <div> is needed to constrain the height
                <div
                    key = {index}
                    style = {{
                        flex: '1 1 0',
                        minHeight: 0,
                    }}
                >
                    { d3_plot_maybe_in_container }
                </div>
            )
        }
        return d3_plots
    })



    $has_multiple_plots: Readonly<Signal<boolean>> = signals.computed(() =>
        this.props.$plot_data.value.length > 1
    )

    /** Parameters modified by the user. */
    settings: MSEED_SignalPlotSettings = 
        new MSEED_SignalPlotSettings(
            this.props.$slice_length,
            this.$has_multiple_plots,
        )

    on_new_settings = () => {
        // currently unused, settings changes are automatically adapted above
    }

    /** Export the currently displayed signal slice to MiniSEED. */
    export_signal = async (): Promise<void> => {
        const export_data: ExportSignalPayload | Error =
            this.build_export_payload()
        if(export_data instanceof Error) {
            console.warn('MSEED export failed:', export_data.message)
            return
        }

        const file: File | Error = await tremorwasm.write_mseed(
            export_data.data,
            {
                code:       export_data.code,
                samplerate: export_data.sample_rate_hz,
                starttime:  export_data.start_time,
                filename:   format_export_filename(
                    export_data.start_time,
                    export_data.code,
                ),
            }
        )
        if(file instanceof Error) {
            console.warn('MSEED export failed:', file.message)
            return
        }

        trigger_file_download(file)
    }


    plots_container_ref: preact.RefObject<HTMLDivElement> = preact.createRef()


    /** Export the currently visible signal plot(s) as PNG. */
    export_png = async (): Promise<void> => {
        const container: HTMLDivElement | null =
            this.plots_container_ref.current
        if(container == null) {
            console.warn('PNG export failed: missing plot container')
            return
        }

        const svg_elements: SVGSVGElement[] = Array.from(
            container.querySelectorAll('.d3-signal-plot svg')
        )
        if(svg_elements.length == 0) {
            console.warn('PNG export failed: no visible signal plot SVG')
            return
        }

        const export_data: ExportSignalPayload | Error =
            this.build_export_payload()
        if(export_data instanceof Error) {
            console.warn('PNG export failed:', export_data.message)
            return
        }

        const filename: string = format_png_export_filename(
            strftime_ISO8601_datetime(export_data.start_time),
            export_data.code,
            'signal',
        )
        const png_file: File | Error = await export_visible_svgs_to_png(
            svg_elements,
            filename,
        )
        if(png_file instanceof Error) {
            console.warn('PNG export failed:', png_file.message)
            return
        }

        trigger_file_download(png_file)
    }

    /** Build the data payload to export based on current settings. */
    private build_export_payload(): ExportSignalPayload | Error {
        const all_plot_data: MSEED_SignalPlotData[] = this.props.$plot_data.value
        if(all_plot_data.length == 0)
            return new Error('No signal data to export')
        const plot_data: MSEED_SignalPlotData = all_plot_data[0]!

        const fs: number = plot_data.sample_rate_hz
        const i0: number = plot_data.slice_start_index
        const i1: number = i0 + this.settings.$slice_length.value * fs

        let data: Float32Array = plot_data.data.slice(i0, i1)
        if(data.length < 2)
            return new Error('No signal data to export')

        const x_domain: [Date, Date] | Error =
            compute_time_domain(plot_data.start_time, i0, i1, fs)
        if(x_domain instanceof Error)
            return x_domain

        if(this.settings.$export_filtered.value) {
            if(plot_data.response != undefined)
                data = remove_sensitivity(data, plot_data.response)

            const f_min: number = this.settings.$bandpass_fmin.value
            const f_max: number = this.settings.$bandpass_fmax.value
            data = signalprocessing.bandpass_filter(data, fs, f_min, f_max)
        }

        return {
            data:            data,
            code:            plot_data.code,
            sample_rate_hz:  fs,
            start_time:      x_domain[0],
        }
    }
}


function convert_mseed_data_to_signal_plot(
    item:         MSEED_SignalPlotData,
    slice_length: number,
    f_min:        number,
    f_max:        number,
    add_title:    boolean = true,
    add_xaxis:    boolean = true,
    code_on_yaxis:boolean = false,
): SignalPlotData|null {
    const fs: number = item.sample_rate_hz
        let data: Float32Array = item.data
        const i0:number = item.slice_start_index
        const i1:number = i0 + slice_length * fs

        data = data.slice(i0, i1)
        if(data.length < 2)
            return null
        
        if(item.response != undefined)
            data = remove_sensitivity(data, item.response)
        
        let y_axis_label:string|undefined = undefined
        if(code_on_yaxis)
            y_axis_label = `${item.code}`
        else if(item.response != undefined) 
            y_axis_label = `Amplitude (${item.response.input_unit})`

        
        const x_domain: [Date, Date]|Error = 
            compute_time_domain(item.start_time, i0, i1, fs)
        if(x_domain instanceof Error)
            return null;

        data = signalprocessing.bandpass_filter_fir(data, fs, f_min, f_max)

        const filter_str:string = format_filter(f_min, f_max, fs)
        const title: string|undefined = 
            add_title? `${item.code} - Signal ${filter_str}` : undefined
        const x_axis_label: string|undefined = add_xaxis? `Time (UTC)` : undefined

        const start_time: Date = x_domain[0]
        const sample_rate_hz: number = item.sample_rate_hz

        return {
            data, 
            start_time, 
            sample_rate_hz, 
            x_domain, 
            x_axis_label, 
            y_axis_label, 
            title,
        }
}


// re-export
export {type SignalPlotData};



export class MSEED_SignalPlotSettings {
    /** Lower end of the bandpass filter to apply */
    $bandpass_fmin = new Signal<number>(0.0);

    /** Upper end of the bandpass filter to apply */
    $bandpass_fmax = new Signal<number>(99999);

    /** How much of the signal to show */
    $slice_length: Signal<number>;

    /** Scale all visible signals to the same y domain */
    $use_common_y_domain: Signal<boolean> = new Signal<boolean>(false)

    /** Export the filtered signal instead of the original */
    $export_filtered = new Signal<boolean>(false)

    private $show_common_y_domain_setting?: Readonly<Signal<boolean>>

    constructor(
        $slice_length?: Signal<number>,
        $show_common_y_domain_setting?: Readonly<Signal<boolean>>,
    ) {
        this.$slice_length = $slice_length ?? new Signal(300);
        this.$show_common_y_domain_setting = $show_common_y_domain_setting
    }

    to_component_settings_entries(): SettingsEntry[] {
        return [
            {
                type:    'number',  
                label:   'Bandpass lower bound (Hz)', 
                step:    1, 
                $signal: this.$bandpass_fmin
            },
            {
                type:    'number',  
                label:   'Bandpass upper bound (Hz)', 
                step:    1, 
                $signal: this.$bandpass_fmax
            },
            {
                type:    'number',  
                label:   'Signal length', 
                step:    10, 
                $signal: this.$slice_length
            },
            {
                type:     'boolean',
                label:    'Use common y domain',
                $signal:  this.$use_common_y_domain,
                $show_if: this.$show_common_y_domain_setting,
            },
            {
                type:    'boolean',
                label:   'Export filtered signal',
                $signal: this.$export_filtered,
            },
        ]
    }

    to_component_settings_actions(
        on_export_mseed: () => void,
        on_export_png: () => void,
    ): SettingsAction[] {
        return [
            {
                label:      'Export MSEED',
                on_click:   on_export_mseed,
            },
            {
                label:      'Export PNG',
                on_click:   on_export_png,
            },
        ]
    }
}




export
function remove_sensitivity(signal:Float32Array, response:Response): Float32Array {
    const output: Float32Array = new Float32Array(signal.length)
    for(let i: number = 0; i < signal.length; i++)
        output[i] = signal[i]! / response.sensitivity
    return output;
}



function format_filter(f_min: number, f_max: number, fs: number): string {
    const f_min_active:boolean = (f_min > 0)
    const f_max_active:boolean = (f_max < fs/2)

    if(f_min_active && f_max_active)
        return `(Bandpass ${f_min.toFixed(0)} - ${f_max.toFixed(0)} Hz)`
    else if(f_min_active)
        return `(Highpass ${f_min.toFixed(0)} Hz)`
    else if(f_max_active)
        return `(Lowpass ${f_max.toFixed(0)} Hz)`
    else
        return ''
}

/** Compute one shared y-domain for multiple signal arrays. */
function compute_common_signal_y_domain(
    signal_arrays: Float32Array[],
): [number, number] | Error {
    if(signal_arrays.length == 0)
        return new Error('No data to plot.')

    let sample_count: number = 0
    let mean: number = 0
    let mean_square_delta_sum: number = 0
    let data_min: number = Infinity
    let data_max: number = -Infinity

    for(const signal_data of signal_arrays) {
        for(const value of signal_data) {
            data_min = Math.min(data_min, value)
            data_max = Math.max(data_max, value)

            sample_count += 1
            const delta: number = value - mean
            mean += delta / sample_count
            const delta_after_mean_update: number = value - mean
            mean_square_delta_sum += delta * delta_after_mean_update
        }
    }

    if(sample_count == 0)
        return new Error('No data to plot.')

    const variance: number = mean_square_delta_sum / sample_count
    const data_std: number = Math.sqrt(variance)
    const data_range: number = data_max - data_min
    const min_range: number = Math.max(data_std, 1e-9)

    if(data_range < min_range) {
        const center: number = (data_min + data_max) / 2
        return [center - min_range / 2, center + min_range / 2]
    }

    return [data_min, data_max]
}

type ExportSignalPayload = {
    data:           Float32Array
    code:           string
    sample_rate_hz: number
    start_time:     Date
}

/** Format export filename from start time and code. */
function format_export_filename(start_time: Date, code: string): string {
    const safe_code: string = code.trim().replace(/\s+/g, '_')
    const timestamp: string = strftime_ISO8601_datetime(start_time)
    return `${timestamp}-${safe_code}.mseed`
}
