import { preact, Signal, signals, JSX } from '../dep.ts'

import {
    SettingsContainer,
    type SettingsEntry,
    type SettingsAction,
} from '../ui/component-settings.tsx'
import { 
    D3SignalPlot, 
    compute_time_domain,
    type SignalPlotData,
} from "../ui/d3-signal-plot.tsx"
import { ContainerWithOverlay } from "../ui/plot-image.tsx"

import type { Response }     from "../lib/station-xml.ts"
import * as signalprocessing from "../lib/signal-processing.ts"
import { tremorwasm }        from '../lib/file-input.ts'
import { strftime_ISO8601_datetime } from '../lib/util.ts'




export type MSEED_SignalPlotData = Omit<SignalPlotData, 'x_domain'|'title'> & {
    /** Indices to slice the full signal */
    slice_indices: [number, number]

    /** Network, station, channel code */
    code: string

    /** Instrument response for this channel */
    response?: Response
}


/** Signal plot customized for seismic data */
export class MSEED_SignalPlot extends preact.Component<{
    $plot_data: Readonly<Signal<MSEED_SignalPlotData | null>>;

    $loading: Readonly<Signal<boolean>>;
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
                    this.settings.to_component_settings_actions(this.export_signal)
                }
                on_apply         = {this.on_new_settings}
            >
                <D3SignalPlot
                    $plot_data = {this.$processed_plot_data}
                />
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    /** Plot data, sliced and bandpass filtered */
    $processed_plot_data: Readonly<Signal<SignalPlotData|null>> = signals.computed(() => {
        const plot_data: MSEED_SignalPlotData|null = this.props.$plot_data.value
        if(plot_data == null)
            return null

        const fs: number = plot_data.sample_rate_hz
        let data: Float32Array = plot_data.data
        const [i0, _i1] = plot_data.slice_indices
        const i1:number = i0 + this.settings.$slice_length.value * fs

        data = data.slice(i0, i1)
        if(data.length < 2)
            return null

        let y_axis_label:string|undefined = undefined
        if(plot_data.response != undefined) {
            data = remove_sensitivity(data, plot_data.response)
            y_axis_label = `Amplitude (${plot_data.response.input_unit})`
        }

        
        const x_domain: [Date, Date]|Error = 
            compute_time_domain(plot_data.start_time, i0, i1, fs)
        if(x_domain instanceof Error)
            return null;

        const f_min: number = this.settings.$bandpass_fmin.value
        const f_max: number = this.settings.$bandpass_fmax.value
        data = signalprocessing.bandpass_filter(data, fs, f_min, f_max)

        const filter_str:string = format_filter(f_min, f_max, fs)
        const title = `${plot_data.code} - Signal ${filter_str}`

        return {...plot_data, data, x_domain, y_axis_label, title}
    })




    /** Parameters modified by the user. */
    settings: MSEED_SignalPlotSettings = new MSEED_SignalPlotSettings()

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

    /** Build the data payload to export based on current settings. */
    private build_export_payload(): ExportSignalPayload | Error {
        const plot_data: MSEED_SignalPlotData | null =
            this.props.$plot_data.value
        if(plot_data == null)
            return new Error('No signal data to export')

        const fs: number = plot_data.sample_rate_hz
        const [i0] = plot_data.slice_indices
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


export {type SignalPlotData};



export class MSEED_SignalPlotSettings {
    /** Lower end of the bandpass filter to apply */
    $bandpass_fmin = new Signal<number>(0.0);

    /** Upper end of the bandpass filter to apply */
    $bandpass_fmax = new Signal<number>(99999);

    /** How much of the signal to show */
    $slice_length = new Signal<number>(300)

    /** Export the filtered signal instead of the original */
    $export_filtered = new Signal<boolean>(false)


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
                type:    'boolean',
                label:   'Export filtered signal',
                $signal: this.$export_filtered,
            },
        ]
    }

    to_component_settings_actions(on_export: () => void): SettingsAction[] {
        return [
            {
                label:      'Export MSEED',
                on_click:   on_export,
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

/** Trigger a browser download for a File. */
function trigger_file_download(file: File): void {
    const file_url: string = URL.createObjectURL(file)
    const anchor: HTMLAnchorElement = document.createElement('a')
    anchor.href = file_url
    anchor.download = file.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(file_url)
}
