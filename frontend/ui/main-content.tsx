import { preact, Signal, signals, JSX } from '../dep.ts'

import { D3Map }         from './d3-map.tsx'
import { MSEED_SignalPlot, type MSEED_SignalPlotData } from './mseed-signal-plot.tsx'
// import {
//     MSEED_ModulationPowerSpectrum,
//     type MSEED_ModulationPowerSpectrumData,
// } from './mseed-modulation-power-spectrum.tsx'
import { 
    MSEED_Spectrogram as MSEED_Spectrogram, 
    type MSEED_Data as MSEED_SpectrogramData 
} from './mseed-spectrogram.tsx'

import { 
    MSEED_Heatmap,
    type InferenceEvent,
    type OnClickItem,
} from './mseed-heatmap.tsx'

import { AudioPlaybackControls } from './audio-playback-controls.tsx'
import { SelectablePanelsRow } from './selectable-panels-row.tsx'
import { SplitPanels } from './split-panels.tsx'
import {
    read_mseed_slice_across_files,
} from '../lib/file-input.ts'
import { combine_mseed_codes } from '../lib/mseed-parsing.ts'

import { strftime_ISO8601_datetime } from '../lib/util.ts'

import type { AppConfig }         from '../index.tsx'
import type { Marker, MarkerVisual } from './d3-map.tsx'
import type { MSEED_FileAndMeta } from '../lib/file-input.ts'
import type { MSeedMetadata }     from '../lib/mseed-parsing.ts'
import type { Station, Channel }  from '../lib/station-xml.ts'
import type { QuakeEvent }        from '../lib/quakeml.ts'
import type { AudioWaveform }     from './audio-playback-controls.tsx'
import { 
    percentile,
    signal_cubic_interpolate_to_length,
    signal_add_scalar,
    signal_scale,
    signal_abs,
    signal_clip,
    median,
} from "../lib/signal-processing.ts";




type MainContentProps = {
    /** Currently loaded MSEED meta data */
    $mseeds: Readonly<Signal<MSEED_FileAndMeta[]>>

    /** Events recognized as positive during inference. */
    $inference: Signal<InferenceEvent[]>;

    /** Stations from a stationxml file */
    $stations: Signal<Station[]>;

    /** Events from a quakeml file */
    $events: Signal<QuakeEvent[]>;

    /** Config set during build */
    app_config: AppConfig;
}


/** The main UI, showing a heatmap, plots and a map with stations.
 *  Coordinating between them. */
export class MainContent extends preact.Component<MainContentProps> {
    render(): JSX.Element {
        const panels = [
            {
                key: 'plot',
                label: 'Signal',
                element: 
                    <MSEED_SignalPlot
                        $plot_data    = {this.$signal_plot_data}
                        $loading      = {this.$plots_loading}
                        $slice_length = {this.$signal_slice_length}
                        on_remove     = {this.on_signal_remove}
                    />
            },
            {
                key: 'spectrogram',
                label: 'Spectrogram',
                element:
                <MSEED_Spectrogram
                    $data    = {this.$spectrogram_plot_data}
                    $loading = {this.$plots_loading}
                    $slice_length = {this.$signal_slice_length}
                />
            },
            // {
            //     key: 'mps',
            //     label: 'Modulation Power Spectrum',
            //     element: <MSEED_ModulationPowerSpectrum
            //         $data    = {this.$modulation_power_spectrum_data}
            //         $pyodide = {this.$pyodide as Readonly< Signal<IPyodide> >}
            //         $loading = {this.$plots_loading}
            //     />,
            // },
            {
                key: 'map',
                label: 'Map',
                element: <D3Map 
                    $markers             = {this.$map_markers} 
                    on_marker_hover      = {this.on_marker_hover} 
                    $highlighted_markers = {this.$highlighted_station_index}
                    $overlay_visible     = {this.$map_overlay_visible}
                />,
            },
        ]

        return (
            <SplitPanels
                direction         = 'vertical'
                min_panel_size_px = {180}
                handle_size_px    = {8}
                items = {[
                    {
                        key: 'heatmap',
                        element: <MSEED_Heatmap
                            $mseed_meta          = {this.$mseed_meta}
                            $mseeds              = {this.props.$mseeds}
                            $inference           = {this.props.$inference}
                            $events              = {this.props.$events}
                            on_click             = {this.on_heatmap_item_select}
                            on_mseed_hover       = {this.on_mseed_hover}
                            on_events_hover      = {this.on_events_hover}
                            $highlighted_station = {this.$highlighted_station}
                        />,
                    },
                    {
                        key: 'panels',
                        element: <SelectablePanelsRow
                            items = {panels}
                            bottom_left_element = {
                                <AudioPlaybackControls $audiodata={this.$audiodata} />
                            }
                            initial_preference = {['plot', 'spectrogram', 'map']}
                        />,
                    },
                ]}
            />
        )
    }


    /** MSEED meta data without the files */
    $mseed_meta: Readonly<Signal<MSeedMetadata[]>> = signals.computed(
        () => this.props.$mseeds.value.map( m => m.meta )
    )

    /** Stations partitioned into those with loaded mseed metadata and without */
    $paritioned_stations: Readonly<Signal<PartitionedStations>> = signals.computed(
        () => {
            const stations:Station[] = this.props.$stations.value
            const mseed_meta:MSeedMetadata[] = this.$mseed_meta.value

            const stations_with_mseed_meta: Station[] = []
            const stations_without_mseed_meta: Station[] = []
            for(const station of stations){
                if(station_has_mseed_meta(station, mseed_meta))
                    stations_with_mseed_meta.push(station)
                else
                    stations_without_mseed_meta.push(station)
            }
            return {
                with_meta:    stations_with_mseed_meta,
                without_meta: stations_without_mseed_meta,
            }
        }
    )

    /** Stations in the order as fed into the map, those without metadata first */
    $reordered_stations: Readonly<Signal<Station[]>> = signals.computed(
        () => [
            // same order as fed into map
            ...this.$paritioned_stations.value.without_meta,
            ...this.$paritioned_stations.value.with_meta
        ]
    )

    /** Stations converted to D3Map Markers */
    $map_markers:Readonly<Signal<Marker[]>> = signals.computed( () => {
        const stations:PartitionedStations = this.$paritioned_stations.value;
        
        // first markers without mseeds, because of z-ordering
        const station_markers: Marker[] = stations.without_meta.map(
            (station: Station) => {
                const visual:MarkerVisual = {
                    // station without mseed data (gray)
                    shape:           'circle',
                    color:           '#9aa4ad',
                    highlight_color: '#f57c00',
                    stroke_color:    '#3f0f25',
                    size:            5
                }
                return {
                    latitude:  station.latitude,
                    longitude: station.longitude,
                    label:     station.code,
                    visual,
                }
            }
        ).concat( stations.with_meta.map(
            (station: Station) => {
                const visual:MarkerVisual = {
                    // station with associated mseed data (red)
                    shape:           'circle',
                    color:           'red',
                    highlight_color: '#f57c00',
                    stroke_color:    '#ffffff',
                    size:            6,
                }
                return {
                    latitude:  station.latitude,
                    longitude: station.longitude,
                    label:     station.code,
                    visual,
                }
            }
        ) )

        const event_markers:Marker[] = this.$highlighted_events.value.map(
            (event:QuakeEvent) => ({
                latitude:  event.latitude,
                longitude: event.longitude,
                label:     `Event ${strftime_ISO8601_datetime(event.time)}`,
                visual: {
                    shape:           'diamond',
                    color:           '#1f6fb2',
                    highlight_color: '#ff8f00',
                    size:            8,
                },
                rings: {
                    distances_km: [50, 100],
                    color: 'rgba(31,111,178,0.5)',
                    stroke_width: 1.5,
                },
                ignore_for_centering: true,

            } as Marker)
        )

        return [
            ...station_markers,
            ...event_markers,
        ]
    })

    /** Show overlay only when no stations present */
    $map_overlay_visible:Readonly<Signal<boolean>> = signals.computed(
        () => this.props.$stations.value.length == 0
    )


    /** The currently highlighted station, either in the map or heatmap */
    $highlighted_station:Signal<Station|null> = new Signal(null)
    $highlighted_station_index:Signal<number[]> = new Signal([])

    /** Called when the user hovers on a station marker in the map */
    on_marker_hover = (index:number|null) => {
        this.$highlighted_station_index.value = (index != null) ? [index] : []

        const stations:Station[] = this.$reordered_stations.value
        if(index == null || !(index in stations))
            this.$highlighted_station.value = null;
        else
            this.$highlighted_station.value = stations[index]!
    }

    /** Called when user hovers on a data item in the heatmap */
    on_mseed_hover = (index:number|null) => {
        const mseeds:MSEED_FileAndMeta[] = this.props.$mseeds.value;
        if(index == null || !(index in mseeds)) {
            this.$highlighted_station.value = null;
            this.$highlighted_station_index.value = [];
        }
        else {
            const mseed:MSEED_FileAndMeta = mseeds[index]!
            const stations:Station[] = this.$reordered_stations.value
            for(const station_index in stations) {
                const station:Station = stations[station_index]!
                if(station_has_mseed_meta(station, [mseed.meta])) {
                    this.$highlighted_station_index.value = [Number(station_index)];
                    this.$highlighted_station.value = station;
                    return;
                }
            }

            this.$highlighted_station.value = null;
            this.$highlighted_station_index.value = [];
        }
    }

    /** The currently hightlighted events */
    $highlighted_events: Signal<QuakeEvent[]> = new Signal([])

    /** Called when user hovers on a pixel in the heatmap. 
     *  Receives the events on this pixel. */
    on_events_hover = (event_indices:number[]) => {
        this.$highlighted_events.value = 
            event_indices
            .map( i => this.props.$events.value[i] )
            .filter(Boolean) as QuakeEvent[]
    }


    /** Indicates if we are reading data and rendering plots. */
    $plots_loading: Signal<boolean> = new Signal(false)

    /** The  length of the signal to be displayed in the signal plot, 
     *  spectrogram, audio components. In seconds.*/
    $signal_slice_length = new Signal<number>(300);

    /** Selected partial waveforms from the heatmap. 
     *  Displayed in the signal plot and spectrogram. */
    $selected_slices: Signal<SelectedSignalSlice[]> = new Signal([])

    /** Currently active data in the 1D signal plot */
    $signal_plot_data: Signal<MSEED_SignalPlotData[]> = new Signal([])

    /** Currently active data in the spectrogram plot */
    $spectrogram_plot_data: Signal<MSEED_SpectrogramData | null> = new Signal(null)

    /** Currently active data in the audio playback component */
    $audiodata: Signal<AudioWaveform | null> = new Signal(null)

    /** Re-read data, when user selected a new slice in the heatmap or changed
     *  the slice length, then refresh all plots */
    #_1 = signals.effect( () => { (async () => {
        // signal subscriptions
        const slice_length:number = this.$signal_slice_length.value
        const selected_slices:SelectedSignalSlice[] = this.$selected_slices.value

        // dont subscribe, will call twice otherwise
        if(this.$plots_loading.peek())
            return
        this.$plots_loading.value = true

        const signal_plot_data_list: MSEED_SignalPlotData[] = []

        try {
        for(const i in selected_slices) {
            const selectedslice: SelectedSignalSlice = selected_slices[i]!
            const mseed: MSEED_FileAndMeta|undefined =
                this.props.$mseeds.value[selectedslice.file_index]
            if(mseed == undefined) {
                console.error(
                    `No mseed file at index ${selectedslice.file_index}`
                )
                continue
            }

            const fs: number = mseed.meta.samplerate
            const slice_end_index: number =
                selectedslice.start_index + slice_length * fs
            
            const data: Float32Array|Error =
                await read_mseed_slice_across_files(
                    this.props.$mseeds.value,
                    selectedslice.file_index,
                    [selectedslice.start_index, slice_end_index],
                )
            if(data instanceof Error){
                console.error(data as Error)
                continue
            }

            const code: string = combine_mseed_codes(mseed.meta)
            const channel: Channel|null =
                // should this be a subscription instead of .peek() ?
                find_channel_for_mseed_meta(mseed.meta, this.props.$stations.peek())
            
            signal_plot_data_list.push({
                data,
                start_time:        mseed.meta.starttime,
                sample_rate_hz:    mseed.meta.samplerate,
                code:              code,
                response:          channel?.response,
                slice_start_index: selectedslice.start_index,
            })
            this.$spectrogram_plot_data.value = {
                signal:            data,
                start_time:        mseed.meta.starttime,
                fs:                mseed.meta.samplerate,
                code:              code,
                slice_start_index: selectedslice.start_index,
            }
            // this.$modulation_power_spectrum_data.value = {
            //     signal:        data,
            //     slice_indices: [slice_start_index, resolved_slice_end_index],
            //     start_time:    mseed.meta.starttime,
            //     fs:            mseed.meta.samplerate,
            //     code:          code,
            // }
            this.$audiodata.value = {
                data: await slice_and_prepare_seismic_signal_for_audio(
                    data,
                    mseed.meta.samplerate,
                    selectedslice.start_index,
                    slice_end_index
                ),
                samplerate: 8000,
            }
        }
        } finally {
            this.$plots_loading.value = false
        }
        this.$signal_plot_data.value = signal_plot_data_list

        return
    })()
    })

    /** Called when user clicks on an item in the heatmap.
     *  Reading the corresponding segment from the MSEED file and forwarding
     *  to other components for visualization. */
    on_heatmap_item_select = (selected:OnClickItem) => {
        if(this.$plots_loading.value)
            return

        const new_slice = {
            file_index:  selected.mseed_index, 
            start_index: selected.start_index,
        }
        if(selected.shiftkey)
            this.$selected_slices.value = [
                ...this.$selected_slices.value,
                new_slice
            ]
        else
            this.$selected_slices.value = [new_slice]
    }

    /** Called when user wants to remove a displayed signal slice. */
    on_signal_remove = (index:number) => {
        const current_slices: SelectedSignalSlice[] = this.$selected_slices.value
        if(!(index in current_slices)) {
            console.error(`on_signal_remove: invalid index ${index}`)
            return
        }

        this.$selected_slices.value = 
            [...current_slices.slice(0, index), ...current_slices.slice(index+1)]
    }


    // $modulation_power_spectrum_data:
    //     Signal<MSEED_ModulationPowerSpectrumData|null> = new Signal(null)

}


type SelectedSignalSlice = {file_index:number, start_index:number};


/** Check if a station has matching MSEED meta. */
function station_has_mseed_meta(
    station:    Station,
    mseed_meta: MSeedMetadata[],
): boolean {
    for(const meta of mseed_meta) {
        if(meta.station == station.code && meta.network == station.network)
            return true
    }

    return false
}


function find_station_for_mseed_meta(
    meta:     MSeedMetadata, 
    stations: Station[]
): Station|null {
    for(const station of stations)
        if(meta.station == station.code && meta.network == station.network)
            return station
    return null;
}

function find_channel_for_mseed_meta(
    meta:     MSeedMetadata,
    stations: Station[]
): Channel|null {
    const station: Station|null = find_station_for_mseed_meta(meta, stations)

    for(const channel of station?.channels ?? []) {
        // NOTE: ignoring location code on purpose because often inconsistent
        if(meta.channel == channel.code)
            return channel
    }
    return null
}





async function slice_and_prepare_seismic_signal_for_audio(
    signal:   Float32Array, 
    fs:       number,
    i0:       number, 
    i1:       number,
    f_target: number = 8000,
    speedup:  number = 8,
): Promise<Float32Array> {
    i0 = Math.max(i0, 0)
    i1 = Math.min(i1, signal.length)

    signal = signal.slice(i0, i1)
    // at least one second
    if(signal.length < 2)
        return signal

    signal = signal_add_scalar(signal, -median(signal))
    const percentile_998: number = percentile(signal_abs(signal), 99.8)

    const n:number = Math.floor(signal.length / fs * f_target / speedup)
    // a bit too hardcoded?
    if(n < 128)
        return new Float32Array(0)

    signal = signal_cubic_interpolate_to_length(signal, n)
    signal = signal_scale(signal, 1 / percentile_998)
    signal = signal_clip(signal, -5, 5)

    return signal;
}




/** Helper type to partition stations with and without loaded mseed metadata */
type PartitionedStations = {
    with_meta:    Station[];
    without_meta: Station[];
}
