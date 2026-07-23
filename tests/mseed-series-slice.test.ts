import { assert } from 'asserts'
import * as path from '@std/path'

import {
    read_mseed_metadata,
    type MSeedMetadata,
} from '../frontend/lib/mseed-parsing.ts'
import {
    read_mseed_slice_across_files,
    type MSEED_FileAndMeta,
} from '../frontend/lib/file-input.ts'


const STA1_FILES: string[] = [
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA1.HHZ.20260101T000000.mseed')
    ),
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA1.HHZ.20260101T000100.mseed')
    ),
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA1.HHZ.20260101T000200.mseed')
    ),
]

const STA2_FILES: string[] = [
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA2.HHZ.20260101T000000.mseed')
    ),
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA2.HHZ.20260101T000100.mseed')
    ),
    path.fromFileUrl(
        import.meta.resolve('./assets/series/XX.STA2.HHZ.20260101T000200.mseed')
    ),
]


Deno.test('mseed-series-slice', async (t:Deno.TestContext) => {
    await t.step('expected-use-sta1', async () => {
        const mseeds: MSEED_FileAndMeta[]|Error =
            await build_mseed_series(STA1_FILES)
        assert(!(mseeds instanceof Error))

        const slice_end_index: number = compute_total_samples(mseeds)

        const data: Float32Array|Error = await read_mseed_slice_across_files(
            mseeds,
            0,
            [0, slice_end_index],
        )
        assert(!(data instanceof Error))
        assert(data.length == slice_end_index)

        // STA1 files have mean of 1
        const mean: number = compute_mean(data)
        assert(Math.abs(mean - 1) < 0.2)
    })

    await t.step('expected-use-sta2', async () => {
        const mseeds: MSEED_FileAndMeta[]|Error =
            await build_mseed_series(STA2_FILES)
        assert(!(mseeds instanceof Error))

        const slice_end_index: number = compute_total_samples(mseeds)

        const data: Float32Array|Error = await read_mseed_slice_across_files(
            mseeds,
            0,
            [0, slice_end_index],
        )
        assert(!(data instanceof Error))
        assert(data.length == slice_end_index)

        // STA1 files have mean of 2
        const mean: number = compute_mean(data)
        assert(Math.abs(mean - 2) < 0.2)
    })

    await t.step('failure-case', async () => {
        const mseeds: MSEED_FileAndMeta[]|Error =
            await build_mseed_series(STA1_FILES)
        assert(!(mseeds instanceof Error))

        const data: Float32Array|Error = await read_mseed_slice_across_files(
            mseeds,
            0,
            [10, 5],
        )
        assert(data instanceof Error)
    })

    await t.step('edge-case', async () => {
        const mseeds: MSEED_FileAndMeta[]|Error =
            await build_mseed_series(STA1_FILES)
        assert(!(mseeds instanceof Error))

        const total_samples: number = compute_total_samples(mseeds)
        const extra_samples: number =
            Math.floor(mseeds[0]!.meta.samplerate * 5)

        const data: Float32Array|Error = await read_mseed_slice_across_files(
            mseeds,
            0,
            [0, total_samples + extra_samples],
        )
        assert(!(data instanceof Error))
        assert(data.length == total_samples + extra_samples)

        for(let i:number = data.length - extra_samples; i < data.length; i++)
            assert(data[i] == 0)
    })

    await t.step('overlap-does-not-error', async () => {
        const overlapping_files: string[] = [
            STA1_FILES[0]!,
            STA1_FILES[0]!,
            STA1_FILES[1]!,
        ]
        const mseeds: MSEED_FileAndMeta[]|Error =
            await build_mseed_series(overlapping_files)
        assert(!(mseeds instanceof Error))

        const slice_end_index: number = compute_total_samples(mseeds)

        const data: Float32Array|Error = await read_mseed_slice_across_files(
            mseeds,
            0,
            [0, slice_end_index],
        )
        assert(!(data instanceof Error))
        assert(data.length == slice_end_index)

        const mean: number = compute_mean(data)
        assert(Math.abs(mean - 1) < 0.2)
    })
})


/** Build MSEED file+meta list from assets. */
async function build_mseed_series(
    file_paths: string[],
): Promise<MSEED_FileAndMeta[]|Error> {
    const output: MSEED_FileAndMeta[] = []
    try {
        for(const file_path of file_paths) {
            const buffer: Uint8Array<ArrayBuffer> = Deno.readFileSync(file_path)
            const filename: string = path.basename(file_path)
            const file: File = new File([buffer], filename)
            const meta: MSeedMetadata|Error = await read_mseed_metadata(file)
            if(meta instanceof Error)
                return meta
            output.push({file, meta})
        }
    } catch(e) {
        return (e instanceof Error) ? e : new Error(String(e))
    }

    output.sort((a: MSEED_FileAndMeta, b: MSEED_FileAndMeta) =>
        a.meta.starttime.getTime() - b.meta.starttime.getTime()
    )
    return output
}

/** Compute total sample count from first to last file. */
function compute_total_samples(mseeds: MSEED_FileAndMeta[]): number {
    const first: MSEED_FileAndMeta = mseeds[0]!
    const last: MSEED_FileAndMeta = mseeds[mseeds.length - 1]!
    const duration_seconds: number =
        (last.meta.endtime.getTime() - first.meta.starttime.getTime()) / 1000
    return Math.floor(duration_seconds * first.meta.samplerate)
}

/** Compute mean value of samples. */
function compute_mean(data: Float32Array): number {
    let sum: number = 0
    for(const value of data)
        sum += value
    return sum / data.length
}
