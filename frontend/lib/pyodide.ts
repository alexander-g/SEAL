import * as pyo from 'pyodide'

import { is_deno, fetch_no_throw } from "./util.ts";
import type { 
    WorkerInitCommand,
    WorkerModulationPowerSpectrumCommand,
    WorkerPlotDataCommand,
    WorkerPrepareForAudioCommand,
    WorkerMessage,
    WorkerSpectrogramCommand,
    SpectrogramData,
} from "./pyodide-worker.ts";


const PLOT_DATA_PY_SCRIPT:string = 'pyodide_plot.py'

// NOTE: used by the build script
export const PYODIDE_SCRIPTS:string[] = [PLOT_DATA_PY_SCRIPT]




export interface IPyodide {
    /** Plot a 1D time series via matplotlib and return a PNG file. */
    plot_data(
        data:Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<File|Error>;

    /** Compute a 1D time series spectrogram and return data. */
    plot_spectrogram(
        data: Float32Array,
        i0:   number,
        i1:   number,
        start_time:     Date,
        sample_rate_hz: number,
        title:          string,
    ): Promise<SpectrogramData|Error>;

    /** Compute modulation power spectrum data. */
    plot_modulation_power_spectrum(
        data: Float32Array,
        i0: number,
        i1: number,
        start_time: Date,
        sample_rate_hz: number,
        title: string,
    ): Promise<SpectrogramData|Error>;

    /** Convert a raw mseed signal to an audio signal */
    prepare_obs_signal_for_audio(
        data: Float32Array, 
        sample_rate_hz: number
    ): Promise<Float32Array|Error>;
}




/** Public interface for pyodide running in a worker */
export class PyodideInWorker implements IPyodide {
    constructor(private readypromise:Promise<PyodideToWorkerInterface|Error>){}

    async plot_data(
        data:Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<File|Error> {
        const internal:IPyodide|Error = await this.readypromise;
        if(internal instanceof Error)
            return internal as Error;

        return internal.plot_data(data, i0, i1, start_time, sample_rate_hz, title)
    }

    async plot_spectrogram(
        data:Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<SpectrogramData|Error> {
        const internal:IPyodide|Error = await this.readypromise;
        if(internal instanceof Error)
            return internal as Error;

        return internal.plot_spectrogram(data, i0, i1, start_time, sample_rate_hz, title)
    }

    async plot_modulation_power_spectrum(
        data: Float32Array,
        i0: number,
        i1: number,
        start_time: Date,
        sample_rate_hz: number,
        title: string,
    ): Promise<SpectrogramData|Error> {
        const internal:IPyodide|Error = await this.readypromise;
        if(internal instanceof Error)
            return internal as Error;

        return internal.plot_modulation_power_spectrum(
            data,
            i0,
            i1,
            start_time,
            sample_rate_hz,
            title,
        )
    }

    async prepare_obs_signal_for_audio(
        data: Float32Array,
        sample_rate_hz: number,
    ): Promise<Float32Array|Error> {
        const internal:IPyodide|Error = await this.readypromise;
        if(internal instanceof Error)
            return internal as Error;

        return internal.prepare_obs_signal_for_audio(data,sample_rate_hz)
    }
}


/** Pyodide module in the main thread */
export class Pyodide implements IPyodide {
    constructor(private pyodide:pyo.PyodideAPI){}

    // obsolete?
    async plot_data(
        data:Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<File|Error> {

        const plot_fn:(...x:unknown[]) => void = this.pyodide.globals.get("plot_data");
        try{
            await plot_fn(
                this.pyodide.toPy(data), 
                i0, 
                i1, 
                start_time.getTime()/1000, 
                sample_rate_hz, 
                title, 
                '/plt.png'
            )
            const pngdata:Uint8Array<ArrayBuffer> = 
                this.pyodide.FS.readFile('/plt.png', {encoding: 'binary'})
            return new File([pngdata], 'plot.png')
        } catch (e) {
            return new Error(`${e}`)
        }
    }

    async plot_spectrogram(
        data: Float32Array,
        i0:   number,
        i1:   number,
        start_time:     Date,
        sample_rate_hz: number,
        title:          string,
    ): Promise<SpectrogramData|Error> {

        const plot_fn:(...x:unknown[]) => void = 
            this.pyodide.globals.get("create_spectrogram_for_visualization");
        try{
            const result_py:unknown = await plot_fn(
                this.pyodide.toPy(data), 
                i0, 
                i1, 
                sample_rate_hz, 
            )
            const result_js: SpectrogramData|Error = 
                validate_pyodide_spectrogram_output(result_py);
            destroy_pyodide_output(result_py);
            return result_js
        } catch (e) {
            return new Error(`${e}`)
        }
    }

    async plot_modulation_power_spectrum(
        data: Float32Array,
        i0: number,
        i1: number,
        start_time: Date,
        sample_rate_hz: number,
        title: string,
    ): Promise<SpectrogramData|Error> {

        const plot_fn:(...x:unknown[]) => void = this.pyodide.globals.get(
            'create_modulation_power_spectrum_for_visualization'
        )
        try{
            const result_py:unknown = await plot_fn(
                this.pyodide.toPy(data),
                i0,
                i1,
                sample_rate_hz,
            )
            const result_js: SpectrogramData|Error =
                validate_pyodide_spectrogram_output(result_py);
            destroy_pyodide_output(result_py);
            return result_js
        } catch (e) {
            return new Error(`${e}`)
        }
    }

    /** Find all required to be copied during build */
    get_files_for_vendoring(): string[]|Error {
        if(!is_deno())
            return new Error('Only available for Deno');

        const all_files:string[] = [];
        for(const modulename of Object.keys(this.pyodide.loadedPackages)) {
            const wheelname:string|undefined = 
                this.pyodide.lockfile.packages[modulename.toLowerCase()]?.file_name
            if(wheelname == undefined)
                return new Error(`"${modulename}" not in pyodide lockfile`)
            else 
                all_files.push(`${this.pyodide.lockfileBaseUrl}${wheelname}`);
        }
        const extrafiles:string[] = [
            'pyodide.asm.js', 
            'pyodide.asm.wasm', 
            'pyodide-lock.json', 
            'python_stdlib.zip'
        ];
        for(const extrafile of extrafiles)
            all_files.push(`${this.pyodide.lockfileBaseUrl}${extrafile}`);

        return all_files;
    }

    async prepare_obs_signal_for_audio(
        data: Float32Array, 
        sample_rate_hz: number
    ): Promise<Float32Array | Error> {
        const py_fn:(...x:unknown[]) => void = 
            this.pyodide.globals.get('prepare_obs_signal_for_audio')
        
        try {
            await py_fn(data, sample_rate_hz, '/audiodata.bin')
            const audiodata_u8:Uint8Array<ArrayBuffer> =
                this.pyodide.FS.readFile('/audiodata.bin', {encoding: 'binary'})
            return new Float32Array(audiodata_u8.buffer)
        } catch (e) {
            return new Error(`${e}`)
        }
    }
}



/** Load python script for plotting data. */
async function load_plot_code(): Promise<string|Error> {
    const py_path:URL = new URL(PLOT_DATA_PY_SCRIPT, import.meta.url)

    if(is_deno()) {
        try {
            return await Deno.readTextFile(py_path)
        } catch(e) {
            const error:Error = e instanceof Error
                ? e as Error
                : new Error(`Failed to load ${py_path.toString()}`)
            return error;
        }
    }
    // else: fetch()

    const response:Response|Error = await fetch_no_throw(py_path)
    if(response instanceof Error)
        return response as Error;


    const script:string|Error = 
        await response.text().catch(_ => new Error('Reading fetch response failed'))
    return script;
}


/** Private interface to communicate with a pyodide worker */
class PyodideToWorkerInterface implements IPyodide {
    constructor(private worker:Worker){}

    private _plot(
        data: Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<File|Error> {
        const command:WorkerPlotDataCommand = {
            command: 'plot-data',
            data:    data,
            i0,
            i1,
            start_time,
            sample_rate_hz,
            title,
            uuid: self.crypto.randomUUID()
        }
        const promise:Promise<File|Error> = 
            new Promise( (resolve: (x:File|Error) => void) => {
                const onmessage = (e:MessageEvent) => {
                    const message:WorkerMessage = e.data;
                    
                    let result: File|Error;
                    if(message instanceof Error)
                        result = message as Error;
                    else if (message.message != 'plot-data-result')
                        // result = new Error(`Unexpected worker message: ${message.message}`)
                        return;
                    else if (message.uuid != command.uuid) 
                        // message is for another promise
                        return;
                    else
                        result = new File([message.outputdata_png], 'plot.png')

                    this.worker.removeEventListener('message', onmessage)
                    resolve(result)
                    return;
                }
                this.worker.addEventListener('message', onmessage)
            } )
        this.worker.postMessage(command);
        return promise;
    }

    private _mps_data(
        data: Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<SpectrogramData|Error> {
        const command:WorkerModulationPowerSpectrumCommand = {
            command: 'plot-modulation-power-spectrum',
            data:    data,
            i0,
            i1,
            start_time,
            sample_rate_hz,
            title,
            uuid: self.crypto.randomUUID()
        }
        const promise:Promise<SpectrogramData|Error> = 
            new Promise( (resolve: (x:SpectrogramData|Error) => void) => {
                const onmessage = (e:MessageEvent) => {
                    const message:WorkerMessage = e.data;
                    
                    let result: SpectrogramData|Error;
                    if(message instanceof Error)
                        result = message as Error;
                    else if (message.message != 'mps-data-result')
                        return;
                    else if (message.uuid != command.uuid) 
                        return;
                    else
                        result = message.data

                    this.worker.removeEventListener('message', onmessage)
                    resolve(result)
                    return;
                }
                this.worker.addEventListener('message', onmessage)
            } )
        this.worker.postMessage(command);
        return promise;
    }

    private _spectrogram_data(
        data: Float32Array,
        i0:number,
        i1:number,
        start_time:Date,
        sample_rate_hz:number,
        title:string,
    ): Promise<SpectrogramData|Error> {
        const command:WorkerSpectrogramCommand = {
            command: 'plot-spectrogram',
            data:    data,
            i0,
            i1,
            start_time,
            sample_rate_hz,
            title,
            uuid: self.crypto.randomUUID()
        }
        const promise:Promise<SpectrogramData|Error> = 
            new Promise( (resolve: (x:SpectrogramData|Error) => void) => {
                const onmessage = (e:MessageEvent) => {
                    const message:WorkerMessage = e.data;
                    
                    let result: SpectrogramData|Error;
                    if(message instanceof Error)
                        result = message as Error;
                    else if (message.message != 'spectrogram-data-result')
                        return;
                    else if (message.uuid != command.uuid)
                        return;
                    else
                        result = message.data

                    this.worker.removeEventListener('message', onmessage)
                    resolve(result)
                    return;
                }
                this.worker.addEventListener('message', onmessage)
            } )
        this.worker.postMessage(command);
        return promise;
    }


    plot_data(
        ...x:Parameters<IPyodide['plot_data']>
    ): ReturnType<IPyodide['plot_data']> {
        return this._plot(...x)
    }

    plot_spectrogram(
        ...x:Parameters<IPyodide['plot_spectrogram']>
    ): ReturnType<IPyodide['plot_spectrogram']> {
        return this._spectrogram_data(...x)
    }

    plot_modulation_power_spectrum(
        ...x:Parameters<IPyodide['plot_modulation_power_spectrum']>
    ): ReturnType<IPyodide['plot_modulation_power_spectrum']> {
        return this._mps_data(...x)
    }

    prepare_obs_signal_for_audio(
        data: Float32Array, 
        sample_rate_hz: number
    ): Promise<Float32Array | Error> {
        const command: WorkerPrepareForAudioCommand = {
            command: 'prepare-for-audio',
            data,
            sample_rate_hz
        }

        const promise:Promise<Float32Array|Error> = 
            new Promise( (resolve: (x:Float32Array|Error) => void) => {
                const onmessage = (e:MessageEvent) => {
                    const message:WorkerMessage = e.data;
                    
                    let result: Float32Array|Error;
                    if(message instanceof Error)
                        result = message as Error;
                    else if (message.message != 'prepare-for-audio-result')
                        //result = new Error(`Unexpected worker message: ${message.message}`)
                        return;
                    else
                        result = message.audiosignal

                    this.worker.removeEventListener('message', onmessage)
                    resolve(result)
                    return;
                }
                this.worker.addEventListener('message', onmessage)
            } )
        this.worker.postMessage(command);
        return promise;

    }
}


function validate_pyodide_spectrogram_output(output_py: unknown): SpectrogramData|Error {
    let output_js:unknown;

    if(typeof output_py == 'object'
    && output_py != null
    && 'toJs' in output_py
    && typeof output_py.toJs == 'function'
    )
        output_js = output_py.toJs()
    else
        return new Error('Not a pyodide output')

    if(!is_record(output_js))
        return new Error('Spectrogram result is not an object')

    const t_axis: unknown = output_js.t_axis
    const f_axis: unknown = output_js.f_axis
    const power:  unknown = output_js.power
    const rows:   unknown = output_js.rows
    const cols:   unknown = output_js.cols

    if(
        t_axis == undefined
        || f_axis == undefined
        || power == undefined
        || rows == undefined
        || cols == undefined
    )
        return new Error('Spectrogram result missing fields')

    if(
        typeof rows != 'number'
        || typeof cols != 'number'
        || !Number.isFinite(rows)
        || !Number.isFinite(cols)
    )
        return new Error('Spectrogram rows/cols invalid')

    const t_axis_array: Float32Array = to_float32_array(t_axis)
    const f_axis_array: Float32Array = to_float32_array(f_axis)
    const power_array:  Float32Array = to_float32_array(power)

    if(power_array.length != rows * cols)
        return new Error('Spectrogram power size mismatch')

    return {
        t_axis: t_axis_array,
        f_axis: f_axis_array,
        power:  power_array,
        rows,
        cols,
    }
}

function destroy_pyodide_output(result_py:unknown): void {
    if(
        typeof result_py == 'object'
        && result_py != null
        && 'destroy' in result_py
        && typeof result_py.destroy == 'function'
    )
        result_py.destroy()
}


function to_float32_array(value: unknown): Float32Array {
    if(value instanceof Float32Array)
        return value

    if(value instanceof Float64Array)
        return new Float32Array(value)

    if(value instanceof Int32Array)
        return new Float32Array(value)

    if(Array.isArray(value))
        return new Float32Array(value)

    if(value instanceof Uint8Array)
        return new Float32Array(value)

    return new Float32Array([])
}

function is_record(value: unknown): value is Record<string, unknown> {
    return typeof value == 'object' && value != null
}


function get_worker_url(): URL {
    const ending:'.ts'|'.ts.js' = 
        is_deno()
        ? '.ts'
        : '.ts.js';
    return new URL('./pyodide-worker'+ending, import.meta.url)
}



const PYODIDE_CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full'


/** Initialize pyodide in the main thread */
export
async function initialize(vendored:boolean = is_deno()): Promise<Pyodide|Error> {
    try {
        const pyodide:pyo.PyodideAPI = await pyo.loadPyodide({
            indexURL: vendored? '' : PYODIDE_CDN_URL,
            packageBaseUrl: (is_deno() || vendored)? undefined : PYODIDE_CDN_URL,
            packages: ['matplotlib', 'numpy', 'scipy']
        });

        const pyo_plot_code:string|Error = await load_plot_code()
        if(pyo_plot_code instanceof Error)
            return pyo_plot_code as Error;
        await pyodide.runPythonAsync(pyo_plot_code)


        return new Pyodide(pyodide);
    } catch(e) {
        return e as Error;
    }
}

/** Initialize pyodide in the worker thread */
export async function initialize_in_worker(
    vendored:boolean = is_deno()
): Promise<PyodideInWorker|Error> {
    const worker = new Worker( get_worker_url(), {type:'module'} )
        
    const errorpromise = new Promise((resolve: (x:Error) => void) => {
        worker.addEventListener('error', (e:ErrorEvent) => {
            e.preventDefault()
            console.error('Error in worker:', e.message)
            resolve(new Error(e.message))
        })
    })

    const resultfilepromise:Promise<PyodideToWorkerInterface|Error> = 
        new Promise( (resolve: (x:PyodideToWorkerInterface|Error) => void) => {
            worker.onmessage = (e:MessageEvent) => {
                const message:WorkerMessage = e.data;
                if(message instanceof Error)
                    resolve(message as Error)

                const internal = new PyodideToWorkerInterface(worker)
                resolve(internal); // all ok
            }
            worker.onerror = (e:ErrorEvent) => {
                e.preventDefault()
                console.error('Error in worker:', e.message)
                resolve(new Error(e.message))
            }

            const initcommand:WorkerInitCommand = {command:'init', vendored}
            worker.postMessage(initcommand);
        })
    
    const combinedpromise:Promise<PyodideToWorkerInterface|Error> = 
        Promise.race([errorpromise, resultfilepromise])
    return await new PyodideInWorker(combinedpromise);
}


export { type SpectrogramData };


// NOTE keep this to download pyodide packages
if(import.meta.main) {
    const pyodide:Pyodide|Error = await initialize()
    if(pyodide instanceof Error)
        throw pyodide as Error;
    
    console.log('done');
}
