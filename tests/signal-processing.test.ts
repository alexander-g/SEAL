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




