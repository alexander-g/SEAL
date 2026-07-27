import * as sig from "../frontend/lib/signal-processing.ts"

import { assert } from "asserts";



Deno.test('bandpass', () => {
    const fs = 250
    const N  = 75000;
    const signal0: Float32Array = new Float32Array(N).map( i => Math.random()*2-1 );

    const f_min = 10
    const f_max = 15
    const filtered0: Float32Array = sig.bandpass_filter(signal0, fs, f_min, f_max)
    assert(filtered0.length == signal0.length)

    const spectrum_after_filter0 = sig.fft(filtered0, fs)
    assert(spectrum_after_filter0.f_axis.length == spectrum_after_filter0.spectrum.length)

    let before_band = {sum: 0.0, n: 0};
    let within_band = {sum: 0.0, n: 0};
    let after_band  = {sum: 0.0, n: 0};
    for(const index in spectrum_after_filter0.f_axis) {
        const f:number = spectrum_after_filter0.f_axis[index]!

        if(f < f_min) {
            before_band.sum += spectrum_after_filter0.spectrum[index]!
            before_band.n++
        }
        if(f > f_min && f < f_max) {
            within_band.sum += spectrum_after_filter0.spectrum[index]!
            within_band.n++
        }
        if(f > f_max) {
            after_band.sum += spectrum_after_filter0.spectrum[index]!
            after_band.n++
        }
    }
    assert(before_band.n > 0)
    assert(within_band.n > 0)
    assert(after_band.n > 0)

    const mean_before_band = before_band.sum / before_band.n
    const mean_within_band = within_band.sum / within_band.n
    const mean_after_band  = after_band.sum  / after_band.n


    assert( mean_before_band * 10 < mean_within_band )
    assert( mean_after_band * 10 < mean_within_band )
    
})

Deno.test('stft roundtrip', () => {
    const fs: number = 200
    const signal_length: number = 4000
    const signal: Float32Array = new Float32Array(signal_length)
    for(let i:number = 0; i < signal_length; i++) {
        const t: number = i / fs
        signal[i] =
            Math.sin(2 * Math.PI * 5 * t) +
            0.4 * Math.sin(2 * Math.PI * 30 * t)
    }

    const stft_output: sig.STFTOutput | Error = sig.stft(signal, fs, 512, 128, 512)
    assert(!(stft_output instanceof Error))

    const recovered: Float32Array | Error = sig.istft(stft_output)
    assert(!(recovered instanceof Error))

    assert(recovered.length == signal.length)

    let sum_abs_diff: number = 0
    for(let i:number = 0; i < signal.length; i++)
        sum_abs_diff += Math.abs(signal[i]! - recovered[i]!)

    const mean_abs_diff: number = sum_abs_diff / signal.length
    assert(mean_abs_diff < 1e-3, mean_abs_diff.toExponential())
})



Deno.test('bandpass_filter_fir', () => {
    const fs = 250
    const N  = 75000;
    const signal0: Float32Array = new Float32Array(N).map( i => Math.random()*2-1 );

    const f_min = 10
    const f_max = 15
    const filtered0: Float32Array = sig.bandpass_filter_fir(signal0, fs, f_min, f_max)
    assert(filtered0.length == signal0.length)

    const spectrum_after_filter0 = sig.fft(filtered0, fs)
    assert(spectrum_after_filter0.f_axis.length == spectrum_after_filter0.spectrum.length)

    let before_band = {sum: 0.0, n: 0};
    let within_band = {sum: 0.0, n: 0};
    let after_band  = {sum: 0.0, n: 0};
    for(const index in spectrum_after_filter0.f_axis) {
        const f:number = spectrum_after_filter0.f_axis[index]!

        if(f < f_min) {
            before_band.sum += spectrum_after_filter0.spectrum[index]!
            before_band.n++
        }
        if(f > f_min && f < f_max) {
            within_band.sum += spectrum_after_filter0.spectrum[index]!
            within_band.n++
        }
        if(f > f_max) {
            after_band.sum += spectrum_after_filter0.spectrum[index]!
            after_band.n++
        }
    }
    assert(before_band.n > 0)
    assert(within_band.n > 0)
    assert(after_band.n > 0)

    const mean_before_band = before_band.sum / before_band.n
    const mean_within_band = within_band.sum / within_band.n
    const mean_after_band  = after_band.sum  / after_band.n

    // NOTE: relaxed condition to x9, because FIR is more smooth
    assert( mean_before_band * 9 < mean_within_band )
    assert( mean_after_band * 10 < mean_within_band )
    
})

Deno.test('fft2d impulse', () => {
    const input: Float32Array[] = [
        new Float32Array([1, 0, 0, 0]),
        new Float32Array([0, 0, 0, 0]),
        new Float32Array([0, 0, 0, 0]),
    ]

    const output: Float32Array[] | Error = sig.fft2d(input)
    assert(!(output instanceof Error))
    assert(output.length == input.length)
    assert(output[0]!.length == input[0]!.length * 2)

    for(const row of output) {
        for(let i:number = 0; i < row.length; i += 2) {
            const real: number = row[i]!
            const imag: number = row[i + 1]!
            assert(Math.abs(real - 1) < 1e-6)
            assert(Math.abs(imag) < 1e-6)
        }
    }
})


Deno.test('fft2d semi-random', () => {
    // values from numpy
    const input: Float32Array[] = [
        [0.55,  0.72,  0.60,  0.54,  0.42,  0.65,  0.44],
        [0.89,  0.96,  0.38,  0.79,  0.53,  0.57,  0.93],
        [0.07,  0.09,  0.02,  0.83,  0.78,  0.87,  0.98],
        [0.80,  0.46,  0.78,  0.12,  0.64,  0.14,  0.94],
        [0.52,  0.41,  0.26,  0.77,  0.46,  0.57,  0.02],

    ].map( x => new Float32Array(x) )

    // complex
    const expected: Float32Array[] = [
        [   19.50,  0.00,    0.17,  1.17,    0.81,  0.50,   -0.82, -0.52,   -0.82,  0.52,    0.81, -0.50,    0.17, -1.17],
        [    0.33, -1.80,    1.36, -1.57,    0.36, -0.90,    0.02, -0.12,    1.26,  2.57,   -0.56,  1.03,   -0.79,  1.33],
        [   -0.28, -1.43,   -1.38, -1.99,   -0.87,  0.13,    1.59,  0.82,   -1.69, -1.00,   -0.92, -0.31,    1.30, -2.61],
        [   -0.28,  1.43,    1.30,  2.61,   -0.92,  0.31,   -1.69,  1.00,    1.59, -0.82,   -0.87, -0.13,   -1.38,  1.99],
        [    0.33,  1.80,   -0.79, -1.33,   -0.56, -1.03,    1.26, -2.57,    0.02,  0.12,    0.36,  0.90,    1.36,  1.57],
    ].map( x => new Float32Array(x) )

    const output: Float32Array[] | Error = sig.fft2d(input)
    assert(!(output instanceof Error))
    assert(output.length == input.length)
    assert(output[0]!.length == input[0]!.length * 2)

    for(const i in output) {
        const row_output = output[i]!
        const row_expected = expected[i]!
        for(const j in row_output)
            assert(  Math.abs( row_output[j]! - row_expected[j]! ) < 0.01  )
    }
})
