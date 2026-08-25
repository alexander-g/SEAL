#!./deno.sh run  --cached-only --allow-read=./ --allow-write=./static/ --unstable-bundle ./build.ts


import * as fs   from "@std/fs"
import * as path from "@std/path"
// NOTE: adding /jsr for pretty rendering
import * as preact_ssr from "preact-render-to-string/jsx";

import type { AppConfig, Index } from "./frontend/index.tsx";



const HARDCODED_OUTPUTDIR:string = 
    path.fromFileUrl(import.meta.resolve('./static') )
const HARDCODED_OUTPUTFILE_INDEX_JS:string   = 'index.tsx.js'
const HARDCODED_OUTPUTFILE_INDEX_HTML:string = 'index.html'
const HARDCODED_INDEX_TSX:string = './frontend/index.tsx'


const HARDCODED_WORKER_JS:string = './frontend/lib/worker.ts'
const HARDCODED_OUTPUTFILE_WORKER_JS:string = 'worker.ts.js'



// adding bundle etc to Deno because otherwise always get errors during checks
// --unstable-bundle does not help
declare global {
    namespace Deno {

        interface BundleOptions {
            entrypoints?: string[];
            output?:      string;
            platform?:    "browser" | "deno" ;
            minify?:      boolean;
            write?:       boolean;
            sourcemap?:   'inline'
        }
        
        interface BundleResult {
            success: boolean,
            errors: {
                text:string,
            }[],
            outputFiles: {
                contents: Uint8Array<ArrayBuffer>,
                text: () => string,
                hash: string,
            }[]
        }

        // optional because undefined if run without --unstable-bundle
        const bundle: ((options: BundleOptions) => Promise<BundleResult>) | undefined;
    }
}


async function bundle_js_file(inputpath:string, outputpath:string,  minify:boolean) {
    if(!Deno.bundle) 
        throw new Error(`No Deno.bundle(). Forgot --unstable-bundle?`)

    const output:Deno.BundleResult = await Deno.bundle({
        entrypoints: [inputpath],
        output:      "dist",
        platform:    "browser",
        minify:      minify,
        write:       false,
        sourcemap:   minify? undefined : 'inline'
    })

    if(!output.success) {
        const errormessages:string = output.errors.map(
            (e:{text:string}) => e.text
        ).join('\n\n')
        throw new Error(`Bundling failed: ${errormessages}`)
    }
    //else
    if(output.outputFiles.length != 1)
        // should not happen
        throw (
            new Error(`Expected one output file. Got ${output.outputFiles.length}`)
        )
    
    fs.ensureDirSync(path.dirname(outputpath));
    Deno.writeTextFileSync(outputpath, output.outputFiles[0]!.text())
}


async function bundle_index_js(outputdir:string, minify:boolean) {
    const outputpath:string = 
        path.join(outputdir, HARDCODED_OUTPUTFILE_INDEX_JS)
    return await bundle_js_file(HARDCODED_INDEX_TSX, outputpath, minify)
}


async function bundle_worker(outputdir:string, minify:boolean) {
    const outputpath:string = 
        path.join(outputdir, HARDCODED_OUTPUTFILE_WORKER_JS)
    return await bundle_js_file(HARDCODED_WORKER_JS, outputpath, minify)
}





async function compile_index_html(outputdir:string) {
    const module: { Index?: typeof Index } = 
        await import(HARDCODED_INDEX_TSX);
    if(!module.Index)
        throw new Error('Could not find <Index/> component')
    
    
    // deno-lint-ignore no-explicit-any
    const main_element:any = module.Index()
    const rendered:string  = preact_ssr.render(main_element, {}, {pretty:true, jsx:false})

    const outputpath:string = 
        path.join(outputdir, HARDCODED_OUTPUTFILE_INDEX_HTML)
    fs.ensureDirSync(path.dirname(outputpath));
    Deno.writeTextFileSync(outputpath, rendered)
}




function clear_outputdir(outputdir:string) {
    try {
        Deno.removeSync(outputdir, {recursive:true})
    // deno-lint-ignore no-empty
    } catch {}
    fs.ensureDirSync(outputdir);
}



export async function build_all(
    outputdir:      string, 
    minify:         boolean
) {
    clear_outputdir(outputdir)
    await compile_index_html(outputdir);
    await bundle_index_js(outputdir, minify);
    await bundle_worker(outputdir, minify);
}


if(import.meta.main) {
    const minify:boolean = Deno.args.includes('--minify')

    await build_all(HARDCODED_OUTPUTDIR, minify)

    console.log('done')
}


