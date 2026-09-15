import { preact, Signal, signals, JSX } from '../dep.ts'

import { 
    create_spectrogram_for_visualization_parallelized, 
    type SpectrogramOutput,
} from '../lib/signal-processing-visualization.ts'

import {
    SettingsContainer,
    type SettingsEntry,
    type SettingsAction,
} from '../ui/component-settings.tsx'

import { D3Heatmap, type DataItem as HeatmapDataItem } from './d3-heatmap.tsx'
import { ContainerWithOverlay } from "../ui/plot-image.tsx"

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
    $data: Readonly< Signal<MSEED_Data|null> >;

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
            $is_loading = {this.$loading_or_updating}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <SettingsContainer
                settings_entries = {this.settings.to_component_settings_entries()}
                extra_actions    = {this.to_component_settings_actions()}
                on_apply         = {this.on_new_settings}
            >
                <div ref = {this.plot_container_ref} style = {{width: '100%', height: '100%'}}>
                    <D3Heatmap
                        $data        = {this.$heatmap_data}
                        $x_axis      = {this.$t_axis}
                        $y_axis      = {this.$f_axis}
                        on_click     = {() => {}}
                        $title       = {this.$title}
                        y_axis_label = 'Frequency (Hz)'
                        enable_hover = {false}
                        enable_zoom  = {false}
                        downsample   = 'maxpool'
                    />
                </div>
            </SettingsContainer>
        </ContainerWithOverlay>
        </>
    }

    override componentWillUnmount(): void {
        this.#update_effect_cleanup_fn()
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
        const data: MSEED_Data | null = this.props.$data.value
        if(data == null) {
            console.warn('PNG export failed: no visible spectrogram')
            return
        }

        const container: HTMLDivElement | null = this.plot_container_ref.current
        if(container == null) {
            console.warn('PNG export failed: missing spectrogram container')
            return
        }

        const svg_element: SVGSVGElement | null =
            container.querySelector('.d3-container svg')
        if(svg_element == null) {
            console.warn('PNG export failed: no visible spectrogram SVG')
            return
        }

        const i0: number = data.slice_start_index
        const start_time: Date = new Date(
            data.start_time.getTime() + i0 * 1000 / data.fs
        )

        const filename: string = format_png_export_filename(
            strftime_ISO8601_datetime(start_time),
            data.code,
            'spectrogram',
        )
        const png_file: File | Error = await export_visible_svgs_to_png(
            [svg_element],
            filename,
        )
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


    /** Heatmap pixels */
    $heatmap_data: Signal<HeatmapDataItem[]> = new Signal([])

    /** X-axis values */
    $t_axis: Signal<number[]> = new Signal([])

    /** Y-axis values */
    $f_axis: Signal<string[]> = new Signal([])

    /** Plot title */
    $title: Signal<string> = new Signal('')


    /** Flag indicating if a new spectrogram is currently being computed */
    $updating: Signal<boolean> = new Signal(false)

    #update_effect_cleanup_fn = signals.effect( (async () => {
    try {
        this.$updating.value = true

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

        const spectrogram_output: SpectrogramOutput|Error = 
            await create_spectrogram_for_visualization_parallelized(
                data.signal, 
                data.fs, 
                i0, 
                i1
            )
        if(spectrogram_output instanceof Error) {
            console.error(
                `Error computing spectrogram: ${spectrogram_output.message}`
            )
            return;
        }
        const spectrogram_start_s:number =
            data.start_time.getTime() / 1000
            + (i0 / data.fs)

        const t_axis: number[] = Array.from(
            spectrogram_output.t_axis,
            t => spectrogram_start_s + t
        )
        const f_axis: string[] = Array.from(spectrogram_output.f_axis)
            .filter(
                f => (f_min == null || f >= f_min) && (f_max == null || f <= f_max)
            ).map(f => format_frequency_label(f))
        const title: string = `${data.code} - Spectrogram`

        const spectrogram_heatmap_data: HeatmapDataItem[] = 
            spectrogram_to_heatmap_items(spectrogram_output, f_min, f_max, scale)
        if(spectrogram_heatmap_data.length == 0)
            // TODO: make this an actual user-visible error
            console.error('Zero spectrogram pixels.')
        
        this.$heatmap_data.value = spectrogram_heatmap_data
        this.$t_axis.value = t_axis
        this.$f_axis.value = f_axis
        this.$title.value = title
    } finally {
        this.$updating.value = false;
    }
    }) as () => void)


    $loading_or_updating: Readonly<Signal<boolean>> = signals.computed( () => {
        return this.props.$loading.value || this.$updating.value;
    } )
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
