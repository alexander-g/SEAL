import { 
    signal_scale,
    signal_add_scalar,
    stft,
    next_power_of_two,
    complex2real,
    type STFTOutput,
} from './signal-processing.ts'
import { WorkerPool } from './workerpool.ts'



export type SpectrogramOutput = {
    frames:  Float32Array[]
    f_axis:  Float32Array
    t_axis:  Float32Array
}

export type SpectrogramPlan = {
    n_per_segment: number
    n_fft:         number
    hop_size:      number
    frame_count:   number
}

export type SpectrogramFrameRange = {
    frame_start?: number
    frame_end?:   number
}

type SpectrogramChunkMeta = {
    frame_start: number
    frame_end:   number
}


// not worth it for less than that
const HARDCODED_FRAMES_PER_WORKER = 10000


export async function create_spectrogram_for_visualization_parallelized(
    signal:     Float32Array,
    fs:         number,
    i0:         number,
    i1:         number,
    chunksize?: number,
): Promise<SpectrogramOutput|Error> {
    const signal_slice: Float32Array = signal.slice(i0, i1)
    if(signal_slice.length <= 1)
        return new Error('Signal too short')

    const plan: SpectrogramPlan|Error = 
        build_spectrogram_plan(signal_slice.length, fs)
    if(plan instanceof Error)
        return plan as Error;

    chunksize = 
        chunksize ?? Math.min(HARDCODED_FRAMES_PER_WORKER, plan.frame_count)
    const n_chunks: number  = Math.ceil(plan.frame_count / chunksize)
    if(n_chunks <= 1)
        // just run in the main thread for short signals
        return create_spectrogram_for_visualization(signal, fs, i0, i1)
    
    signal = normalize_signal(signal_slice, fs)

    const workerpool = WorkerPool.get_instance()
    type ChunkPromise = ReturnType<WorkerPool['compute_spectrogram_for_visualization']>
    const outputpromises: ChunkPromise[] = []
    const chunk_meta: SpectrogramChunkMeta[] = []
    for(let i:number = 0; i < n_chunks; i++) {
        const range: SpectrogramChunkMeta = {
            frame_start: i * chunksize,
            frame_end:   (i+1 == n_chunks) ? plan.frame_count : (i+1) * chunksize
        }

        const sample_start: number = range.frame_start * plan.hop_size
        const sample_end: number = Math.min(
            signal.length,
            (range.frame_end - 1) * plan.hop_size + plan.n_per_segment,
        )
        const signal_chunk: Float32Array = signal.slice(sample_start, sample_end)
        const local_plan: SpectrogramPlan = {
            ...plan,
            frame_count: range.frame_end - range.frame_start,
        }

        const promise: ChunkPromise = 
            workerpool.compute_spectrogram_for_visualization(
                signal_chunk,
                fs,
                local_plan,
            )
        outputpromises.push(promise)
        chunk_meta.push(range)
    }

    const resolved_chunks: (SpectrogramOutput|Error)[] = []
    for(const promise of outputpromises)
        resolved_chunks.push(await (await promise).promise)

    return merge_partial_spectrogram_outputs(
        resolved_chunks,
        chunk_meta,
        fs,
        plan.hop_size,
    )
}


export function create_spectrogram_for_visualization(
    signal: Float32Array,
    fs:     number,
    i0:     number,
    i1:     number,
): SpectrogramOutput|Error {
    signal = signal.slice(i0, i1)
    if(signal.length <= 1)
        return new Error('Signal too short')
    signal = normalize_signal(signal, fs)

    const spectrogram: STFTOutput|Error = create_spectrogram(signal, fs)
    if(spectrogram instanceof Error)
        return spectrogram as Error

    return postprocess_spectrogram(spectrogram)
}






function normalize_signal(signal: Float32Array, fs:number): Float32Array {
    // const signal_highpass: Float32Array = 
    //     bandpass_filter_fir(signal, fs, /*f_min=*/1.0, /*f_max=*/Infinity, /*order=*/100)
    const signal_highpass: Float32Array = dc_blocker(signal, fs, /*f_cutoff=*/1.0)

    const offset: number = mean(signal_highpass)
    const scale:  number = std(signal_highpass)

    signal = signal_add_scalar(signal, -offset)
    signal = signal_scale(signal, 1 / (scale + 1e-12))
    return signal
}


/** Faster alternative to a FIR highpass filter */
function dc_blocker(
    signal:   Float32Array,
    fs:       number,
    f_cutoff: number = 1.0
): Float32Array {
    if(signal.length === 0)
        return new Float32Array(0);

    const r: number = Math.exp(-2 * Math.PI * f_cutoff / fs);
    const output = new Float32Array(signal.length);

    let x_prev: number = signal[0]!;
    let y_prev: number = 0;

    for(let i:number = 0; i < signal.length; i++) {
        const x:number = signal[i]!;
        const y:number = x - x_prev + r * y_prev;

        output[i] = y;
        x_prev = x;
        y_prev = y;
    }
    return output;
}



export function build_spectrogram_plan(
    signal_length: number,
    fs:            number,
): SpectrogramPlan|Error {
    if(signal_length <= 0)
        return new Error('build_spectrogram_plan: signal_length must be > 0')
    if(fs <= 0)
        return new Error('build_spectrogram_plan: fs must be > 0')

    const n_samples: number = signal_length
    // two seconds per frame
    const n_per_segment: number = Math.max(1, Math.min( Math.round(fs * 2), n_samples ) )
    const n_fft: number         = next_power_of_two(n_per_segment)
    //const hop_size: number      = Math.max( Math.floor(n_per_segment / 4), 1)

    // adaptive hop size 0.25..0.75, larger for large signals to speed things up
    const relative_hop_size: number = 
        interpolate_between_two_values(5000, 0.25, 50000, 0.75, n_samples/n_per_segment)
    const hop_size: number = Math.max( Math.floor(n_per_segment * relative_hop_size), 1)
    const frame_count: number = 
        compute_stft_frame_count(n_samples, n_per_segment, hop_size)

    return {n_per_segment, n_fft, hop_size, frame_count}
}


export function create_spectrogram(
    signal: Float32Array,
    fs:     number,
    plan?:  SpectrogramPlan,
    range?: SpectrogramFrameRange,
): STFTOutput|Error {
    const n_samples: number     = signal.length
    if(!plan) {
        const plan_: SpectrogramPlan|Error = build_spectrogram_plan(n_samples, fs)
        if(plan_ instanceof Error)
            return plan_ as Error
        plan = plan_
    }

    const stft_output: STFTOutput|Error = 
        stft(
            signal,
            fs,
            plan.n_per_segment,
            plan.hop_size,
            plan.n_fft,
            'hann',
            range?.frame_start,
            range?.frame_end,
        )

    return stft_output
}

export function postprocess_spectrogram(spectrogram:SpectrogramOutput): SpectrogramOutput {
    const output_frames: Float32Array[] = []
    for(let i:number = 0; i < spectrogram.frames.length; i++) {
        const frame: Float32Array = spectrogram.frames[i]!
        const frame_abs: Float32Array = complex2real(frame)
        const output_frame: Float32Array = new Float32Array(frame_abs.length)
        for(let j:number = 0; j < frame_abs.length; j++) {
            const abs:number    = frame_abs[j]!
            const value: number = 10 * Math.log10(abs + 1)
            output_frame[j] = value
        }
        output_frames.push(output_frame)
    }

    return {
        frames:  output_frames,
        f_axis: spectrogram.f_axis,
        t_axis: spectrogram.t_axis,
    }
}



function mean(x: Float32Array): number {
    let sum: number = 0
    for(let i:number = 0; i < x.length; i++)
        sum = sum + x[i]!;
    const mean: number = sum / x.length
    return mean
}

function std(x: Float32Array): number {
    const m: number = mean(x)
    let sum_sq: number = 0;
    for(let i:number = 0; i < x.length; i++) {
      const d:number = x[i]! - m;
      sum_sq += d * d;
    }
    return Math.sqrt(sum_sq / x.length)
}


/** Interpolate between two values. No extrapolation */
function interpolate_between_two_values(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    new_x: number
): number {
    if(x1 === x2)
        return Math.abs(new_x - x1) == 0 
            ? y1 
            : Math.abs(new_x - x1) < Math.abs(new_x - x2) 
                ? y1 
                : y2;
  
    // no extrapolation: return the nearest endpoint
    if(new_x <= Math.min(x1, x2))
        return x1 < x2 ? y1 : y2
  
    if(new_x >= Math.max(x1, x2))
        return x1 > x2 ? y1 : y2;
  
    const t: number = (new_x - x1) / (x2 - x1);
    return y1 + t * (y2 - y1);
  }

function compute_stft_frame_count(
    signal_length: number,
    window_size:   number,
    hop_size:      number,
): number {
    if(signal_length <= window_size)
        return 1

    const remaining: number = signal_length - window_size
    return Math.floor(remaining / hop_size) + 1
        + (remaining % hop_size == 0 ? 0 : 1)
}
  


function merge_partial_spectrogram_outputs(
    partials:  (SpectrogramOutput|Error)[],
    chunk_meta: SpectrogramChunkMeta[],
    fs:         number,
    hop_size:   number,
): SpectrogramOutput|Error {
    if(partials.length == 0)
        return new Error('merge_partial_spectrogram_outputs: empty partials')
    if(chunk_meta.length != partials.length)
        return new Error('merge_partial_spectrogram_outputs: metadata mismatch')
    if(fs <= 0 || hop_size <= 0)
        return new Error('merge_partial_spectrogram_outputs: invalid timing')

    for(const partial of partials)
        if(partial instanceof Error)
            return partial

    const resolved_partials: SpectrogramOutput[] = partials as SpectrogramOutput[]
    const reference: SpectrogramOutput = resolved_partials[0]!

    const frames: Float32Array[] = []
    let t_axis_length: number = 0
    for(const partial of resolved_partials) {
        if(partial.f_axis.length != reference.f_axis.length)
            return new Error('merge_partial_spectrogram_outputs: f_axis mismatch')

        for(let i:number = 0; i < partial.f_axis.length; i++)
            if(Math.abs(partial.f_axis[i]! - reference.f_axis[i]!) > 1e-6)
                return new Error('merge_partial_spectrogram_outputs: f_axis mismatch')

        frames.push(...partial.frames)
        t_axis_length += partial.t_axis.length
    }

    const t_axis: Float32Array = new Float32Array(t_axis_length)
    let offset: number = 0
    for(let i:number = 0; i < resolved_partials.length; i++) {
        const partial: SpectrogramOutput = resolved_partials[i]!
        const meta: SpectrogramChunkMeta = chunk_meta[i]!
        const expected_length: number = meta.frame_end - meta.frame_start
        if(partial.t_axis.length != expected_length)
            return new Error(
                'merge_partial_spectrogram_outputs: frame count mismatch'
            )

        const chunk_time_offset_s: number = meta.frame_start * hop_size / fs
        for(let j:number = 0; j < partial.t_axis.length; j++)
            t_axis[offset + j] = partial.t_axis[j]! + chunk_time_offset_s
        offset += partial.t_axis.length
    }

    return {
        frames,
        f_axis: reference.f_axis,
        t_axis,
    }
}
