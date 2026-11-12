import { assert } from "asserts"


import { 
    WorkerPool
} from "../frontend/lib/workerpool.ts"
import {
    create_spectrogram_for_visualization,
    create_spectrogram_for_visualization_parallelized,
    type SpectrogramOutput,
} from '../frontend/lib/signal-processing-visualization.ts'
import {
    prepare_seismic_signal_for_audio,
} from '../frontend/lib/signal-processing.ts'





Deno.test('workerpool0', async () => {
    const pool = WorkerPool.get_instance(3)
    
    const fs = 250
    const N  = 7500;
    const signal0: Float32Array = new Float32Array(N).map( i => Math.random()*2-1 );

    const promises: Promise<Float32Array|Error>[] = []
    for(const i of [0,1,2,3,4,5])
        promises.push(
            (await pool.compute_envelope(signal0, fs, 2, 12)).promise
        )
    const results = await Promise.all(promises)
    const result = results[0]!
    assert(!(result instanceof Error))

    assert(result.length == signal0.length)
})


Deno.test('create_spectrogram_for_visualization_parallelized', async () => {
    // this is too make sure the worker pool size is 3, to avoid many workers
    const _pool = WorkerPool.get_instance(3)


    const fs: number = 200
    const n_samples: number = fs * 12
    const signal: Float32Array = new Float32Array(n_samples)
    for(let i:number = 0; i < n_samples; i++) {
        const t: number = i / fs
        signal[i] =
            Math.sin(2 * Math.PI * 4 * t)
            + 0.5 * Math.sin(2 * Math.PI * 16 * t)
    }
    const i0 = fs
    const i1 = n_samples - fs

    const output: SpectrogramOutput|Error =
        await create_spectrogram_for_visualization_parallelized(signal, fs, i0, i1, /*chunksize = */ 10)
    assert(!(output instanceof Error))
    assert(output.frames.length > 0)
    assert(output.f_axis.length > 0)
    assert(output.t_axis.length > 0)
    assert(output.frames.length == output.t_axis.length)
    assert(output.frames[0]!.length == output.f_axis.length)

    const output_mainthread: SpectrogramOutput|Error = 
        create_spectrogram_for_visualization(signal, fs, i0, i1)
    assert(!(output_mainthread instanceof Error))
    assert(output.frames.length == output_mainthread.frames.length)
    assert(output.f_axis.length == output_mainthread.f_axis.length)
    assert(output.t_axis.length == output_mainthread.t_axis.length)
    assert(output.frames[0]!.length == output_mainthread.frames[0]!.length)


    const output_too_short: SpectrogramOutput|Error =
        await create_spectrogram_for_visualization_parallelized(signal.slice(0, 1), fs, i0, i1, /*chunksize = */ 10)
    assert(output_too_short instanceof Error)
})


Deno.test('prepare_seismic_signal_for_audio resamples and normalizes signal', async () => {
    const pool = WorkerPool.get_instance(3)

    const fs: number       = 100
    const f_target: number = 8000
    const signal: Float32Array = new Float32Array(100)
    for(let i:number = 0; i < signal.length; i++)
        signal[i] = Math.sin(2 * Math.PI * 5 * (i / fs)) * 10 + 5

    const worker_result: Float32Array|Error =
        await (await pool.prepare_seismic_signal_for_audio(signal, fs, f_target)).promise
    assert(!(worker_result instanceof Error))
    assert(worker_result.length == 8000)

    const direct_result: Float32Array =
        prepare_seismic_signal_for_audio(signal, fs, f_target)
    assert(worker_result.length == direct_result.length)
    for(let i:number = 0; i < worker_result.length; i++)
        assert(Math.abs(worker_result[i]! - direct_result[i]!) < 1e-6)
})


Deno.test('prepare_seismic_signal_for_audio returns empty array when resampled length < 512', async () => {
    const pool = WorkerPool.get_instance(3)

    const signal: Float32Array = new Float32Array([1, 2, 3, 4])
    const worker_result: Float32Array|Error =
        await (await pool.prepare_seismic_signal_for_audio(signal, 1000, 8000)).promise
    assert(!(worker_result instanceof Error))
    assert(worker_result.length == 0)
})


Deno.test('prepare_seismic_signal_for_audio handles short signals with length < 2', async () => {
    const pool = WorkerPool.get_instance(3)

    const single_sample: Float32Array = new Float32Array([42])
    const worker_result: Float32Array|Error =
        await (await pool.prepare_seismic_signal_for_audio(single_sample, 100, 8000)).promise
    assert(!(worker_result instanceof Error))
    assert(worker_result.length == 1)
    assert(worker_result[0] == 42)
})


