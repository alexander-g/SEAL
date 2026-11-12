import { preact, Signal, signals, JSX } from '../dep.ts'

import { 
    AudioPlaybackControls, 
    type AudioWaveform,
} from './audio-playback-controls.tsx'
import { ContainerWithOverlay } from './plot-image.tsx'
import { prepare_seismic_signal_for_audio } from '../lib/signal-processing.ts'
import { WorkerPool } from '../lib/workerpool.ts'

export { prepare_seismic_signal_for_audio }


export class MSEED_AudioPlayback extends preact.Component<{
    $audiodata: Readonly<Signal<AudioWaveform | null>>
}> {
    render(): JSX.Element {
        return  (
        <ContainerWithOverlay 
            $is_loading = {this.$loading}
            opacity     = {0.8}
            background  = "lightgray"
        >
            <AudioPlaybackControls $audiodata={this.$processed_audiodata} />
        </ContainerWithOverlay>
        )
    }

    override componentWillUnmount(): void {
        this.#update_effect_cleanup_fn()
    }

    $loading:             Signal<boolean>            = new Signal(false)
    $processed_audiodata: Signal<AudioWaveform|null> = new Signal(null)

    #request_id: number = 0

    #update_effect_cleanup_fn = signals.effect( (async () => {
        const input: AudioWaveform|null = this.props.$audiodata.value
        const request_id: number        = ++this.#request_id

        if(input == null) {
            this.$processed_audiodata.value = null
            this.$loading.value             = false
            return
        }

        this.$loading.value = true
        try {
            const f_target: number = 8000
            const workerpool: WorkerPool = WorkerPool.get_instance()
            const new_signal: Float32Array|Error = await (
                await workerpool.prepare_seismic_signal_for_audio(
                    input.data,
                    input.samplerate,
                    f_target,
                )
            ).promise

            if(request_id !== this.#request_id)
                return

            if(new_signal instanceof Error) {
                console.error(new_signal)
                this.$processed_audiodata.value = null
                return
            }

            this.$processed_audiodata.value = {
                data:       new_signal,
                samplerate: f_target,
            }
        } finally {
            if(request_id === this.#request_id)
                this.$loading.value = false
        }
    }) as () => void )
}


