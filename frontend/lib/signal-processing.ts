import {default as fftjs} from "fft.js"




export type FFTOutput = {
    /** Real frequency spectrum */
    spectrum: Float32Array;

    /** Frequencies for the spectrum */
    f_axis:   Float32Array;

    /** Complex one-sided non-symmetric */
    fftoutput: Float32Array;
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


function ifft(fftoutput:Float32Array, n:number): Float32Array {
    const nfft: number = fftoutput.length
    const f = new fftjs(nfft);

    const complete_fftspectrum = new Float32Array(nfft*2);
    complete_fftspectrum.set(fftoutput)
    f.completeSpectrum(complete_fftspectrum)

    const ifftoutput = new Float32Array(nfft*2)
    f.inverseTransform(ifftoutput, complete_fftspectrum)

    return f.fromComplexArray(ifftoutput, undefined).slice(0, n)
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

    const padded: number = ifftresult.length - n
    return ifftresult.slice(padded/2, ifftresult.length - padded/2)
}








function next_power_of_two(i:number): number {
    return 2 ** Math.ceil( Math.log2(i) )
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