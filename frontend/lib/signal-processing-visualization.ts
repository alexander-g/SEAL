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



function create_spectrogram(signal: Float32Array, fs:number): STFTOutput|Error {
    const n_samples: number     = signal.length
    // two seconds per frame
    const n_per_segment: number = Math.max(1, Math.min( Math.round(fs * 2), n_samples ) )
    const n_fft: number         = next_power_of_two(n_per_segment)
    //const hop_size: number      = Math.max( Math.floor(n_per_segment / 4), 1)

    // adaptive hop size 0.25..0.75, larger for large signals to speed things up
    const relative_hop_size: number = 
        interpolate_between_two_values(5000, 0.25, 50000, 0.75, n_samples/n_per_segment)
    const hop_size: number = Math.max( Math.floor(n_per_segment * relative_hop_size), 1)

    const stft_output: STFTOutput|Error = 
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
  