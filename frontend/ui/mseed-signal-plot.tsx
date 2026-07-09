import { preact, Signal, signals, JSX } from '../dep.ts'

import { SettingsContainer, type SettingsEntry } from "../ui/component-settings.tsx"
import { 
    D3SignalPlot, 
    compute_time_domain,
    type SignalPlotData,
} from "../ui/d3-signal-plot.tsx"
import { ContainerWithOverlay }                  from "../ui/plot-image.tsx"

import * as signalprocessing from "../lib/signal-processing.ts"




export type MSEED_SignalPlotData = Omit<SignalPlotData, 'x_domain'> & {
    /** Indices to slice the full signal */
    slice_indices: [number, number]
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

        let data: Float32Array = plot_data.data
        const [i0, i1] = plot_data.slice_indices
        data = data.slice(i0, i1)

        const fs: number    = plot_data.sample_rate_hz
        const x_domain: [Date, Date]|Error = 
            compute_time_domain(plot_data.start_time, i0, i1, fs)
        if(x_domain instanceof Error)
            return null;

        const f_min: number = this.settings.$bandpass_fmin.value
        const f_max: number = this.settings.$bandpass_fmax.value
        data = signalprocessing.bandpass_filter(data, fs, f_min, f_max)

        return {...plot_data, data, x_domain}
    })




    /** Parameters modified by the user. */
    settings: MSEED_SignalPlotSettings = new MSEED_SignalPlotSettings()

    on_new_settings = () => {
        console.log('on_new_settings: TODO')
    }
}


export {type SignalPlotData};



export class MSEED_SignalPlotSettings {
    /** Lower end of the bandpass filter to apply */
    $bandpass_fmin = new Signal<number>(0.0);

    /** Upper end of the bandpass filter to apply */
    $bandpass_fmax = new Signal<number>(99999);


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
        ]
    }
}

