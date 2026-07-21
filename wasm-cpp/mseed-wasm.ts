

// for readability
type pointer = number;

type TremorWASM_Module = {
    _read_mseed: (
        buffer:         pointer, 
        bufferlength:   bigint,
        // outputs
        starttime_u64:  pointer,
        endtime_u64:    pointer,
        nsamples_u64:   pointer,
        samplerate_f64: pointer,
        code_32bytes:   pointer,

        // optional outputs
        samplebuffer_i32:  pointer,
        samplebuffer_size: pointer,
    ) => number;

    _write_mseed: (
        samples:        pointer,
        samplecount:    bigint,
        samplerate_f64: number,
        starttime_u64:  bigint,
        code:           pointer,
        codelength:     bigint,
        recordlength:   number,
        encoding:       number,
        out_buffer_ptr: pointer,
        out_length_ptr: pointer,
    ) => number;

    _malloc: (nbytes:number) => pointer,
    _free:   (ptr:pointer) => void,

    HEAPU8: {
        set:   (src:Uint8Array, dst:pointer) => void,
        slice: (start:number,   end:number)  => Uint8Array,
        buffer: ArrayBuffer,
        length: number,
        [i:number]: number,
    },
    HEAP64: {
        [i:number]: bigint,
    },
}


type MSEED_Meta = {
    start: Date
    end:   Date
    code:  string
    samplerate: number
    nsamples:   number
}

type MSEED_ReadResult = {
    data: Float32Array|null;
    meta: MSEED_Meta;
}

export type MSEED_WriteOptions = {
    code:          string
    samplerate:    number
    starttime:     Date
    recordlength?: number
    encoding?:     number
    filename?:     string
}

/** Configure wasm memory guardrails and reinit behavior. */
type TremorWasmOptions = {
    max_memory_bytes?: number
    reinitialize_wasm?: () => Promise<TremorWASM_Module>
}

const DEFAULT_MAX_MEMORY_BYTES:number = 1024 * 1024 * 768


export class TremorWasm {
    /** Read MiniSEED with automatic wasm reinit on memory growth. */
    constructor(
        private wasm:TremorWASM_Module,
        options?:TremorWasmOptions,
    ) {
        this.#max_memory_bytes =
            options?.max_memory_bytes ?? DEFAULT_MAX_MEMORY_BYTES
        this.#reinitialize_wasm = options?.reinitialize_wasm
    }

    async read_metadata(file:File): Promise<MSEED_Meta|Error> {
        const readresult:MSEED_ReadResult|Error = await this._read(file, 0);
        return (readresult instanceof Error)? readresult : readresult.meta;
    }

    private async _read(
        file:File,
        nsamplestoread:number,
    ): Promise<MSEED_ReadResult|Error> {
        const reinit_error:Error|null =
            await this.#maybe_reinitialize_if_needed()
        if(reinit_error instanceof Error)
            return reinit_error

        const readresult:MSEED_ReadResult|Error =
            await this._read_internal(file, nsamplestoread)
        
        return readresult;
    }

    private async _read_internal(
        file:File,
        nsamplestoread:number,
    ): Promise<MSEED_ReadResult|Error> {
        try {
            const buffer:Uint8Array = new Uint8Array(await file.arrayBuffer())
            const buffer_p:pointer  = this.#malloc(buffer.length)
            this.wasm.HEAPU8.set(buffer, buffer_p);

            const starttime_p:  pointer = this.#malloc(8);
            const endtime_p:    pointer = this.#malloc(8);
            const nsamples_p:   pointer = this.#malloc(8);
            const samplerate_p: pointer = this.#malloc(8);
            const code_p:       pointer = this.#malloc(32);
            
            nsamplestoread = Math.max(0, nsamplestoread);
            if(nsamplestoread < 0)
                return new Error('Invalid number of samples to read')
            const samplebuffersize:number = 
                nsamplestoread * Float32Array.BYTES_PER_ELEMENT;
            const samplebuffer_p:pointer = 
                (nsamplestoread > 0) ? this.#malloc(samplebuffersize) : 0;

            const rc:number = this.wasm._read_mseed(
                buffer_p,
                BigInt(buffer.length), 
                starttime_p, 
                endtime_p, 
                nsamples_p, 
                samplerate_p, 
                code_p,
                samplebuffer_p,
                nsamplestoread,
            );
            if(rc != 0)
                return new Error(`Could not read mseed. (${rc})`)
        
            const starttime_u64:BigUint64Array = new BigUint64Array(
                this.wasm.HEAPU8.slice(
                    starttime_p, 
                    starttime_p + 8
                ).buffer
            )
            const endtime_u64:BigUint64Array = new BigUint64Array(
                this.wasm.HEAPU8.slice(
                    endtime_p, 
                    endtime_p + 8
                ).buffer
            )
            const nsamples_u64:BigUint64Array = new BigUint64Array(
                this.wasm.HEAPU8.slice(
                    nsamples_p, 
                    nsamples_p + 8
                ).buffer
            )
            const samplerate_f64:Float64Array = new Float64Array(
                this.wasm.HEAPU8.slice(
                    samplerate_p, 
                    samplerate_p + 8
                ).buffer
            )
            const code:string = new TextDecoder().decode(
                this.wasm.HEAPU8.slice(
                    code_p, 
                    code_p + 32
                ).buffer,
            ).replace(/\0/g, '');

            const samplebuffer:Float32Array|null = 
                (nsamplestoread > 0)
                ? new Float32Array(
                    this.wasm.HEAPU8.slice(
                        samplebuffer_p, 
                        samplebuffer_p + samplebuffersize
                    ).buffer
                )
                : null;
            
        
            const t_start = new Date(Number(starttime_u64[0]! / 1000000n))
            const t_end   = new Date(Number(endtime_u64[0]! / 1000000n))
            return {
                meta: {
                    start:      t_start,
                    end:        t_end,
                    code:       code,
                    samplerate: Number(samplerate_f64[0]),
                    nsamples:   Number(nsamples_u64[0])
                },
                data: samplebuffer,
            }
        } catch(e) {
            console.log('WASM error:', e)
            return (e instanceof Error) ? e : new Error(String(e))
        } finally {
            this.#free_allocated_buffers();
        }
    }

    async read_data(file:File): Promise<Float32Array|Error> {
        const meta:MSEED_Meta|Error = await this.read_metadata(file);
        if(meta instanceof Error)
            return meta as Error;

        const readresult:MSEED_ReadResult|Error = 
            await this._read(file, meta.nsamples)
        return (readresult instanceof Error)? readresult : readresult.data!;
    }

    /** Write MiniSEED data and return a File. */
    async write_mseed(
        data:    Float32Array,
        options: MSEED_WriteOptions
    ): Promise<File|Error> {
        const reinit_error:Error|null =
            await this.#maybe_reinitialize_if_needed()
        if(reinit_error instanceof Error)
            return reinit_error

        try {
            const samplecount:number = data.length
            if(samplecount <= 0)
                return new Error('No samples to write')

            const code:string = options.code.trim()
            if(code.length == 0)
                return new Error('Missing MSEED code')

            const samples_p:pointer =
                this.#malloc(samplecount * Float32Array.BYTES_PER_ELEMENT)
            const sample_u8:Uint8Array =
                new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            this.wasm.HEAPU8.set(sample_u8, samples_p)

            const code_bytes:Uint8Array = new TextEncoder().encode(code)
            const code_p:pointer = this.#malloc(code_bytes.length)
            this.wasm.HEAPU8.set(code_bytes, code_p)

            const output_buffer_ptr_p:pointer = this.#malloc(4)
            const output_length_p:pointer = this.#malloc(8)

            const recordlength:number = options.recordlength ?? 4096
            const encoding:number = options.encoding ?? 4
            const starttime_u64:bigint = BigInt(options.starttime.getTime()) * 1000000n

            const rc:number = this.wasm._write_mseed(
                samples_p,
                BigInt(samplecount),
                options.samplerate,
                starttime_u64,
                code_p,
                BigInt(code_bytes.length),
                recordlength,
                encoding,
                output_buffer_ptr_p,
                output_length_p,
            )
            if(rc != 0)
                return new Error(`Could not write mseed. (${rc})`)

            const output_buffer_ptr:Uint32Array = new Uint32Array(
                this.wasm.HEAPU8.slice(
                    output_buffer_ptr_p,
                    output_buffer_ptr_p + 4
                ).buffer
            )
            const output_length_u64:BigUint64Array = new BigUint64Array(
                this.wasm.HEAPU8.slice(
                    output_length_p,
                    output_length_p + 8
                ).buffer
            )

            const output_ptr_number:number = output_buffer_ptr[0] ?? 0
            const output_length:number = Number(output_length_u64[0])
            if(output_length <= 0 || output_ptr_number <= 0)
                return new Error('No output written')

            const output_data:Uint8Array = this.wasm.HEAPU8.slice(
                output_ptr_number,
                output_ptr_number + output_length
            )
            this.wasm._free(output_ptr_number)

            const filename:string =
                options.filename ?? `${code.replace(/\s+/g, '_')}.mseed`
            return new File(
                [output_data.buffer as ArrayBuffer], 
                filename, 
                {type: 'application/octet-stream'}
            )
        } catch(e) {
            return (e instanceof Error) ? e : new Error(String(e))
        } finally {
            this.#free_allocated_buffers()
        }
    }



    /** Pointers to buffers that still need to be freed. */
    #allocated_buffers:pointer[] = []

    /** Re-initialize the wasm instance if allocated more memory than this */
    #max_memory_bytes:number = DEFAULT_MAX_MEMORY_BYTES;

    #reinitialize_wasm?:() => Promise<TremorWASM_Module>

    #malloc(nbytes:number, fill?:number): pointer {
        const p:pointer = this.wasm._malloc(nbytes);
        this.wasm.HEAPU8.set(new Uint8Array(nbytes).fill(fill ?? 0), p)
        this.#allocated_buffers.push(p);
        return p;
    }

    /** Current wasm heap size in bytes. */
    #get_heap_bytes(): number {
        return this.wasm.HEAPU8.buffer.byteLength
    }

    /** Reinitialize wasm instance when heap exceeds threshold. */
    async #maybe_reinitialize_if_needed(): Promise<Error|null> {
        if(!this.#reinitialize_wasm)
            return null

        const heap_bytes:number = this.#get_heap_bytes()
        if(heap_bytes <= this.#max_memory_bytes)
            return null

        return await this.#reinitialize_wasm_instance()
    }

    /** Swap wasm instance to allow heap to reset. */
    async #reinitialize_wasm_instance(): Promise<Error|null> {
        if(!this.#reinitialize_wasm)
            return new Error('Missing wasm reinitializer')

        try {
            this.wasm = await this.#reinitialize_wasm()
            this.#allocated_buffers = []
            return null
        } catch(e) {
            return (e instanceof Error) ? e : new Error(String(e))
        }
    }

    #free_allocated_buffers() {
        for(const buffer_p of this.#allocated_buffers)
            this.wasm._free(buffer_p);
        this.#allocated_buffers = []
    }
}




type Iinitialize = () => Promise<TremorWasm>;

export const initialize:Iinitialize = async () => {
    const reinitialize_wasm: () => Promise<TremorWASM_Module> = 
        async (): Promise<TremorWASM_Module> => {
            const wasm:TremorWASM_Module = await (
                await import('./build-wasm/wasm-mseed.js')
            // deno-lint-ignore no-explicit-any
            ).default() as any;

            return wasm
        }

    const wasm:TremorWASM_Module = await reinitialize_wasm()

    return new TremorWasm(wasm, {
        reinitialize_wasm: reinitialize_wasm,
    })
}
