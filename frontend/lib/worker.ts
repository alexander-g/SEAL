import { 
    compute_band_power_ratio, 
    compute_envelope,
    prepare_seismic_signal_for_audio,
    type FrequencyBand,
} from "./signal-processing.ts"
import {
    create_spectrogram,
    postprocess_spectrogram,
    type SpectrogramOutput,
    type SpectrogramFrameRange,
    type SpectrogramPlan,
} from './signal-processing-visualization.ts'



export type ComputeEnvelopeTask = {
    type:    'compute-envelope'
    signal:  Float32Array;
    fs:      number;
    f_min:   number;
    f_max:   number;

    task_id: number;
}

export type ComputeBandPowerRatioTask = {
    type:             'band-power-ratio'
    signal:           Float32Array;
    fs:               number;
    window:           number;
    numerator_band:   FrequencyBand,
    denominator_band: FrequencyBand,

    task_id: number;
}

export type ComputeSpectrogramTask = {
    type:        'compute-spectrogram'
    signal:      Float32Array
    fs:          number
    plan:        SpectrogramPlan
    framerange?: SpectrogramFrameRange

    task_id:     number
}

export type PrepareAudioTask = {
    type:     'prepare-audio'
    signal:   Float32Array
    fs:       number
    f_target: number

    task_id:  number
}


export type Task =
    | ComputeEnvelopeTask
    | ComputeBandPowerRatioTask
    | ComputeSpectrogramTask
    | PrepareAudioTask



export type ComputeEnvelopeResult = {
    type:    'compute-envelope'
    task_id:  number;
    envelope: Float32Array;
}

export type ComputeBandPowerRatioResult = {
    type:    'band-power-ratio'
    task_id:  number;
    ratio:    Float32Array;
}

export type ComputeSpectrogramResult = {
    type:        'compute-spectrogram'
    task_id:     number
    spectrogram: SpectrogramOutput | Error
}

export type PrepareAudioResult = {
    type:    'prepare-audio'
    task_id: number
    signal:  Float32Array
}


export type WorkerResult =
    | ComputeEnvelopeResult
    | ComputeBandPowerRatioResult
    | ComputeSpectrogramResult
    | PrepareAudioResult







// main entry point
self.onmessage = async (e:MessageEvent) => {
    const task:Task = e.data;
    let result: WorkerResult|Error;

    const tasktype = task.type;
    if(task.type == 'compute-envelope') {
        const envelope: Float32Array = 
            compute_envelope(task.signal, task.fs, task.f_min, task.f_max)
        result = {
            type:    'compute-envelope',
            task_id:  task.task_id,
            envelope: envelope,
        }
    } else if(task.type == 'band-power-ratio') {
        const ratio: Float32Array = compute_band_power_ratio(
            task.signal, 
            task.fs,
            task.window,
            task.numerator_band,
            task.denominator_band,
        )
        result = {
            type:    'band-power-ratio',
            task_id: task.task_id,
            ratio :  ratio,
        }
    } else if(task.type == 'compute-spectrogram') {
        let spectrogram: SpectrogramOutput|Error =
            create_spectrogram(
                task.signal,
                task.fs,
                task.plan,
                task.framerange
            )
        if(!(spectrogram instanceof Error))
            spectrogram = postprocess_spectrogram(spectrogram)
        
        result = {
            type:        'compute-spectrogram',
            task_id:     task.task_id,
            spectrogram: spectrogram,
        }
    } else if(task.type == 'prepare-audio') {
        const signal: Float32Array = prepare_seismic_signal_for_audio(
            task.signal,
            task.fs,
            task.f_target,
        )
        result = {
            type:    'prepare-audio',
            task_id: task.task_id,
            signal:  signal,
        }
    } else
        result = new Error(`Unknown worker task type: ${tasktype}`)

    self.postMessage(result)
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

