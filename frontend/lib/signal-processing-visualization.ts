import { 
    signal_scale,
    signal_add_scalar,
    bandpass_filter_fir,
    stft,
    next_power_of_two,
    complex2real,
    type STFTOutput,
} from './signal-processing.ts'



export type SpectrogramOutput = {
    frames:  Float32Array[]
    f_axis:  Float32Array
    t_axis:  Float32Array
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
    const signal_highpass: Float32Array = 
        bandpass_filter_fir(signal, fs, /*f_min=*/1.0, /*f_max=*/Infinity, /*order=*/100)

    const offset: number = mean(signal_highpass)
    const scale:  number = std(signal_highpass)

    signal = signal_add_scalar(signal, -offset)
    signal = signal_scale(signal, 1 / (scale + 1e-12))
    return signal
}


function create_spectrogram(signal: Float32Array, fs:number): STFTOutput|Error {
    const n_samples: number     = signal.length
    const n_per_segment: number = Math.max(1, Math.min( Math.round(fs / 0.5), n_samples ) )
    const n_fft: number         = next_power_of_two(n_per_segment)
    const hop_size: number      = Math.max( Math.floor(n_per_segment / 4), 1)

    const stft_output: STFTOutput|Error = 
        //stft(signal, fs, n_per_segment, hop_size, n_fft, 'hann', {scipy_compatible: true},)
        stft(signal, fs, n_per_segment, hop_size, n_fft)

    return stft_output
}

function postprocess_spectrogram(spectrogram:STFTOutput): SpectrogramOutput {
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
    for(const i of x)
        sum = sum + i;
    const mean: number = sum / x.length
    return mean
}

function std(x: Float32Array): number {
    const m: number = mean(x)
    let sum_sq: number = 0;
    for (const i of x) {
      const d:number = i - m;
      sum_sq += d * d;
    }
    return Math.sqrt(sum_sq / x.length)
}


