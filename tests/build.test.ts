import { assert } from 'asserts'
import * as fs   from "@std/fs"
import * as path from "@std/path"

import { build_all } from "../build.ts";




Deno.test('build.basic', async () => {
    const tempdir:string = Deno.makeTempDirSync({ prefix: 'tests' });

    await build_all(tempdir, /*minify =*/false)
    
    const index_html:string = path.join(tempdir, 'index.html')
    assert(fs.existsSync(index_html));

    const index_js:string = path.join(tempdir, 'index.tsx.js')
    assert(fs.existsSync(index_js));
})


