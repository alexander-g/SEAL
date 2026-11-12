import { assert } from 'asserts'
import { Signal } from '../frontend/dep.ts'

import {
    AudioPlaybackControls,
    type AudioWaveform,
    compute_playback_position_seconds,
    format_playback_position,
    get_position_status_text,
    parse_slider_number,
} from '../frontend/ui/audio-playback-controls.tsx'
import { MSEED_AudioPlayback } from '../frontend/ui/mseed-audio.tsx'
import {
    compute_playback_time,
} from '../frontend/ui/main-content.tsx'
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

Deno.test('on_position_input seeks to slider position while playing without resetting to old audio clock', () => {
    const $audiodata: Signal<AudioWaveform|null> = new Signal({
        data:       new Float32Array(100),
        samplerate: 10,
    })
    const reported_positions: number[] = []
    const controls = new AudioPlaybackControls({
        $audiodata,
        on_position_change: (pos: number): void => {
            reported_positions.push(pos)
        },
    })

    controls.$is_playing.value = true
    ;(controls as unknown as {
        audio_context:          { currentTime: number, close: () => Promise<void> }
        playback_started_at:    number
        playback_start_seconds: number
    }).audio_context = { currentTime: 1, close: () => Promise.resolve() }
    ;(controls as unknown as { playback_started_at: number }).playback_started_at = 0
    ;(controls as unknown as { playback_start_seconds: number }).playback_start_seconds = 1
    controls.$speed.value = 1

    controls.on_position_input({
        currentTarget: { value: '7.5' },
    } as unknown as Event)

    assert(controls.$position_seconds.value == 7.5)
    assert(reported_positions[reported_positions.length - 1] == 7.5)
})

Deno.test('compute_playback_time maps position offset onto first slice start_time', () => {
    const start_time = new Date('2024-01-01T00:00:00.000Z')
    const result = compute_playback_time(start_time, 12.5)
    assert(result != null)
    assert(result.getTime() == start_time.getTime() + 12500)
})

Deno.test('compute_playback_time returns null for missing start_time or invalid position', () => {
    const start_time = new Date('2024-01-01T00:00:00.000Z')
    assert(compute_playback_time(null, 5) == null)
    assert(compute_playback_time(start_time, null) == null)
    assert(compute_playback_time(start_time, -1) == null)
    assert(compute_playback_time(start_time, Number.NaN) == null)
})

Deno.test('compute_playback_time handles zero offset boundary', () => {
    const start_time = new Date('2024-01-01T00:00:00.000Z')
    const result = compute_playback_time(start_time, 0)
    assert(result != null)
    assert(result.getTime() == start_time.getTime())
})



