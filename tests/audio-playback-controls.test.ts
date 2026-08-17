import { assert } from 'asserts'

import {
    compute_playback_position_seconds,
    format_playback_position,
    get_position_status_text,
    parse_slider_number,
} from '../frontend/ui/audio-playback-controls.tsx'


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

