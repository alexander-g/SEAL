import { assert } from 'asserts'
import { Signal } from '../frontend/dep.ts'

import {
    type AudioWaveform,
    compute_playback_position_seconds,
    format_playback_position,
    get_position_status_text,
    parse_slider_number,
} from '../frontend/ui/audio-playback-controls.tsx'
import { MSEED_AudioPlayback } from '../frontend/ui/mseed-audio.tsx'
import { ContainerWithOverlay } from '../frontend/ui/plot-image.tsx'
import { WorkerPool } from '../frontend/lib/workerpool.ts'


Deno.test('format_playback_position formats valid seconds', () => {
    const formatted:string|Error = format_playback_position(61.234)
    assert(!(formatted instanceof Error))
    assert(formatted == '01:01.234')
})

Deno.test('parse_slider_number returns error for invalid input', () => {
    const parsed:number|Error = parse_slider_number('invalid', 0, 3)
    assert(parsed instanceof Error)
})

Deno.test('get_position_status_text clamps position at duration edge', () => {
    const text:string = get_position_status_text(999, 10)
    assert(text == '00:10.000 / 00:10.000')
})

Deno.test('compute_playback_position_seconds returns position', () => {
    const position:number|Error = compute_playback_position_seconds(
        2,
        5,
        7,
        1.5,
    )
    assert(!(position instanceof Error))
    assert(position == 5)
})

Deno.test('compute_playback_position_seconds returns error on speed', () => {
    const position:number|Error = compute_playback_position_seconds(
        0,
        1,
        2,
        0,
    )
    assert(position instanceof Error)
})

Deno.test('compute_playback_position_seconds returns error on time', () => {
    const position:number|Error = compute_playback_position_seconds(
        0,
        2,
        1,
        1,
    )
    assert(position instanceof Error)
})

Deno.test('MSEED_AudioPlayback renders ContainerWithOverlay and processes audio in worker', async () => {
    WorkerPool.get_instance(3)

    const $audiodata: Signal<AudioWaveform|null> = new Signal(null)
    const component = new MSEED_AudioPlayback({ $audiodata })

    const rendered = component.render()
    assert(rendered.type === ContainerWithOverlay)
    assert(rendered.props.$is_loading === component.$loading)
    assert(!component.$loading.value)
    assert(component.$processed_audiodata.value == null)

    const signal: Float32Array = new Float32Array(100)
    for(let i:number = 0; i < signal.length; i++)
        signal[i] = Math.sin(2 * Math.PI * 5 * (i / 100))

    $audiodata.value = { data: signal, samplerate: 100 }
    assert(component.$loading.value)

    while(component.$loading.value)
        await new Promise((resolve) => setTimeout(resolve, 5))

    assert(!component.$loading.value)
    const processed: AudioWaveform|null = component.$processed_audiodata.peek()
    assert(processed != null)
    assert(processed.samplerate == 8000)
    assert(processed.data.length == 8000)

    component.componentWillUnmount()
})


