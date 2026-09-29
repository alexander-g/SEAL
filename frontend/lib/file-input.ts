import { parse_stationxml_file, type Station } from './station-xml.ts'
import { parse_quakeml_file, type QuakeEvent } from './quakeml.ts'
import type { InferenceEvent } from "../ui/mseed-heatmap.tsx"
import {
    combine_mseed_codes,
    MSeedMetadata,
    read_mseed_metadata,
} from './mseed-parsing.ts'

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
    const metadata:Error|MSeedMetadata[] = await read_mseed_metadata(file)
    if(!(metadata instanceof Error)) {
        return {
            type: 'mseed',
            filename: file.name,
            meta: metadata
        }
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
                    all_meta.push( ...result.meta.map( (meta) => ({file, meta}) ) )
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
    mseeds:            MSEED_FileAndMeta[],
    code:              string,
    slice_start_time:  Date,
    slice_end_time:    Date,
): Promise<Float32Array|Error> {
    try {
        const normalized_code: string = code.trim()
        if(normalized_code.length == 0)
            return new Error('code must be non-empty')

        const slice_start_ms: number = slice_start_time.getTime()
        const slice_end_ms: number = slice_end_time.getTime()
        if(slice_end_ms <= slice_start_ms)
            return new Error('slice_end_time must be > slice_start_time')

        const matching_mseeds: MSEED_FileAndMeta[] = mseeds.filter((mseed) =>
            combine_mseed_codes(mseed.meta) == normalized_code
        )
        if(matching_mseeds.length == 0)
            return new Error(`Missing mseed file for code ${normalized_code}`)

        const samplerate: number = matching_mseeds[0]!.meta.samplerate
        const output_length: number = Math.floor(
            ((slice_end_ms - slice_start_ms) / 1000) * samplerate
        )
        if(output_length <= 0)
            return new Error('Requested output length must be > 0')

        const output: Float32Array = new Float32Array(output_length)
        const filled: Uint8Array = new Uint8Array(output_length)

        const candidates: MSEED_FileAndMeta[] = []
        for(const mseed of matching_mseeds) {
            const meta: MSeedMetadata = mseed.meta
            if(meta.samplerate != samplerate)
                continue

            const meta_start_ms: number = meta.starttime.getTime()
            const meta_end_ms: number = meta.endtime.getTime()
            if(meta_end_ms <= slice_start_ms)
                continue
            if(meta_start_ms >= slice_end_ms)
                continue
            candidates.push(mseed)
        }
        if(candidates.length == 0)
            return new Error('No overlapping mseed segments for requested time')

        candidates.sort((a: MSEED_FileAndMeta, b: MSEED_FileAndMeta) =>
            a.meta.starttime.getTime() - b.meta.starttime.getTime()
        )

        for(const mseed of candidates) {
            const data: Float32Array|Error =
                await tremorwasm.read_segment_data(mseed.file, {
                    code: normalized_code,
                    starttime: mseed.meta.starttime,
                })
            if(data instanceof Error)
                return data

            const meta_start_ms: number = mseed.meta.starttime.getTime()
            const offset_seconds: number =
                (meta_start_ms - slice_start_ms) / 1000
            const output_start_index: number =
                Math.round(offset_seconds * samplerate)

            if(output_start_index >= output_length)
                break
            const source_start_index: number = Math.max(0, -output_start_index)
            const clamped_output_start: number = Math.max(0, output_start_index)
            const available_samples: number =
                output_length - clamped_output_start
            const copy_samples: number = Math.min(
                data.length - source_start_index,
                available_samples,
            )
            if(copy_samples <= 0)
                continue

            for(let i:number = 0; i < copy_samples; i++) {
                const out_index: number = clamped_output_start + i
                if(filled[out_index] == 1)
                    continue
                const source_index: number = source_start_index + i
                output[out_index] = data[source_index] ?? data[data.length - 1]!
                filled[out_index] = 1
            }
        }

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
            const d: Date = parse_date_UTC_if_no_TZ(line)
            if(isNaN(d.getTime())) 
                return new Error();
            

            inference.push( {code, time:d} )
        }
        return inference;
    } catch {
        return new Error('Could not read inference csv file')
    }
}

/** Parse a date string, assuming UTC if not time zone is specified */
function parse_date_UTC_if_no_TZ(s:string): Date {
    const hasTZ:boolean = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
    return new Date(hasTZ ? s : s + "Z");
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
    meta:     MSeedMetadata[]
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
