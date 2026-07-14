import { assert } from "asserts"


import { 
    WorkerPool
} from "../frontend/lib/workerpool.ts"





Deno.test('workerpool0', async () => {
    const pool = new WorkerPool(3)
    
    const fs = 250
    const N  = 7500;
    const signal0: Float32Array = new Float32Array(N).map( i => Math.random()*2-1 );

    const promises: Promise<Float32Array|Error>[] = []
    for(const i of [0,1,2,3,4,5])
        promises.push(
            (await pool.compute_envelope(signal0, fs, 2, 12)).promise
        )
    const results = await Promise.all(promises)
    const result = results[0]!
    assert(!(result instanceof Error))

    assert(result.length == signal0.length)
})




