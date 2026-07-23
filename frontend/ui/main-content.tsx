import { preact, Signal, signals, JSX } from '../dep.ts'

import { D3Map }         from './d3-map.tsx'
import { MSEED_SignalPlot, type MSEED_SignalPlotData } from './mseed-signal-plot.tsx'
import {
    MSEED_ModulationPowerSpectrum,
    type MSEED_ModulationPowerSpectrumData,
} from './mseed-modulation-power-spectrum.tsx'
import { 
    MSEED_Spectrogram as MSEED_Spectrogram, 
    type MSEED_Data as MSEED_SpectrogramData 
} from './mseed-spectrogram.tsx'
import { MSEED_Heatmap } from './mseed-heatmap.tsx'
import { AudioPlaybackControls } from './audio-playback-controls.tsx'
import { SelectablePanelsRow } from './selectable-panels-row.tsx'
import {
    read_mseed_slice_across_files,
} from '../lib/file-input.ts'
import { combine_mseed_codes } from '../lib/mseed-parsing.ts'

import { initialize_in_worker as initialize_pyodide } from '../lib/pyodide.ts'
import { is_deno, strftime_ISO8601_datetime } from '../lib/util.ts'

import type { AppConfig }         from '../index.tsx'
import type { InferenceEvent }    from './mseed-heatmap.tsx'
import type { IPyodide } from '../lib/pyodide.ts'
import type { Marker, MarkerVisual } from './d3-map.tsx'
import type { MSEED_FileAndMeta } from '../lib/file-input.ts'
import type { MSeedMetadata }     from '../lib/mseed-parsing.ts'
import type { Station, Channel }  from '../lib/station-xml.ts'
import type { QuakeEvent }        from '../lib/quakeml.ts'
import type { AudioWaveform }     from './audio-playback-controls.tsx'




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
                    />
            },
            {
                key: 'spectrogram',
                label: 'Spectrogram',
                element:
                <MSEED_Spectrogram
                    $data    = {this.$spectrogram_plot_data}
                    $pyodide = {this.$pyodide as Readonly< Signal<IPyodide> >}
                    $loading = {this.$plots_loading}
                    $slice_length = {this.$signal_slice_length}
                />
            },
            {
                key: 'mps',
                label: 'Modulation Power Spectrum',
                element: <MSEED_ModulationPowerSpectrum
                    $data    = {this.$modulation_power_spectrum_data}
                    $pyodide = {this.$pyodide as Readonly< Signal<IPyodide> >}
                    $loading = {this.$plots_loading}
                />,
            },
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
        <div style = {{
            display: 'flex',
            flexDirection:'column',
            height: '100%',
        }}>
            {/* Row 1 */}
            <div style = {{
                width: '100%',
                height: '50%',
            }}>
                <MSEED_Heatmap 
                    $mseed_meta = {this.$mseed_meta} 
                    $mseeds     = {this.props.$mseeds}
                    $inference  = {this.props.$inference}
                    $events     = {this.props.$events}
                    on_click    = {this.on_heatmap_item_select}
                    on_mseed_hover  = {this.on_mseed_hover}
                    on_events_hover = {this.on_events_hover}
                    $highlighted_station = {this.$highlighted_station}
                />
            </div>

            {/* Row 2 */}
            <div style = {{
                width: '100%',
                height: '50%',
            }}>
                <SelectablePanelsRow
                    items={panels}
                    bottom_left_element = {
                        <AudioPlaybackControls $audiodata={this.$audiodata} />
                    }
                    initial_preference  = {['plot', 'spectrogram', 'map']}
                />
            </div>
        </div>
        )
    }

    override async componentDidMount(): Promise<void> {
        const pyodide_vendored:boolean = 
            self.app_config?.pyodide_vendored ?? is_deno();
        const pyo:IPyodide|Error = await initialize_pyodide(pyodide_vendored)
        if(pyo instanceof Error) {
            console.error('Could not load pyodide')
            console.error(pyo as Error)
            return;
        }
        this.pyodide = pyo;
        this.$pyodide.value = pyo;
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

    /** Selected file index from the heatmap. */
    $selected_file_index: Signal<number|null> = new Signal(null)

    /** Selected slice start index from the heatmap. */
    $selected_slice_start_index: Signal<number|null> = new Signal(null)

    /** Currently active data in the 1D signal plot */
    $signal_plot_data: Signal<MSEED_SignalPlotData | null> = new Signal(null)

    /** Currently active data in the spectrogram plot */
    $spectrogram_plot_data: Signal<MSEED_SpectrogramData | null> = new Signal(null)

    /** Currently active data in the audio playback component */
    $audiodata: Signal<AudioWaveform | null> = new Signal(null)

    pyodide: IPyodide|undefined;
    $pyodide: Signal<IPyodide|undefined> = new Signal(undefined)

    /** Re-read data when slice length exceeds current data. */
    #_1 = signals.effect( (async () => {
        const slice_length: number = this.$signal_slice_length.value
        const selected_file_index: number|null = this.$selected_file_index.value
        const slice_start_index: number|null = this.$selected_slice_start_index.value
        const plot_data: MSEED_SignalPlotData|null = this.$signal_plot_data.value

        if(this.$plots_loading.value)
            return

        if(selected_file_index == null || slice_start_index == null)
            return

        if(plot_data == null)
            return

        const fs: number = plot_data.sample_rate_hz
        const slice_end_index: number = slice_start_index + slice_length * fs
        if(plot_data.data.length >= slice_end_index)
            return

        const result: Error|void = await this.read_signal_slice_for_plots(
            selected_file_index,
            slice_start_index,
            slice_end_index,
        )
        if(result instanceof Error)
            console.warn(result)
    }) as () => void )

    /** Read a signal slice and refresh all plots. */
    private async read_signal_slice_for_plots(
        selected_file_index: number,
        slice_start_index:   number,
        slice_end_index?:    number,
    ): Promise<void|Error> {
        if(this.$plots_loading.value)
            return

        this.$plots_loading.value = true

        try {
            if(this.pyodide == undefined)
                return new Error('Pyodide not initialized')

            const mseed: MSEED_FileAndMeta|undefined =
                this.props.$mseeds.value[selected_file_index]
            if(mseed == undefined) {
                return new Error(
                    `No mseed file at index ${selected_file_index}`
                )
            }

            const fs: number = mseed.meta.samplerate
            const resolved_slice_end_index: number = slice_end_index
                ?? (slice_start_index + this.$signal_slice_length.value * fs)

            const data: Float32Array|Error =
                await read_mseed_slice_across_files(
                    this.props.$mseeds.value,
                    selected_file_index,
                    [slice_start_index, resolved_slice_end_index],
                )
            if(data instanceof Error)
                return data

            const code: string = combine_mseed_codes(mseed.meta)
            const channel: Channel|null =
                find_channel_for_mseed_meta(
                    mseed.meta,
                    this.props.$stations.value,
                )

            this.$signal_plot_data.value = {
                data,
                start_time:        mseed.meta.starttime,
                sample_rate_hz:    mseed.meta.samplerate,
                code:              code,
                response:          channel?.response,
                slice_start_index: slice_start_index,
            }
            this.$spectrogram_plot_data.value = {
                signal:            data,
                start_time:        mseed.meta.starttime,
                fs:                mseed.meta.samplerate,
                code:              code,
                slice_start_index: slice_start_index,
            }
            this.$modulation_power_spectrum_data.value = {
                signal:        data,
                slice_indices: [slice_start_index, resolved_slice_end_index],
                start_time:    mseed.meta.starttime,
                fs:            mseed.meta.samplerate,
                code:          code,
            }
            this.$audiodata.value = {
                data: await slice_and_prepare_audio(
                    data,
                    slice_start_index,
                    resolved_slice_end_index,
                    mseed.meta.samplerate,
                    this.pyodide,
                ),
                samplerate: 8000,
            }

            return
        } finally {
            this.$plots_loading.value = false
        }
    }

    /** Called when user clicks on an item in the heatmap.
     *  Reading the corresponding segment from the MSEED file and forwarding
     *  to other components for visualization. */
    on_heatmap_item_select = async (selected_file_index:number, i0:number, i1:number) => {
        // TODO: remove i1, use $signal_slice_length instead
        
        if(this.$plots_loading.value)
            return

        this.$selected_file_index.value = selected_file_index
        this.$selected_slice_start_index.value = i0

        const result: Error|void = await this.read_signal_slice_for_plots(
            selected_file_index,
            i0,
            i1,
        )
        if(result instanceof Error)
            console.warn(result)
    }


    $modulation_power_spectrum_data:
        Signal<MSEED_ModulationPowerSpectrumData|null> = new Signal(null)

}


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





async function slice_and_prepare_audio(
    data: Float32Array, 
    i0:   number, 
    i1:   number,
    sample_rate_hz: number,
    pyo:  IPyodide,
): Promise<Float32Array> {
    i0 = Math.max(i0, 0)
    i1 = Math.min(i1, data.length)

    const sliced: Float32Array = data.slice(i0, i1)
    
    const result:Error|Float32Array = 
        await pyo.prepare_obs_signal_for_audio(sliced, sample_rate_hz)
    if(result instanceof Error)
        return new Float32Array([])
    // else
    return result;
}




/** Helper type to partition stations with and without loaded mseed metadata */
type PartitionedStations = {
    with_meta:    Station[];
    without_meta: Station[];
}
