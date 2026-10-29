
export type MSeedMetadata = {
    starttime:  Date;
    endtime:    Date;
    samplerate: number;
    network:    string;
    station:    string;
    location:   string;
    channel:    string;
}

export class NotMSEED extends Error {}


/** Read MiniSEED metadata from a Blob/File in the browser.
 *  Only read minimal bytes (first + last record headers). */
export 
async function read_mseed_metadata(blob: Blob): Promise<MSeedMetadata[]|NotMSEED|Error> {
    try{
        const firstbuf:DataView = await read_slice(blob, 0, 256);
        if(!is_mseed(firstbuf))
            return new NotMSEED('File is not in MSEED format')

        const little_endian:boolean|Error = detect_little_endian(firstbuf);
        if(little_endian instanceof Error)
            return little_endian

        const first:MSEED_Header = 
            parse_fixed_mseed_header(firstbuf, little_endian);
        // sanity check
        if(first.starttime.getUTCFullYear() > 2100)
            return new Error('Parsed year is far in the future.')

        const recordlength:number = 
            get_recordlength(firstbuf, little_endian) ?? 4096;

        const filesize:number = blob.size
        const record_count:number = Math.floor(filesize / recordlength)
        if(record_count <= 0)
            return new Error('MSEED file has no complete records.')

        const records:MSeedMetadata[] = []
        const target_chunk_bytes:number = 4 * 1024 * 1024
        const chunk_records:number = 
            Math.max(1, Math.floor(target_chunk_bytes / recordlength))

        for(
            let chunk_start_index:number = 0;
            chunk_start_index < record_count;
            chunk_start_index += chunk_records
        ) {
            const records_in_chunk:number = Math.min(
                chunk_records,
                record_count - chunk_start_index
            )
            const chunk_offset:number = chunk_start_index * recordlength
            const chunk_bytes:number = records_in_chunk * recordlength
            const chunk:DataView = await read_slice(blob, chunk_offset, chunk_bytes)

            for(let chunk_record:number = 0; chunk_record < records_in_chunk; chunk_record++) {
                const local_offset:number = chunk_record * recordlength
                if(local_offset + 48 > chunk.byteLength)
                    continue

                const recordbuf:DataView = new DataView(
                    chunk.buffer,
                    chunk.byteOffset + local_offset,
                    Math.min(64, chunk.byteLength - local_offset)
                )
                if(!is_mseed(recordbuf))
                    continue

                const parsed_header:MSEED_Header =
                    parse_fixed_mseed_header(recordbuf, little_endian)
                // sanity check
                if(parsed_header.starttime.getUTCFullYear() > 2100)
                    return new Error('Parsed year is far in the future.')
                if(parsed_header.samplerate <= 0)
                    return new Error('Parsed samplerate must be > 0.')

                const duration_seconds:number =
                    parsed_header.n_samples / parsed_header.samplerate
                const record_endtime:Date = new Date(
                    parsed_header.starttime.getTime() + duration_seconds * 1000
                )
                if(record_endtime.getUTCFullYear() > 2100)
                    return new Error('Parsed year is far in the future.')

                const codes:MSEED_Codes = parse_codes(recordbuf)
                records.push({
                    starttime:  parsed_header.starttime,
                    endtime:    record_endtime,
                    samplerate: parsed_header.samplerate,
                    network:    codes.network,
                    station:    codes.station,
                    location:   codes.location,
                    channel:    codes.channel,
                })
            }
        }

        if(records.length == 0)
            return new Error('No MSEED data records found.')

        return merge_records_into_segments(records)
    
    } catch (e) {
        return new Error(`Could not parse MSEED meta data: ${e}`)
    }
}

function merge_records_into_segments(records: MSeedMetadata[]): MSeedMetadata[] {
    const sorted_records:MSeedMetadata[] = [...records].sort(
        (meta0: MSeedMetadata, meta1: MSeedMetadata): number => {
            const code_compare:number = combine_mseed_codes(meta0).localeCompare(
                combine_mseed_codes(meta1)
            )
            if(code_compare != 0)
                return code_compare
            return meta0.starttime.getTime() - meta1.starttime.getTime()
        }
    )

    const output:MSeedMetadata[] = []
    for(const record of sorted_records) {
        const previous:MSeedMetadata|undefined = output[output.length - 1]
        if(previous == undefined) {
            output.push(record)
            continue
        }
        if(!same_trace(previous, record)) {
            output.push(record)
            continue
        }

        const sample_spacing_ms:number = 1000 / record.samplerate
        const max_gap_ms:number = sample_spacing_ms * 1.5
        const gap_ms:number =
            record.starttime.getTime() - previous.endtime.getTime()

        if(gap_ms > max_gap_ms) {
            output.push(record)
            continue
        }

        if(record.endtime.getTime() > previous.endtime.getTime())
            previous.endtime = record.endtime
    }

    return output.sort((meta0: MSeedMetadata, meta1: MSeedMetadata) =>
        meta0.starttime.getTime() - meta1.starttime.getTime()
    )
}

function same_trace(meta0: MSeedMetadata, meta1: MSeedMetadata): boolean {
    if(meta0.network != meta1.network)
        return false
    if(meta0.station != meta1.station)
        return false
    if(meta0.location != meta1.location)
        return false
    if(meta0.channel != meta1.channel)
        return false
    if(meta0.samplerate != meta1.samplerate)
        return false
    return true
}



async function read_slice(
    blob:   Blob,
    start:  number,
    length: number
): Promise<DataView> {
    const slice:Blob = blob.slice(start, start + length);
    const buffer:ArrayBuffer = await slice.arrayBuffer();
    return new DataView(buffer);
}


type MSEED_Header = {
    starttime:   Date,
    n_samples:   number,
    samplerate:  number,
};

type MSEED_Codes = {
    station:     string,
    location:    string,
    channel:     string,
    network:     string,
}


function parse_codes(view: DataView): MSEED_Codes {
    const station:string  = read_ascii(view, 8, 5);
    const location:string = read_ascii(view, 13, 2);
    const channel:string  = read_ascii(view, 15, 3);
    const network:string  = read_ascii(view, 18, 2);

    return {station, location, channel, network}
}


function parse_fixed_mseed_header(
    view: DataView,
    little_endian: boolean
): MSEED_Header {
    const fields:FixedHeaderFields = read_fixed_header_fields(view, little_endian);

    const starttime:Date = doy_to_date(
        fields.year,
        fields.day,
        fields.hour,
        fields.minute,
        fields.second,
        fields.tenth_msec
    );

    const samplerate:number = compute_samplerate(
        fields.sampleratefactor,
        fields.sampleratemultiplier
    );

    return {
        starttime,
        n_samples: fields.n_samples,
        samplerate,
    };
}


function read_ascii(view: DataView, offset: number, length: number): string {
    let s:string = "";
    for (let i:number = 0; i < length; i++) {
        const c:number = view.getUint8(offset + i);
        if(c !== 0)
            s += String.fromCharCode(c);
    }
    return s.trim();
}

function compute_samplerate(factor: number, multiplier: number): number {
    const f:number = factor === 0 ? 1 : factor;
    const m:number = multiplier === 0 ? 1 : multiplier;
    const f_abs:number = Math.abs(f);
    const m_abs:number = Math.abs(m);

    if(f > 0 && m > 0)
        return f_abs * m_abs;
    if(f > 0 && m < 0)
        return f_abs / m_abs;
    if(f < 0 && m > 0)
        return m_abs / f_abs;
    return 1 / (f_abs * m_abs);
}

/** Day of year to a Date */
function doy_to_date(
    year:  number,
    day:    number,
    hour:   number,
    minute: number,
    second: number,
    tenthMillisec: number
): Date {
    const date = new Date(Date.UTC(year, 0));
    date.setUTCDate(day);
    date.setUTCHours(
        hour,
        minute,
        second,
        Math.floor(tenthMillisec / 10)
    );
    return date;
}

function get_recordlength(
    view:DataView,
    little_endian: boolean
): number|null {
    const first_blockette_offset:number = view.getUint16(
        46,
        little_endian
    );
    if(first_blockette_offset === 0) 
        return null;

    let ptr:number = first_blockette_offset;

    while (ptr < view.byteLength) {
        const type:number = view.getUint16(ptr, little_endian);

        if (type === 1000) {
            const exponent:number = view.getUint8(ptr + 6);
            return Math.pow(2, exponent);
        }

        const next:number = view.getUint16(ptr + 2, little_endian);
        if(next === 0) 
            break;
        ptr = next;
    }
    return null;
}

type FixedHeaderFields = {
    year: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    tenth_msec: number,
    n_samples: number,
    sampleratefactor: number,
    sampleratemultiplier: number,
}

function read_fixed_header_fields(
    view: DataView,
    little_endian: boolean
): FixedHeaderFields {
    const year:number       = view.getUint16(20, little_endian);
    const day:number        = view.getUint16(22, little_endian);
    const hour:number       = view.getUint8(24);
    const minute:number     = view.getUint8(25);
    const second:number     = view.getUint8(26);
    const tenth_msec:number = view.getUint16(28, little_endian);

    const n_samples:number = view.getUint16(30, little_endian);
    const sampleratefactor:number = view.getInt16(32, little_endian);
    const sampleratemultiplier:number = view.getInt16(34, little_endian);

    return {
        year,
        day,
        hour,
        minute,
        second,
        tenth_msec,
        n_samples,
        sampleratefactor,
        sampleratemultiplier,
    }
}

function detect_little_endian(view: DataView): boolean|Error {
    const big:FixedHeaderFields = read_fixed_header_fields(view, false);
    const little:FixedHeaderFields = read_fixed_header_fields(view, true);

    const big_valid:boolean = is_header_sane(big);
    const little_valid:boolean = is_header_sane(little);

    if(big_valid && !little_valid)
        return false
    if(little_valid && !big_valid)
        return true

    if(big_valid && little_valid) {
        const big_word_order:number|null = find_blockette_word_order(
            view,
            false
        );
        if(big_word_order === 0)
            return true
        if(big_word_order === 1)
            return false

        const little_word_order:number|null = find_blockette_word_order(
            view,
            true
        );
        if(little_word_order === 0)
            return true
        if(little_word_order === 1)
            return false

        return false
    }

    return new Error('Could not determine MSEED byte order.')
}

function is_header_sane(fields: FixedHeaderFields): boolean {
    if(fields.year < 1900 || fields.year > 2100)
        return false
    if(fields.day < 1 || fields.day > 366)
        return false
    if(fields.hour > 23)
        return false
    if(fields.minute > 59)
        return false
    if(fields.second > 60)
        return false
    if(fields.tenth_msec > 9999)
        return false
    return true
}

function find_blockette_word_order(
    view: DataView,
    little_endian: boolean
): number|null {
    const first_blockette_offset:number = view.getUint16(
        46,
        little_endian
    );
    if(first_blockette_offset === 0)
        return null
    if(first_blockette_offset >= view.byteLength)
        return null

    let ptr:number = first_blockette_offset;
    while (ptr + 7 < view.byteLength) {
        const type:number = view.getUint16(ptr, little_endian);
        if(type === 1000) {
            return view.getUint8(ptr + 5);
        }

        const next:number = view.getUint16(ptr + 2, little_endian);
        if(next === 0)
            break
        if(next <= ptr)
            break
        ptr = next
    }
    return null
}


export function is_mseed(view:DataView): boolean {
    if (view.byteLength < 48)
        return false;

    // sequence number: bytes 0-5 should be ASCII digits or spaces
    for (let i:number = 0; i < 6; i++) {
        const c:number = view.getUint8(i);
        if (!(c === 0x20 || (c >= 0x30 && c <= 0x39)))
            return false;
    }

    // byte 6 often space (0x20) or control; allow printable or zero
    const b6:number = view.getUint8(6);
    if (!(b6 === 0x20 || (b6 >= 0x20 && b6 <= 0x7E) || b6 === 0))
        return false;

    // byte 7: 0x20 ?
    const b7:number = view.getUint8(7);
    if(b7 != 0x20)
        return false;
    return true;
}



export function combine_mseed_codes(meta: MSeedMetadata): string {
    return `${meta.network}.${meta.station}.${meta.location}.${meta.channel}`
}
