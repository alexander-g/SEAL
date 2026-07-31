import { preact, Signal, signals, JSX } from '../dep.ts'

import type { IPyodide, SpectrogramData } from '../lib/pyodide.ts'
import { SettingsContainer, type SettingsEntry } from "../ui/component-settings.tsx"
import { D3Heatmap, type DataItem as HeatmapDataItem } from './d3-heatmap.tsx'
import { ContainerWithOverlay } from "../ui/plot-image.tsx"



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
    $data: Readonly< Signal<MSEED_Data|null> >;

    /** Pyodide WASM module */
    $pyodide: Readonly< Signal<IPyodide> >;

    /** Flag indicating that new data is being loaded */
    $loading: Readonly<Signal<boolean>>;

    /** The length of the signal to be displayed in seconds. 
     *  Shared with other components. Both input and output. */
    $slice_length?: Signal<number>;
}


export 
class MSEED_Spectrogram extends preact.Component<MSEED_SpectrogramProps> {
    render(): JSX.Element {
        return <>
        <ContainerWithOverlay
            $is_loading = {this.props.$loading}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <SettingsContainer
                settings_entries = {this.settings.to_component_settings_entries()}
                on_apply         = {this.on_new_settings}
            >
                <D3Heatmap
                    $data        = {this.$heatmap_data}
                    $x_axis      = {this.$t_axis}
                    $y_axis      = {this.$f_axis}
                    on_click     = {() => {}}
                    $title       = {this.$title}
                    y_axis_label = 'Frequency (Hz)'
                    x_axis_label = 'Time (UTC)'
                    enable_hover = {false}
                    enable_zoom  = {false}
                />
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    /** Parameters modified by the user. */
    settings: MSEED_SpectrogramHeatmapSettings = 
        new MSEED_SpectrogramHeatmapSettings(this.props.$slice_length)

    on_new_settings = () => {
        // currently unused, settings changes are automatically adapted below
    }


    #_1 = signals.effect( (async () => {
        // TODO: reset plot, in case of errors later

        // signal subscriptions first
        const data: MSEED_Data|null = this.props.$data.value;
        const f_min: number = this.settings.$f_min.value
        const f_max: number = this.settings.$f_max.value
        const signal_length: number = this.settings.$slice_length.value
        const scale: boolean = this.settings.$scale_colors.value

        if(data == null) {
            console.log('TODO: reset spectrogram')
            return;
        }

        const i0:number = data.slice_start_index
        const i1:number = i0 + signal_length * data.fs

        const spectrogram_data: SpectrogramData|Error =
            await this.props.$pyodide.value.create_spectrogram_for_visualization(
                data.signal,
                i0,
                i1,
                data.fs,
            )
        if(spectrogram_data instanceof Error) {
            console.error(
                `Error computing spectrogram: ${spectrogram_data.message}`
            )
            return;
        }
        const spectrogram_start_s:number =
            data.start_time.getTime() / 1000
            + (i0 / data.fs)

        const t_axis: number[] = Array.from(
            spectrogram_data.t_axis,
            t => spectrogram_start_s + t
        )
        const f_axis: string[] = Array.from(spectrogram_data.f_axis)
            .filter(
                f => (f_min == null || f >= f_min) && (f_max == null || f <= f_max)
            ).map(f => format_frequency_label(f))
        const title: string = `${data.code} - Spectrogram`

        const spectrogram_heatmap_data: HeatmapDataItem[] = 
            spectrogram_to_heatmap(spectrogram_data, f_min, f_max, scale)

        
        this.$heatmap_data.value = spectrogram_heatmap_data
        this.$t_axis.value = t_axis
        this.$f_axis.value = f_axis
        this.$title.value = title
        
    }) as () => void  )

    /** Heatmap pixels */
    $heatmap_data: Signal<HeatmapDataItem[]> = new Signal([])

    /** X-axis values */
    $t_axis: Signal<number[]> = new Signal([])

    /** Y-axis values */
    $f_axis: Signal<string[]> = new Signal([])

    /** Plot title */
    $title: Signal<string> = new Signal('')



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



function spectrogram_to_heatmap(
    data:  SpectrogramData, 
    f_min: number|null,
    f_max: number|null,
    scale: boolean = false,
): HeatmapDataItem[] {
    const rows:number = Math.max(data.rows, 0)
    const cols:number = Math.max(data.cols, 0)
    const f_axis: Float32Array = data.f_axis

    const output:HeatmapDataItem[] = []
    if(rows == 0 || cols == 0 || rows != f_axis.length)
        return output

    let index:number = 0
    let min_power:number = Number.POSITIVE_INFINITY
    let max_power:number = Number.NEGATIVE_INFINITY
    for(let row:number = 0; row < rows; row++) {
        const frequency_hz:number = f_axis[row] ?? 0
        const is_below_min:boolean = f_min != null && frequency_hz < f_min
        const is_above_max:boolean = f_max != null && frequency_hz > f_max
        if(is_below_min || is_above_max) {
            index += cols
            continue
        }

        for(let col:number = 0; col < cols; col++) {
            const power:number = data.power[index] ?? 0
            index += 1
            if(power < min_power)
                min_power = power
            if(power > max_power)
                max_power = power
        }
    }

    if(!Number.isFinite(min_power) || !Number.isFinite(max_power))
        return output

    const power_range:number = Math.max(max_power - min_power, 1e-12)

    index = 0
    let output_row:number = 0
    for(let row:number = 0; row < rows; row++) {
        const frequency_hz:number = f_axis[row] ?? 0
        const is_below_min:boolean = f_min != null && frequency_hz < f_min
        const is_above_max:boolean = f_max != null && frequency_hz > f_max
        if(is_below_min || is_above_max) {
            index += cols
            continue
        }

        for(let col:number = 0; col < cols; col++) {
            const power:number = data.power[index] ?? 0
            index += 1
            const scaled_power:number = 
                scale? (power - min_power) / power_range : power;

            output.push({
                x: col,
                y: output_row,
                color: scaled_power,
            })
        }

        output_row += 1
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
