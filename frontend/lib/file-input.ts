import { parse_stationxml_file, type Station } from './station-xml.ts'
import { parse_quakeml_file, type QuakeEvent } from './quakeml.ts'
import type { InferenceEvent } from "../ui/mseed-heatmap.tsx"
import { MSeedMetadata, read_mseed_metadata } from "./mseed-parsing.ts"

import { 
    initialize as tremorwasm_initialize, 
    type TremorWasm,
} from "../../wasm-cpp/mseed-wasm.ts"
export const tremorwasm:TremorWasm = await tremorwasm_initialize()


export type MSEED_FileAndMeta = {
    file: File;
    meta: MSeedMetadata;
}


export type ProcessedFiles = {
    mseeds:     MSEED_FileAndMeta[];
    stations:   Station[];
    inference_events: InferenceEvent[];
    events:     QuakeEvent[];

    unknown_files: File[];
}

export type ProgressCallback = (processed: number, total: number) => void



/** Try to parse a single file, as stationxml, quakeml, mseed or a custom format */
export 
async function parse_file(file: File): Promise<FileResult|Error> {
    // Try MSEED
    // NOTE: should be first, much faster that way
    const meta:Error|MSeedMetadata = await read_mseed_metadata(file)
    if(!(meta instanceof Error))
        return {
            type: 'mseed',
            filename: file.name,
            meta
        }

    // Try StationXML
    const station: Station[] | Error = await parse_stationxml_file(file)
    if(!(station instanceof Error))
        return {
            type: 'station',
            stations: station,
        }

    // try quakeml
    const events:QuakeEvent[]|Error = await parse_quakeml_file(file)
    if(!(events instanceof Error))
        return {
            type: 'quakeevent',
            quakeevents: events
        }



    // Try CSV inference
    const inference: InferenceEvent[] | Error = await read_csv_inference_file(file)
    if(!(inference instanceof Error))
        return {
            type:     'inference',
            inference: inference,
        }

    // Unknown file
    return {
        type: 'unknown',
        filename: file.name,
    }
}


/** Process dropped files, read metadata */
export async function process_dropped_files(
    files:        File[],
    on_progress?: ProgressCallback
): Promise<ProcessedFiles> {
    const all_meta:MSEED_FileAndMeta[]   = []
    const all_stations:Station[]         = []
    const all_inference:InferenceEvent[] = []
    const all_events:  QuakeEvent[]      = []
    const all_unknown: File[]            = []

    let processed_count:number = 0
    const batchsize = 20;
    for(let index:number = 0; index < files.length; index+=batchsize) {
        const promises:Promise<FileResult|Error>[] = []
        for(let file_index:number = index; file_index < Math.min(index+batchsize, files.length); file_index++) {
            const file:File = files[file_index]!
            promises.push( parse_file(file) )
        }

        for(const promise_index in promises) {
            const file_index:number = Number(promise_index) + index;
            const file = files[file_index]!
            const result:FileResult|Error = await promises[promise_index]!

            if (result instanceof Error)
                console.warn('File processing error:', result)
            else {
                if (result.type === 'mseed')
                    all_meta.push({
                        file: file,
                        meta: result.meta,
                    })
                else if (result.type === 'station')
                    all_stations.push(...result.stations)
                else if (result.type === 'inference')
                    all_inference.push(...result.inference)
                else if (result.type === 'quakeevent')
                    all_events.push(...result.quakeevents)
                else if (result.type === 'unknown')
                    all_unknown.push(file)
            }
            processed_count++
        }
        if (on_progress)
            on_progress(processed_count, files.length)
    }

    return {
        mseeds:           all_meta,
        stations:         all_stations,
        inference_events: all_inference,
        events:           all_events,
        unknown_files:    all_unknown,
    }
}


/** Read a single time slice across multiple MSEED files. */
export async function read_mseed_slice_across_files(
    mseeds:              MSEED_FileAndMeta[],
    selected_file_index: number,
    slice_indices:       [number, number],
): Promise<Float32Array|Error> {
    try {
        const selected_mseed: MSEED_FileAndMeta|undefined =
            mseeds[selected_file_index]
        if(selected_mseed == undefined)
            return new Error(`Missing mseed file at ${selected_file_index}`)

        const slice_start_index: number = slice_indices[0]
        const slice_end_index: number = slice_indices[1]
        if(slice_start_index < 0)
            return new Error('slice_start_index must be >= 0')
        if(slice_end_index <= slice_start_index)
            return new Error('slice_end_index must be > slice_start_index')

        const base_meta: MSeedMetadata = selected_mseed.meta
        const samplerate: number = base_meta.samplerate
        const output_length: number = Math.floor(slice_end_index)
        if(output_length <= 0)
            return new Error('slice_end_index must be > 0')

        const base_start_ms: number = base_meta.starttime.getTime()
        const slice_end_ms: number = base_start_ms
            + (output_length / samplerate) * 1000

        const output: Float32Array = new Float32Array(output_length)
        const filled: Uint8Array = new Uint8Array(output_length)

        const candidates: MSEED_FileAndMeta[] = []
        let selected_candidate: MSEED_FileAndMeta|undefined = undefined
        for(const mseed of mseeds) {
            const meta: MSeedMetadata = mseed.meta
            if(!matching_station_codes(meta, base_meta))
                continue
            if(meta.samplerate != samplerate)
                return new Error('MSEED samplerate mismatch')

            const meta_start_ms: number = meta.starttime.getTime()
            const meta_end_ms: number = meta.endtime.getTime()
            if(meta_end_ms <= base_start_ms)
                continue
            if(meta_start_ms >= slice_end_ms)
                continue
            candidates.push(mseed)
            if(mseed === selected_mseed)
                selected_candidate = mseed
        }

        candidates.sort((a: MSEED_FileAndMeta, b: MSEED_FileAndMeta) =>
            a.meta.starttime.getTime() - b.meta.starttime.getTime()
        )

        const ordered_candidates: MSEED_FileAndMeta[] = []
        if(selected_candidate)
            ordered_candidates.push(selected_candidate)
        for(const candidate of candidates) {
            if(candidate === selected_candidate)
                continue
            ordered_candidates.push(candidate)
        }

        for(const mseed of ordered_candidates) {
            const data: Float32Array|Error =
                await tremorwasm.read_data(mseed.file)
            if(data instanceof Error)
                return data

            const meta_start_ms: number = mseed.meta.starttime.getTime()
            const offset_seconds: number = (meta_start_ms - base_start_ms) / 1000
            const output_start_index: number =
                Math.round(offset_seconds * samplerate)

            if(output_start_index >= output_length)
                break
            if(output_start_index < 0)
                continue

            const available_samples: number = output_length - output_start_index
            const copy_samples: number = Math.min(data.length, available_samples)
            if(copy_samples <= 0)
                continue

            for(let i:number = 0; i < copy_samples; i++) {
                const out_index: number = output_start_index + i
                if(filled[out_index] == 1)
                    continue
                output[out_index] = data[i] ?? 0
                filled[out_index] = 1
            }
        }

        if(slice_start_index >= output_length)
            return new Error('slice_start_index exceeds output length')

        return output
    } catch(e) {
        return (e instanceof Error) ? e : new Error(String(e))
    }
}



export 
async function read_csv_inference_file(file:File): Promise<InferenceEvent[]|Error> {
    try {
        const code:string|null = parse_station_code_from_filename(file.name)
        if(code == null)
            return new Error(`Could not parse station code from "${file.name}"`)
        const content:string = await file.text()
        const lines:string[] = content.trim().split('\n')

        const inference:InferenceEvent[] = []
        for(const line of lines) {
            const d = new Date(line)
            if(isNaN(d.getTime())) 
                return new Error();
            

            inference.push( {code, time:d} )
        }
        return inference;
    } catch {
        return new Error('Could not read inference csv file')
    }
}


/** Check network, station, channel match. */
function matching_station_codes(
    meta0: MSeedMetadata,
    meta1: MSeedMetadata,
): boolean {
    if(meta0.network != meta1.network)
        return false
    if(meta0.station != meta1.station)
        return false
    if(meta0.channel != meta1.channel)
        return false
    return true
}

export function parse_station_code_from_filename(input: string): string|null {
    input = input.replace(/\.(txt)$/i, '')
    input = input.replace(/\.(csv)$/i, '')

    const timestring:string|null = find_iso_time(input)
    if(timestring)
        input = input.replace(timestring, '')

    // characters only
    //const rx = /([A-Z]{0,5})\.([A-Z]{0,5})\.([A-Z]{0,5})\.([A-Z]{0,5})/;

    // characters and numbers
    const rx = /([A-Z0-9]{0,5})\.([A-Z0-9]{0,5})\.([A-Z0-9]{0,5})\.([A-Z0-9]{0,5})/i;
    
    const m:RegExpMatchArray|null = input.match(rx)
    return m ? m[0] : null;
}

export function find_iso_time(input: string): string|null {
    const iso_time_regex = /\b\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?\b/;
    const m:RegExpMatchArray|null = input.match(iso_time_regex);
    return m ? m[0] : null;
}


type FileResult = {
    type:    'mseed'
    meta:     MSeedMetadata
    filename: string
} 
| {
    type:    'station'
    stations: Station[]
} 
| {
    type:      'inference'
    inference: InferenceEvent[]
} 
| {
    type:       'quakeevent'
    quakeevents: QuakeEvent[]
}
| {
    type:    'unknown'
    filename: string
}
