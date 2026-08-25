import { preact, Signal, signals, JSX } from "./dep.ts"

import { DropZone, type DropProgress }  from "./ui/file-input.tsx"
import { MainContent } from "./ui/main-content.tsx"
import { type InferenceEvent } from "./ui/mseed-heatmap.tsx"

import { 
    process_dropped_files, 
    type ProcessedFiles,
    type MSEED_FileAndMeta,
}                       from "./lib/file-input.ts"
import type { Station } from "./lib/station-xml.ts"
import type { QuakeEvent } from "./lib/quakeml.ts"




/** Config set during build */
// deno-lint-ignore ban-types
export type AppConfig = null | {
    // nothing anymore
}

/** Top-level currently loaded data */
type AppState = {
    /** Main MSEED data files */
    $mseeds: Signal<MSEED_FileAndMeta[]>;

    /** Events recognized as positive during inference. */
    $inference: Signal<InferenceEvent[]>;

    /** Stations from a stationxml file */
    $stations: Signal<Station[]>;

    /** Events from a quakeml file */
    $events: Signal<QuakeEvent[]>;
}




declare global {
    interface Window {
        /** App config is set during build in a <script> inside <Head> */
        app_config: AppConfig;

        /** App state, global for debugging */
        app_state: AppState;
    }
}



/** Main application class */
class App extends preact.Component {
    app_state:AppState = {
        $mseeds:    new Signal([]),
        $inference: new Signal([]),
        $stations:  new Signal([]),
        $events:    new Signal([]),
    }

    $drop_progress: Signal<DropProgress|null> = new Signal(null)


    /** True if MSEED files are loaded */
    $initialized: Readonly<Signal<boolean>> = signals.computed(
        () => this.app_state.$mseeds.value.length > 0
    )


    render(): JSX.Element {
        return <body>
            <MainContent 
                $mseeds     = {this.app_state.$mseeds}
                $inference  = {this.app_state.$inference}
                $events     = {this.app_state.$events}
                $stations   = {this.app_state.$stations}
                app_config  = {self.app_config}
            />
            
            <DropZone 
                $initialized = {this.$initialized}
                $progress    = {this.$drop_progress}
                on_files     = {this.on_files}
            />
        </body>
    }

    /** Called when user drops new files into the browser window */
    on_files = async (files:File[]) => {
        const t0:number = performance.now()
        this.$drop_progress.value = { processed: 0, total: files.length }
        const processed:ProcessedFiles = await process_dropped_files(
            files,
            (processed: number, total: number) => {
                this.$drop_progress.value = { processed, total }
                console.log(`Progress: ${processed}/${total} files processed`)
            }
        )
        this.$drop_progress.value = null
        const t1:number = performance.now()

        console.log(`Files loaded in ${t1-t0} ms`)
        console.log(`# of MSEED files:      ${processed.mseeds.length}`)
        console.log(`# of stations:         ${processed.stations.length}`)
        console.log(`# of inference events: ${processed.inference_events.length}`)
        console.log(`# of QUAKEML events:   ${processed.events.length}`)
        console.log(`# of unknown files:    ${processed.unknown_files.length}`)
        
        if(processed.inference_events.length > 0)
            this.app_state.$inference.value = processed.inference_events;
        if(processed.mseeds.length > 0)
            this.app_state.$mseeds.value = processed.mseeds;
        if(processed.events.length > 0)
            this.app_state.$events.value = processed.events;
        if(processed.stations.length > 0)
            this.app_state.$stations.value = processed.stations
    }

    override componentDidMount(): void {
        // for debugging
        self.app_state = this.app_state
    }
}





type HeadProps = {
    title:      string,
    import_src: string,
    config:     AppConfig,
}

function Head(props:HeadProps): JSX.Element {
    const configjson:string = JSON.stringify(props.config).replace(/</g, "\\u003c");
    return <head>
        <title>{ props.title }</title>
        <script type="module" src={props.import_src}></script>
        <script dangerouslySetInnerHTML={ {
            __html: `window.app_config = ${ configjson }`
        } } />
    </head>
}



/** Main JSX entry point */
export function Index(config?:AppConfig): JSX.Element {
    return <html>
        <Head 
            title      = "SEAL - Seismic Exploration & Analysis Lab" 
            import_src = "index.tsx.js" 
            config     = {config ?? null}
        />
        <App />
    </html>
}

export function hydrate_body(body_jsx:JSX.Element): void {
    const body: Element|null = document.querySelector(`body`)
    if(body && body.parentElement) {
        preact.hydrate(body_jsx, body.parentElement)
    }
}

if(!globalThis.Deno){
    hydrate_body(<App />)
}
