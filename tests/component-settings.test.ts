import { assert } from 'asserts'
import { Signal, signals } from '../frontend/dep.ts'

import {
    parse_utc_datetime_string,
    SettingsOverlay,
    UtcTimeSettingsEntryComponent,
    type SettingsEntry,
} from '../frontend/ui/component-settings.tsx'


Deno.test('parse_utc_datetime_string parses valid YYYY-MM-DDTHH:MM:SS', () => {
    const parsed: Date | Error = parse_utc_datetime_string('2024-03-15T14:30:45')
    assert(!(parsed instanceof Error))
    assert(parsed.toISOString() == '2024-03-15T14:30:45.000Z')
})

Deno.test('parse_utc_datetime_string returns Error for malformed strings', () => {
    assert(parse_utc_datetime_string('2024-03-15 14:30:45') instanceof Error)
    assert(parse_utc_datetime_string('2024-03-15T14:30') instanceof Error)
    assert(parse_utc_datetime_string('not-a-date') instanceof Error)
})

Deno.test('parse_utc_datetime_string rejects overflowed calendar dates', () => {
    assert(parse_utc_datetime_string('2024-02-30T12:00:00') instanceof Error)
    assert(parse_utc_datetime_string('2023-02-29T12:00:00') instanceof Error)
    assert(parse_utc_datetime_string('2024-13-01T00:00:00') instanceof Error)
    assert(parse_utc_datetime_string('2024-01-01T25:00:00') instanceof Error)
})

Deno.test('SettingsOverlay handles utc-time with Date, multiple, and readonly signals', () => {
    const $writable = new Signal<Date | 'multiple' | null>(
        new Date('2024-01-02T03:04:05Z'),
    )
    const $readonly = signals.computed<Date | 'multiple' | null>(
        () => 'multiple',
    )
    const entries: SettingsEntry[] = [
        {
            type:    'utc-time',
            label:   'Start time',
            $signal: $writable,
        },
        {
            type:    'utc-time',
            label:   'Readonly time',
            $signal: $readonly,
        },
        {
            type:    'utc-time',
            label:   'Missing signal',
            $signal: undefined,
        },
    ]

    let closed_ok: boolean | null = null
    const overlay = new SettingsOverlay({
        settings_entries: entries,
        on_close:         (ok: boolean): void => { closed_ok = ok },
    })

    const vnode = overlay.render()
    assert(vnode != null)

    const comp_multiple = new UtcTimeSettingsEntryComponent({
        type:    'utc-time',
        label:   'Readonly time',
        $signal: $readonly,
    })
    assert(comp_multiple.$input_text.value == '')
    assert(comp_multiple.$is_valid.value == true)
    const rendered_multiple = comp_multiple.render()
    const input_multiple = rendered_multiple.props.children[1]
    assert(input_multiple.props.placeholder == 'multiple')

    comp_multiple.update_draft_value('2024-05-06T07:08')
    assert(!comp_multiple.$is_valid.peek())
    assert(comp_multiple.draft_value == undefined)
    const rendered_invalid = comp_multiple.render()
    const input_invalid = rendered_invalid.props.children[1]
    assert(String(input_invalid.props.style.border).includes('#d32f2f'))

    comp_multiple.update_draft_value('2024-05-06T07:08:09')
    assert(comp_multiple.$is_valid.peek())
    const updated_draft = comp_multiple.draft_value as Date | undefined
    assert(updated_draft instanceof Date)
    assert(updated_draft.toISOString() == '2024-05-06T07:08:09.000Z')

    overlay.entries_refs[0]!.current = new UtcTimeSettingsEntryComponent(
        entries[0] as Extract<SettingsEntry, { type: 'utc-time' }>,
    )
    ;(overlay.entries_refs[0]!.current as UtcTimeSettingsEntryComponent)
        .update_draft_value('2025-01-01T00:00:00')
    overlay.entries_refs[1]!.current = comp_multiple
    ;(overlay as unknown as { on_apply: () => void }).on_apply()
    assert(closed_ok == true)
    assert(
        ($writable.value as Date).toISOString() == '2025-01-01T00:00:00.000Z'
    )
})
