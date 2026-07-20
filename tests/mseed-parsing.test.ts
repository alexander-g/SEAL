import { assert } from "asserts";
import * as path from '@std/path'

import { 
    type MSeedMetadata, 
    read_mseed_metadata,
    is_mseed,
} from "../frontend/lib/mseed-parsing.ts";

import { initialize } from '../wasm-cpp/mseed-wasm.ts'




const MSEED_FILES: string[] = [
    // bug: little endian (i32)
    path.fromFileUrl(import.meta.resolve('./assets/X2.H030.00.HHE.D.2022.132_slice')),
    // big endian (i32)
    path.fromFileUrl(import.meta.resolve('./assets/2018-01-28T00:00:00-CN.SHB..BHZ')),
    // f64
    path.fromFileUrl(import.meta.resolve('./assets/synthetic-f64.mseed')),
    // + multitrace
    path.fromFileUrl(import.meta.resolve('./assets/synthetic-f64-dual-trace.mseed')),
]

const NOT_A_MSEED:string = 
    path.fromFileUrl(import.meta.resolve('./assets/events.xml'))



Deno.test('mseed-parsing0', async (t:Deno.TestContext) => {

    await t.step('little-endian', async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[0]!)
        assert( is_mseed( new DataView(mseeddata.buffer) ) )
    
        const blob = new Blob([mseeddata])
        const output:MSeedMetadata|Error = await read_mseed_metadata(blob)
        // console.log(output)
        assert(!(output instanceof Error))
        assert(output.starttime.getUTCFullYear() == 2022)
    })


    await t.step('big-endian',async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[1]!)
        assert( is_mseed( new DataView(mseeddata.buffer) ) )
    
        const blob = new Blob([mseeddata])
        const output:MSeedMetadata|Error = await read_mseed_metadata(blob)
        // console.log(output)
        assert(!(output instanceof Error))
        assert(output.starttime.getUTCFullYear() == 2018)
    })

    await t.step('not-mseed', async () => {
        const notmseed= Deno.readFileSync(NOT_A_MSEED)
        assert( !is_mseed( new DataView(notmseed.buffer) ) )

        const blob = new Blob([notmseed])
        const output:MSeedMetadata|Error = await read_mseed_metadata(blob)
        assert(output instanceof Error)
    })
})



Deno.test('mseed-reading', async (t:Deno.TestContext) => {
    const tremorwasm = await initialize()

    await t.step('big-endian', async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[1]!)
        const file = new File([mseeddata], 'file.mseed')
        const result = await tremorwasm.read_data(file)
        assert( !(result instanceof Error) )
        assert( result.byteLength > 0 )
    })

    await t.step('little-endian', async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[0]!)
        const file = new File([mseeddata], 'file.mseed')
        const result = await tremorwasm.read_data(file)
        assert( !(result instanceof Error) )
        assert( result.byteLength > 0 )
    })

    await t.step('not-mseed', async () => {
        const notmseed= Deno.readFileSync(NOT_A_MSEED)
        const file = new File([notmseed], 'file.mseed')
        const result = await tremorwasm.read_data(file)
        assert( result instanceof Error )
    })

    await t.step('f64', async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[2]!)
        const file = new File([mseeddata], 'file.mseed')
        const result = await tremorwasm.read_data(file)
        assert( !(result instanceof Error) )
        assert( result.byteLength > 0 )
    })

    await t.step('f64-dual-trace', async () => {
        const mseeddata= Deno.readFileSync(MSEED_FILES[3]!)
        const file = new File([mseeddata], 'file.mseed')
        const result = await tremorwasm.read_data(file)
        assert( !(result instanceof Error) )
        assert( result.byteLength > 0 )
    })
})

Deno.test('mseed-writing', async (t:Deno.TestContext) => {
    const tremorwasm = await initialize()
    const starttime:Date = new Date(Date.UTC(2020, 0, 1))

    await t.step('expected-use', async () => {
        const data:Float32Array = new Float32Array(1000)
        for(let i:number = 0; i < data.length; i++)
            data[i] = Math.sin(i / 10)

        const file:File|Error = await tremorwasm.write_mseed(data, {
            code: 'XX.TEST..BHZ',
            samplerate: 20,
            starttime: starttime,
        })
        console.log(file)
        assert(!(file instanceof Error))
        assert(file.size > 0)

        const meta = await tremorwasm.read_metadata(file)
        assert(!(meta instanceof Error))
        assert(meta.nsamples == data.length)
        assert(meta.samplerate == 20)
        assert(meta.code == 'XX.TEST..BHZ')
    })

    await t.step('failure-case', async () => {
        const data:Float32Array = new Float32Array([1, 2, 3])
        const file:File|Error = await tremorwasm.write_mseed(data, {
            code: '',
            samplerate: 1,
            starttime: starttime,
        })
        assert(file instanceof Error)
    })

    await t.step('edge-case', async () => {
        const data:Float32Array = new Float32Array([42])
        const file:File|Error = await tremorwasm.write_mseed(data, {
            code: 'YY.EDGE..HHZ',
            samplerate: 5,
            starttime: starttime,
        })
        assert(!(file instanceof Error))

        const meta = await tremorwasm.read_metadata(file)
        assert(!(meta instanceof Error))
        assert(meta.nsamples == 1)
    })
})
