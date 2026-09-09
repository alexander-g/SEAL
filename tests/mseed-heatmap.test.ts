import { assert } from 'asserts'
import { create_station_palette } from '../frontend/ui/mseed-heatmap.tsx'





Deno.test('create_station_palette: different outputs for A02 and A03', () => {
    const color_A02 = create_station_palette('A02')
    const color_A03 = create_station_palette('A03')

    assert( 
        color_A02.b != color_A03.b
        || color_A02.g != color_A03.g
        || color_A02.r != color_A03.r
    )
})


