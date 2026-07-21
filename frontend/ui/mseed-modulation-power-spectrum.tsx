import { preact, Signal, signals, JSX } from '../dep.ts'

import type { IPyodide, SpectrogramData } from '../lib/pyodide.ts'
import { SettingsContainer } from '../ui/component-settings.tsx'
import { D3Heatmap, type DataItem as HeatmapDataItem } from './d3-heatmap.tsx'
import { ContainerWithOverlay } from '../ui/plot-image.tsx'


export type MSEED_ModulationPowerSpectrumData = {
    /** Raw 1D signal */
    signal: Float32Array;

    /** Sampling rate */
    fs: number;

    /** Time of the first signal sample */
    start_time: Date;

    /** Which slice of the signal to visualize */
    slice_indices: [number, number];

    /** Network-Station-Location-Channel code of the displayed file */
    code: string;
}


type MSEED_ModulationPowerSpectrumProps = {
    $data: Readonly< Signal<MSEED_ModulationPowerSpectrumData|null> >;

    /** Pyodide WASM module */
    $pyodide: Readonly< Signal<IPyodide> >;

    /** Flag indicating that new data is being loaded */
    $loading: Readonly<Signal<boolean>>;
}


export class MSEED_ModulationPowerSpectrum
    extends preact.Component<MSEED_ModulationPowerSpectrumProps> {
    render(): JSX.Element {
        return <>
        <ContainerWithOverlay
            $is_loading = {this.props.$loading}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <SettingsContainer settings_entries = {[]}>
                <D3Heatmap
                    $data                  = {this.$heatmap_data}
                    $x_axis                = {this.$t_axis}
                    $y_axis                = {this.$f_axis}
                    on_click               = {() => {}}
                    $title                 = {this.$title}
                    y_axis_label           = 'Spectral Modulation (1/Hz)'
                    x_axis_label           = 'Temporal Modulation (Hz)'
                    x_axis_label_formatter = {this.format_mps_axis_value}
                    enable_hover           = {false}
                    enable_zoom            = {false}
                    colormap               = 'magma'
                />
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    #_1 = signals.effect( (async () => {
        const data: MSEED_ModulationPowerSpectrumData|null = 
            this.props.$data.value
        if(data == null)
            return

        const [i0, i1] = data.slice_indices
        const mps_data: SpectrogramData|Error =
            await this.props.$pyodide.value.plot_modulation_power_spectrum(
                data.signal,
                i0,
                i1,
                data.start_time,
                data.fs,
                data.code,
            )
        if(mps_data instanceof Error) {
            console.error(
                `Error plotting modulation power spectrum: ${mps_data.message}`
            )
            return
        }

        this.$t_axis.value = Array.from(mps_data.t_axis)
        this.$f_axis.value = Array.from(
            mps_data.f_axis,
            f => format_frequency_label(f)
        )
        this.$title.value = `${data.code} - Modulation Power Spectrum`
        this.$heatmap_data.value = spectrogram_to_heatmap(mps_data)
    }) as () => void )

    /** Heatmap pixels */
    $heatmap_data: Signal<HeatmapDataItem[]> = new Signal([])

    /** X-axis values */
    $t_axis: Signal<number[]> = new Signal([])

    /** Y-axis values */
    $f_axis: Signal<string[]> = new Signal(['0'])

    /** Plot title */
    $title: Signal<string> = new Signal('')

    format_mps_axis_value = (value:number): string => {
        if(!Number.isFinite(value))
            return ''

        if(Math.abs(value) >= 10)
            return value.toFixed(0)

        if(Math.abs(value) >= 1)
            return value.toFixed(1)

        return value.toFixed(2)
    }
}


function spectrogram_to_heatmap(data: SpectrogramData): HeatmapDataItem[] {
    const rows:number = Math.max(data.rows, 0)
    const cols:number = Math.max(data.cols, 0)
    const output:HeatmapDataItem[] = []
    if(rows == 0 || cols == 0)
        return output

    let index:number = 0
    for(let row:number = 0; row < rows; row++) {
        for(let col:number = 0; col < cols; col++) {
            const power:number = data.power[index] ?? 0
            output.push({
                x: col,
                y: row,
                color: power,
            })
            index += 1
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
