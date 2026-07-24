import {default as fftjs} from "fft.js"
import {default as fili} from "fili"



export type FFTOutput = {
    /** Real frequency spectrum */
    spectrum: Float32Array;

    /** Frequencies for the spectrum */
    f_axis:   Float32Array;

    /** Complex one-sided non-symmetric */
    fftoutput: Float32Array;
}

export type STFTOutput = {
    /** Complex one-sided non-symmetric spectrum per frame */
    frames: Float32Array[];

    /** Frequencies for the one-sided spectrum */
    f_axis: Float32Array;

    /** Time axis (seconds from start) */
    t_axis: Float32Array;

    /** FFT length */
    n_fft: number;

    /** Frame size */
    window_size: number;

    /** Hop size between frames */
    hop_size: number;

    /** Analysis/synthesis window or null if none is used */
    window: Float32Array|null;

    /** Original signal length */
    signal_length: number;

    /** Sampling rate */
    fs: number;
}

export function fft(signal:Float32Array, fs:number): FFTOutput {
    signal = pad_to_next_power_of_two(signal)
    const n: number = signal.length

    const f = new fftjs(n);
    const fftoutput = new Float32Array(n * 2)
    f.realTransform(fftoutput, signal)
    f.completeSpectrum(fftoutput);

    const f_axis   = new Float32Array(n/2)
    const spectrum = new Float32Array(n/2)
    for(let i:number = 0; i < f_axis.length; i++) {
        spectrum[i] = Math.hypot(fftoutput[i*2]!, fftoutput[i*2+1]!)
        f_axis[i] = i / f_axis.length  * fs/2;
    }
    return {spectrum, f_axis, fftoutput:fftoutput.slice(0,n)}
}

/** Short-time Fourier transform */
export function stft(
    signal:      Float32Array,
    fs:          number,
    window_size: number = 1024,
    hop_size:    number = 256,
    n_fft:       number = 1024,
    windowtype:  'hann'|null = 'hann',
): STFTOutput | Error {
    if(window_size <= 0 || hop_size <= 0 || n_fft <= 0)
        return new Error('stft: window_size, hop_size, n_fft must be > 0')
    if(n_fft < window_size)
        return new Error('stft: n_fft must be >= window_size')
    if(signal.length == 0)
        return new Error('stft: signal is empty')
    if(!is_power_of_two(n_fft))
        return new Error('stft: n_fft must be a power of two')

    const window: Float32Array|null = 
        windowtype == 'hann' ? create_hann_window(window_size) : null;
    const frame_count: number = 
        compute_frame_count_for_stft(signal.length, window_size, hop_size)
    const padded_length: number =
        (frame_count - 1) * hop_size + window_size
    const padded_signal: Float32Array = new Float32Array(padded_length)
    padded_signal.set(signal, 0)

    const fft_engine = new fftjs(n_fft)
    const frames: Float32Array[] = []
    for(let frame_index:number = 0; frame_index < frame_count; frame_index++) {
        const start: number = frame_index * hop_size
        const frame_padded: Float32Array = new Float32Array(n_fft)

        for(let i:number = 0; i < window_size; i++) 
            frame_padded[i] = padded_signal[start + i]! * (window? window[i]! : 1)

        const fftoutput: Float32Array = new Float32Array(n_fft * 2)
        fft_engine.realTransform(fftoutput, frame_padded)
        frames.push(fftoutput.slice(0, n_fft))
    }

    const f_axis: Float32Array = new Float32Array(n_fft / 2)
    for(let i:number = 0; i < f_axis.length; i++)
        f_axis[i] = i / (f_axis.length - 1) * fs / 2

    const t_axis: Float32Array = new Float32Array(frame_count)
    for(let i:number = 0; i < frame_count; i++)
        t_axis[i] = i * hop_size / fs

    return {
        frames,
        f_axis,
        t_axis,
        n_fft,
        window_size,
        hop_size,
        window,
        signal_length: signal.length,
        fs,
    }
}

/** Inverse short-time Fourier transform */
export function istft(stft_output: STFTOutput): Float32Array | Error {
    if(stft_output.frames.length == 0)
        return new Error('istft: stft_output.frames is empty')
    if(stft_output.n_fft < stft_output.window_size)
        return new Error('istft: n_fft must be >= window_size')

    const frame_count: number = stft_output.frames.length
    const output_length: number =
        (frame_count - 1) * stft_output.hop_size + stft_output.window_size
    const output: Float32Array = new Float32Array(output_length)
    const window_sum: Float32Array = new Float32Array(output_length)
    const fft_engine = new fftjs(stft_output.n_fft)

    for(let frame_index:number = 0; frame_index < frame_count; frame_index++) {
        const spectrum = new Float32Array(stft_output.n_fft *2)
        spectrum.set(stft_output.frames[frame_index]!)
        fft_engine.completeSpectrum(spectrum)
        
        if(spectrum.length != stft_output.n_fft * 2)
            return new Error('istft: invalid spectrum length')

        const ifftoutput: Float32Array =
            new Float32Array(stft_output.n_fft * 2)
        fft_engine.inverseTransform(ifftoutput, spectrum)

        const frame: Float32Array =
            fft_engine.fromComplexArray(ifftoutput, undefined)

        const start: number = frame_index * stft_output.hop_size
        for(let i:number = 0; i < stft_output.window_size; i++) {
            const window_i: number = stft_output.window? stft_output.window[i]! : 1
            const value: number = frame[i]! * window_i
            const index: number = start + i
            output[index]! += value
            window_sum[index]! += window_i! * window_i!
        }
    }

    if(stft_output.window != null)
        for(let i:number = 0; i < output.length; i++)
            if(window_sum[i]! > 0)
                output[i] = output[i]! / window_sum[i]!

    return output.slice(0, stft_output.signal_length)
}


function ifft(fftoutput:Float32Array, n:number): Float32Array {
    const nfft: number = fftoutput.length
    const f = new fftjs(nfft);

    const complete_fftspectrum = new Float32Array(nfft*2);
    complete_fftspectrum.set(fftoutput)
    f.completeSpectrum(complete_fftspectrum)

    const ifftoutput = new Float32Array(nfft*2)
    f.inverseTransform(ifftoutput, complete_fftspectrum)

    return Float32Array.from(f.fromComplexArray(ifftoutput, undefined)).slice(0, n)
}


export function bandpass_filter(
    signal: Float32Array, 
    fs:     number, 
    f_min:  number, 
    f_max:  number,
): Float32Array {
    const n: number = signal.length;
    signal = reflect_pad_and_taper_signal_both_sides(signal, fs, 3, 10)

    const fftresult:FFTOutput = fft(signal, fs)

    const f_per_index: number = fs / 2 / fftresult.spectrum.length;
    // NOTE: *2 because FFTOutput.fftoutput is complex, i.e two numbers per value
    const index0: number = Math.round(f_min / f_per_index) * 2
    const index1: number = Math.round(f_max / f_per_index) * 2 +2

    fftresult.fftoutput.fill(0, 0, index0)
    fftresult.fftoutput.fill(0, index1)
    const ifftresult:Float32Array = ifft(fftresult.fftoutput, signal.length)

    return trim_both_sides(ifftresult, n)
    // const padded: number = ifftresult.length - n
    // return ifftresult.slice(padded/2, ifftresult.length - padded/2)
}


export function bandpass_filter_fir(
    signal: Float32Array, 
    fs:     number, 
    f_min:  number, 
    f_max:  number,
    order:  number = 100
): Float32Array {
    if(f_min <= 0 && f_max > fs/2)
        return signal

    const n: number = signal.length;
    signal = reflect_pad_and_taper_signal_both_sides(signal, fs, 3, 10)

    const fir_calculator = new fili.FirCoeffs();
    let fir_coeffs: unknown;
    if(f_min <= 0)
        fir_coeffs = fir_calculator.lowpass({
            order: order,
            Fs:    fs,
            Fc:    f_max,
        });
    else
        fir_coeffs = fir_calculator.bandpass({
            order: order,
            Fs:    fs,
            F1:    f_min,
            F2:    f_max,
        });
    const fir_filter = new fili.FirFilter(fir_coeffs);
    const output: number[] = fir_filter.simulate(signal)
    
    return trim_both_sides(Float32Array.from(output), n)
}

export function lowpass_filter_fir(
    signal: Float32Array, 
    fs:     number, 
    f_max:  number,
    order:  number = 100
): Float32Array {
    const n: number = signal.length;
    signal = reflect_pad_and_taper_signal_both_sides(signal, fs, 3, 10)

    const fir_calculator = new fili.FirCoeffs();
    const fir_coeffs = fir_calculator.lowpass({
        order: order,
        Fs:    fs,
        Fc:    f_max,
    });
    const fir_filter = new fili.FirFilter(fir_coeffs);
    const output: number[] = fir_filter.simulate(signal)
    
    return trim_both_sides(Float32Array.from(output), n)
}







function next_power_of_two(i:number): number {
    return 2 ** Math.ceil( Math.log2(i) )
}

function is_power_of_two(i: number): boolean {
    return next_power_of_two(i) == i
}

function pad_to_next_power_of_two(x:Float32Array): Float32Array {
    const n: number = next_power_of_two(x.length)
    if(n == x.length)
        return x;

    const y = new Float32Array(n)
    y.set(x, 0)
    y.fill(0, x.length)
    return y;
}

function taper_and_pad_signal_both_sides(
    x:                Float32Array, 
    fs:               number, 
    seconds_to_taper: number,
    seconds_to_pad:   number,
): Float32Array {
    const taper_samples: number = Math.max(0, Math.round(seconds_to_taper * fs));
    const pad_samples: number   = Math.max(0, Math.round(seconds_to_pad * fs));

    const output = new Float32Array(pad_samples + x.length + pad_samples);

    output.set(x, pad_samples);

    if(taper_samples > 0) {
        const n: number = Math.min(taper_samples, x.length);

        // Hann half-window fade in
        for (let i:number = 0; i < n; i++) {
            const w: number = 0.5 * (1 - Math.cos(Math.PI * i / n));
            output[pad_samples + i]! *= w;
        }

        // Hann half-window fade out
        for (let i:number = 0; i < n; i++) {
            const w: number = 0.5 * (1 - Math.cos(Math.PI * (n - i) / n));
            output[pad_samples + x.length - n + i]! *= w;
        }
    }

    return output;
}

function reflect_pad_and_taper_signal_both_sides(
    x:                Float32Array,
    fs:               number,
    seconds_to_taper: number,
    seconds_to_pad:   number,
): Float32Array {
    const taper_samples: number = Math.max(0, Math.round(seconds_to_taper * fs));
    const pad_samples: number   = Math.max(0, Math.round(seconds_to_pad * fs));

    const output = new Float32Array(pad_samples + x.length + pad_samples);

    // reflect-pad left
    for(let i:number = 0; i < pad_samples; i++) {
        const j: number = Math.min(i + 1, x.length - 1);
        output[pad_samples - 1 - i]! = x[j]!;
    }

    // center
    output.set(x, pad_samples);

    // reflect-pad right
    for(let i:number = 0; i < pad_samples; i++) {
        const j: number = Math.max(0, x.length - 2 - i);
        output[pad_samples + x.length + i]! = x[j]!;
    }

    if(taper_samples > 0) {
        const n: number = Math.min(taper_samples, output.length);

        // Hann half-window fade in
        for(let i:number = 0; i < n; i++) {
            const w: number = 0.5 * (1 - Math.cos(Math.PI * i / n));
            output[i]! *= w;
        }

        // Hann half-window fade out
        for(let i:number = 0; i < n; i++) {
            const w: number = 0.5 * (1 - Math.cos(Math.PI * (n - i) / n));
            output[output.length - n + i]! *= w;
        }
    }

    return output;
}

/** Slice the input left and right so that the result is of length `to_size` */
function trim_both_sides(signal:Float32Array, to_size:number): Float32Array {
    const n_to_trim: number = signal.length - to_size
    if(n_to_trim <= 0)
        return signal;

    const trim_left: number = Math.floor(n_to_trim / 2)
    const trim_right: number = n_to_trim - trim_left
    return signal.slice(trim_left, -trim_right)
}



export function compute_envelope(
    signal: Float32Array, 
    fs:     number,
    f_min:  number,
    f_max:  number,
): Float32Array {
    signal = bandpass_filter_fir(
        signal, 
        fs, 
        f_min, 
        f_max, 
        /*order=*/50
    )

    for(let i:number = 0; i < signal.length; i++) 
        signal[i] = Math.abs(signal[i]!)

    // TODO: lowpass filter
    //signal = lowpass_filter_fir(signal, fs, /*f_max=*/1, /*order=*/50)

    for(let i:number = 0; i < signal.length; i++) 
        signal[i] = Math.log1p(signal[i]!)

    return signal;
}


export type FrequencyBand = {
    min: number;
    max: number;
}


/** Compute how much a frequency band contributes to the total signal */
export function compute_band_power_ratio(
    signal:           Float32Array,
    fs:               number,
    window:           number,
    numerator_band:   FrequencyBand,
    denominator_band: FrequencyBand = {min:0, max:Infinity}
): Float32Array {
    if(signal.length == 0 || window <= 0)
        return new Float32Array(0)

    // no overlap
    const hop:  number = window
    const nfft: number = next_power_of_two(window)
    const stft_output: STFTOutput|Error = stft(signal, fs, window, hop, nfft)
    if(stft_output instanceof Error)
        // should not happen
        return new Float32Array(0)
    
    
    const ratios: number[] = []
    for(let i:number = 0; i < stft_output.frames.length; i++) {
        const frame: Float32Array = complex2real( stft_output.frames[i]! )

        let sum_denominator: number = 0;
        let sum_numerator:   number = 0;
        for(let j:number = 0; j < stft_output.f_axis.length; j++) {
            const value:number = frame[j] ?? 0

            const f:number = stft_output.f_axis[j]!
            if(numerator_band.min <= f && f <= numerator_band.max)
                sum_numerator += value;
            
            if(denominator_band.min <= f && f <= denominator_band.max)
                sum_denominator += value;
        }
        const ratio: number = 
            (sum_denominator > 0) ? sum_numerator / sum_denominator : 0
        ratios.push(ratio)
    }

    return Float32Array.from(ratios)
}


function complex2real(complex:Float32Array): Float32Array {
    const real = new Float32Array(complex.length / 2)
    for(let i:number = 0; i < real.length; i++)
        real[i] = Math.hypot(complex[i*2]!, complex[i*2+1]!)
    return real
}



function create_hann_window(n:number): Float32Array {
    const window: Float32Array = new Float32Array(n)
    if(n == 1) {
        window[0] = 1
        return window
    }

    for(let i:number = 0; i < n; i++)
        window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)))
    return window
}

function compute_frame_count_for_stft(
    signal_length: number,
    window_size: number,
    hop_size: number,
): number {
    if(signal_length <= window_size)
        return 1

    const remaining: number = signal_length - window_size
    return Math.floor(remaining / hop_size) + 1 +
        (remaining % hop_size == 0 ? 0 : 1)
}
