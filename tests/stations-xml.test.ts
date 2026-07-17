import { parse_stationxml_file, type Station } from "../frontend/lib/station-xml.ts";
import * as path from "@std/path"
import { assert } from "asserts";


const STATIONSXMLFILE:string = path.fromFileUrl(
    import.meta.resolve('./assets/stations.xml')
)
const QUAKEMLFILE:string = path.fromFileUrl(
    import.meta.resolve('./assets/events.xml')
)




Deno.test('parse_stationxml', async () => {
    const f:File = new File([Deno.readFileSync(STATIONSXMLFILE)], "stations.xml")
    const output0:Station[]|Error = await parse_stationxml_file(f)
    assert(!(output0 instanceof Error))

    assert(output0.length == 9, `${output0.length}` )

    const channels = output0.map( station => station.channels ).filter(Boolean).flat()
    assert(channels.length == 4)

    const responses = channels.map( c => c?.response ).filter(Boolean).flat()
    assert(responses.length == 2)

    const networks = new Set(output0.map( station => station.network ))
    assert(networks.size == 1)
    assert(networks.has('XXX'))
})


Deno.test('parse_stationxml.invalid', async () => {
    const f:File = new File([Deno.readFileSync(QUAKEMLFILE)], "stations.xml")
    const output0:Station[]|Error = await parse_stationxml_file(f)
    assert(output0 instanceof Error)
})






