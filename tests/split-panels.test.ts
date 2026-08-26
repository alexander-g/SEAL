import { assert } from 'asserts'

import {
    normalize_ratios,
    apply_drag_to_panel_ratios,
    reconcile_panel_ratios_by_keys,
} from '../frontend/ui/split-panels.tsx'


Deno.test('apply_drag_to_panel_ratios resizes adjacent panels', () => {
    const output: number[] = apply_drag_to_panel_ratios(
        [0.5, 0.5],
        0,
        100,
        1000,
        8,
        [160, 160],
    )

    assert(output.length == 2)
    assert(output[0]! > 0.5)
    assert(output[1]! < 0.5)
    assert(Math.abs(output[0]! + output[1]! - 1) < 1e-9)
})


Deno.test('apply_drag_to_panel_ratios clamps at minimum panel size', () => {
    const output: number[] = apply_drag_to_panel_ratios(
        [0.5, 0.5],
        0,
        -400,
        1000,
        8,
        [200, 200],
    )

    const available_size_px: number = 1000 - 8
    const left_px: number = output[0]! * available_size_px
    assert(left_px >= 200)
    assert(Math.abs(output[0]! + output[1]! - 1) < 1e-9)
})


Deno.test('normalize_ratios handles invalid and zero values', () => {
    const output: number[] = normalize_ratios([0, Number.NaN, -1])

    assert(output.length == 3)
    assert(Math.abs(output[0]! - 1 / 3) < 1e-9)
    assert(Math.abs(output[1]! - 1 / 3) < 1e-9)
    assert(Math.abs(output[2]! - 1 / 3) < 1e-9)
})


Deno.test('reconcile_panel_ratios_by_keys keeps known key ratios', () => {
    const output: number[] = reconcile_panel_ratios_by_keys(
        ['a', 'b', 'c'],
        ['b', 'd', 'a'],
        [0.2, 0.3, 0.5],
    )

    assert(output.length == 3)
    assert(output[0]! > output[2]!)
    assert(output[1]! > 0)
    assert(Math.abs(output[0]! + output[1]! + output[2]! - 1) < 1e-9)
})


Deno.test('reconcile_panel_ratios: new-keys-should-not-be-zero', () => {
    const output: number[] = reconcile_panel_ratios_by_keys(
        ['a', 'b'],
        ['a', 'b', 'c'],
        [0.4, 0.6],
    )

    assert(output.length == 3)
    assert( Math.abs( (output[0]! / output[1]!) - (0.4 / 0.6)) < 0.01 )
    assert(output[2]! > 0)
    assert(Math.abs(output[0]! + output[1]! + output[2]! - 1) < 1e-9)
})

