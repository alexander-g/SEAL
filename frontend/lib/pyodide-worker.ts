import { 
    initialize as initialize_pyodide,
    type Pyodide
} from "./pyodide.ts";



export type WorkerInitCommand = {
    command: 'init';

    /** Whether pyodide should fetch wheels from index or from CDN */
    vendored: boolean;
}


export type WorkerPlotDataCommand = {
    command: 'plot-data'|'plot-spectrogram'|'plot-modulation-power-spectrum';

    /** Data to plot */
    data: Float32Array;

    /** Slice start index in data. */
    i0: number;

    /** Slice end index in data (exclusive). */
    i1: number;

    /** UTC start time of full trace. */
    start_time: Date;

    /** Sampling rate in Hz. */
    sample_rate_hz: number;

    /** Plot title. */
    title: string;

    /** Unique id to identify parallel messages. Will return in result */
    uuid: string;

}

export type WorkerSpectrogramCommand = 
    Omit<WorkerPlotDataCommand, 'command'> 
    & {command: Extract<WorkerPlotDataCommand['command'], 'plot-spectrogram'>}



export type WorkerPrepareForAudioCommand = {
    command: 'prepare-for-audio';

    /** Raw input mseed signal */
    data: Float32Array;

    /** Input signal sampling rate in Hz */
    sample_rate_hz: number;
}



export type WorkerCommand = 
    WorkerInitCommand
    | WorkerPlotDataCommand
    | WorkerPrepareForAudioCommand;






export type WorkerReadyResult = {
    message: 'ready';
}

export type WorkerPlotDataResult = {
    message: 'plot-data-result';

    /** Unique id passed in command. */
    uuid: string;

    /** RGB data of plot encoded as png.
        NOTE: uint8 instead of File, bc doesnt work (in deno) */
    outputdata_png: Uint8Array<ArrayBuffer>;
}

export type WorkerSpectrogramResult = {
    message: 'spectrogram-data-result';

    /** Unique id passed in command. */
    uuid: string;

    data: SpectrogramData;
}

export type WorkerPrepareForAudioResult = {
    message: 'prepare-for-audio-result';

    /** Processed audio, ready for playback */
    audiosignal: Float32Array;
}


type WorkerResult = 
    WorkerReadyResult 
    | WorkerPlotDataResult 
    | WorkerSpectrogramResult
    | WorkerPrepareForAudioResult
    | Error;
export type WorkerMessage = WorkerResult;


export type SpectrogramData = {
    t_axis: Float32Array,
    f_axis: Float32Array,
    power:  Float32Array,
    rows:   number,
    cols:   number,
}





let pyodide:Pyodide|null = null;


// main entry point
self.onmessage = async (e:MessageEvent) => {
    const data:WorkerCommand = e.data;
    //console.log(`Worker ${self.name} onmessage: ${data.command}`)

    let result:WorkerMessage;
    if(data.command == 'init') {
        const pyo:Pyodide|Error = await initialize_pyodide(data.vendored)
        if(pyo instanceof Error)
            result = pyo as Error;
        else {
            pyodide = pyo;
            result = {message:'ready'}
        }
    } else if(
        data.command == 'plot-data'
        || data.command == 'plot-modulation-power-spectrum'
    ) {
        if(pyodide == null)
            result = new Error('Pyodide in worker not initialized');
        else
            result = await handle_plot_data(data, pyodide)
    } else if (data.command == 'plot-spectrogram') {
        if(pyodide == null)
            result = new Error('Pyodide in worker not initialized');
        else
            result = await handle_plot_spectrogram(
                data as WorkerSpectrogramCommand, 
                pyodide
            )
    } else if (data.command == 'prepare-for-audio') {
        if(pyodide == null)
            result = new Error('Pyodide in worker not initialized');
        else
            result = await handle_prepare_for_audio(data, pyodide)
    }
    else
        result = new Error(
            `Unknown worker command: ${(data as {command:string}).command}`
        )
    
    self.postMessage(result)
}


async function handle_plot_data(
    data:    WorkerPlotDataCommand, 
    pyodide: Pyodide
): Promise<WorkerPlotDataResult|Error> {
    const plot_fn = 
        data.command == 'plot-data'
        ? pyodide.plot_data.bind(pyodide)
        : data.command == 'plot-modulation-power-spectrum'
            ? pyodide.plot_modulation_power_spectrum.bind(pyodide)
        : new Error(`Unexpected command: ${data.command}`);
    if(plot_fn instanceof Error)
        return plot_fn as Error

    const output:File|Error = await plot_fn(
        data.data,
        data.i0,
        data.i1,
        data.start_time,
        data.sample_rate_hz,
        data.title,
    )
    if(output instanceof Error)
        return output as Error;
    
    const outputdata_png:ArrayBuffer|Error = 
        await output.arrayBuffer().catch(_ => new Error())
    if(outputdata_png instanceof Error)
        return outputdata_png as Error;

    const message:WorkerPlotDataResult = {
        message: 'plot-data-result', 
        outputdata_png: new Uint8Array(outputdata_png), 
        uuid: data.uuid
    };
    
    return message;
}


async function handle_plot_spectrogram(
    data:    WorkerSpectrogramCommand,
    pyodide: Pyodide
): Promise<WorkerSpectrogramResult|Error> {
    const output:SpectrogramData|Error = await pyodide.plot_spectrogram(
        data.data,
        data.i0,
        data.i1,
        data.start_time,
        data.sample_rate_hz,
        data.title,
    )
    if(output instanceof Error)
        return output as Error

    return {
        message: 'spectrogram-data-result',
        data: output,
        uuid: data.uuid,
    }
}


async function handle_prepare_for_audio(
    data: WorkerPrepareForAudioCommand, 
    pyodide: Pyodide
): Promise<WorkerPrepareForAudioResult|Error> {
    const output: Float32Array|Error = 
        await pyodide.prepare_obs_signal_for_audio(data.data, data.sample_rate_hz)  
    if(output instanceof Error)
        return output as Error;

    return {message:'prepare-for-audio-result', audiosignal:output}
}




self.addEventListener('error', (e:ErrorEvent) => {
    e.preventDefault();
    const msg:string = 
        `Worker ${self.name} error: ${e.message} (${e.filename}:${e.lineno})-${e.colno})`
    console.error(msg, e)
    self.postMessage(new Error(msg));
    self.close();
});


self.onunhandledrejection = (e:PromiseRejectionEvent) => {
    e.preventDefault()
    const msg:string = `Worker ${self.name} unhandled rejection: ${e.reason}`
    console.error(msg)
    self.postMessage(new Error(msg))
    self.close()
}
