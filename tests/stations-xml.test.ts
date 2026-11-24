import {
    load_stations_from_storage,
    merge_stations,
    parse_stationxml_file,
    save_stations_to_storage,
    type Station,
} from "../frontend/lib/station-xml.ts";
import { Signal } from "../frontend/dep.ts";
import { MainContent } from "../frontend/ui/main-content.tsx";
import type { MSEED_FileAndMeta } from "../frontend/lib/file-input.ts";
import * as path from "@std/path"
import { assert } from "asserts";


const STATIONSXMLFILE:string = path.fromFileUrl(
    import.meta.resolve('./assets/stations.xml')
)

const STATIONSXMLFILE2:string = path.fromFileUrl(
    import.meta.resolve('./assets/stations.sensitivity-none.xml')
)
const QUAKEMLFILE:string = path.fromFileUrl(
    import.meta.resolve('./assets/events.xml')
)




Deno.test('parse_stationxml', async () => {
    const f:File = new File([Deno.readFileSync(STATIONSXMLFILE)], "stations.xml")
    const output0:Station[]|Error = await parse_stationxml_file(f)
    assert(!(output0 instanceof Error))

    assert(output0.length == 9, `${output0.length}` )

    const channels = output0.map( station => station.channels ).filter(Boolean).flat()
    assert(channels.length == 4)

    const responses = channels.map( c => c?.response ).filter(Boolean).flat()
    assert(responses.length == 2)

    const networks = new Set(output0.map( station => station.network ))
    assert(networks.size == 1)
    assert(networks.has('XXX'))
})

// actual bug, instrument response value is None (as saved by obspy)
Deno.test('parse_stationxml2', async () => {
    const f:File = new File([Deno.readFileSync(STATIONSXMLFILE2)], "stations.xml")
    const output0:Station[]|Error = await parse_stationxml_file(f)
    
    // just dont fail
    assert(!(output0 instanceof Error))
})


Deno.test('parse_stationxml.invalid', async () => {
    const f:File = new File([Deno.readFileSync(QUAKEMLFILE)], "stations.xml")
    const output0:Station[]|Error = await parse_stationxml_file(f)
    assert(output0 instanceof Error)
})


Deno.test('merge_stations replaces stations with matching code and keeps others', () => {
    const existing: Station[] = [
        { code: 'STA1', network: 'XX', latitude: 10, longitude: 20, from_storage: true },
        { code: 'STA2', network: 'XX', latitude: 30, longitude: 40, from_storage: true },
    ]
    const incoming: Station[] = [
        { code: 'STA1', network: 'YY', latitude: 11, longitude: 21 },
        { code: 'STA3', network: 'XX', latitude: 50, longitude: 60 },
    ]
    const merged: Station[] = merge_stations(existing, incoming)
    assert(merged.length == 3)
    const sta1: Station | undefined = merged.find((s) => s.code == 'STA1')
    const sta2: Station | undefined = merged.find((s) => s.code == 'STA2')
    const sta3: Station | undefined = merged.find((s) => s.code == 'STA3')
    assert(sta1 != undefined && sta1.latitude == 11 && !sta1.from_storage)
    assert(sta2 != undefined && sta2.latitude == 30 && sta2.from_storage == true)
    assert(sta3 != undefined && sta3.latitude == 50 && !sta3.from_storage)
})


Deno.test('save_stations_to_storage and load_stations_from_storage roundtrip and handle invalid data', () => {
    localStorage.clear()
    assert(load_stations_from_storage().length == 0)

    const stations: Station[] = [
        { code: 'STA1', network: 'XX', latitude: 12.5, longitude: -45.2 },
    ]
    const save_result: null | Error = save_stations_to_storage(stations)
    assert(!(save_result instanceof Error))

    const loaded: Station[] = load_stations_from_storage()
    assert(loaded.length == 1)
    assert(loaded[0]!.code == 'STA1')
    assert(loaded[0]!.from_storage == true)

    localStorage.setItem('stations', '{invalid json')
    const broken: Station[] = load_stations_from_storage()
    assert(broken.length == 0)
    localStorage.clear()
})


Deno.test('MainContent map markers ignore stored stations without mseed for centering', () => {
    const $mseeds = new Signal<MSEED_FileAndMeta[]>([
        {
            file: new File([], 'dummy'),
            meta: {
                network:    'XX',
                station:    'STA_LOADED_MSEED',
                location:   '',
                channel:    'HHZ',
                starttime:  new Date('2026-01-01T00:00:00Z'),
                endtime:    new Date('2026-01-01T00:05:00Z'),
                samplerate: 100,
            },
        },
    ])
    const $stations = new Signal<Station[]>([
        {
            code:         'STA_STORED_NO_MSEED',
            network:      'XX',
            latitude:     10,
            longitude:    20,
            from_storage: true,
        },
        {
            code:         'STA_NEW_NO_MSEED',
            network:      'XX',
            latitude:     11,
            longitude:    21,
        },
        {
            code:         'STA_LOADED_MSEED',
            network:      'XX',
            latitude:     12,
            longitude:    22,
            from_storage: true,
        },
    ])
    const content = new MainContent({
        $mseeds:    $mseeds,
        $inference: new Signal([]),
        $stations:  $stations,
        $events:    new Signal([]),
        app_config: null,
    })

    const markers = content.$map_markers.value
    const stored_no_mseed = markers.find((m) => m.label == 'STA_STORED_NO_MSEED')
    const new_no_mseed = markers.find((m) => m.label == 'STA_NEW_NO_MSEED')
    const loaded_mseed = markers.find((m) => m.label == 'STA_LOADED_MSEED')

    assert(stored_no_mseed != undefined && stored_no_mseed.ignore_for_centering == true)
    assert(new_no_mseed != undefined && !new_no_mseed.ignore_for_centering)
    assert(loaded_mseed != undefined && !loaded_mseed.ignore_for_centering)
})







