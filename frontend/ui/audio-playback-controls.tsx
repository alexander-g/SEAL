import { preact, Signal, JSX } from '../dep.ts'
import { get_selectable_button_style } from './selectable-panels-row.tsx'


const SPEED_MIN:number = 0.5
const SPEED_MAX:number = 10
const SPEED_STEP:number = 0.5

const GAIN_MIN:number = 0
const GAIN_MAX:number = 5
const GAIN_STEP:number = 0.1



export type AudioWaveform = {
    /** Raw waveform data */
    data: Float32Array;

    /** Samples per second (Hz) */
    samplerate: number;
}


export type AudioPlaybackControlsProps = {
    /** @input Waveform to play back. None if null */
    $audiodata: Readonly<Signal<AudioWaveform | null>>
    
    /** Called during playback with the current position  */
    on_position_change?: (position_seconds:number) => void
}


/** Render audio transport controls and emit UI changes. */
export class AudioPlaybackControls extends preact.Component<AudioPlaybackControlsProps> {

    render(): JSX.Element {
        const duration_seconds:number = 
            get_duration_seconds(this.props.$audiodata.value)
        const has_audio:boolean = duration_seconds > 0
        const position_max:number = duration_seconds > 0 ? duration_seconds : 1
        const position_seconds:number = 
            clamp_audio_value(this.$position_seconds.value, 0, duration_seconds)

        const position_text:string = 
            get_position_status_text(position_seconds, duration_seconds)

        return <div style={{
            display:    'flex',
            alignItems: 'center',
            flexWrap:   'wrap',
            rowGap:     '8px',
            columnGap:  '12px',
            color:      '#3f3f3f',
            fontSize:   '12px',
        }}>
            <div style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '6px',
            }}>
                <button
                    type     = 'button'
                    onClick  = {this.on_start_click}
                    style    = {get_selectable_button_style(this.$is_playing.value)}
                    disabled = {this.$is_playing.value || !has_audio}
                >
                    Start
                </button>
                <button
                    type     = 'button'
                    onClick  = {this.on_pause_click}
                    style    = {
                        get_selectable_button_style(!this.$is_playing.value && has_audio)
                    }
                    disabled = {!this.$is_playing.value || !has_audio}
                >
                    Pause
                </button>
                <button
                    type     = 'button'
                    onClick  = {this.on_stop_click}
                    style    = {get_selectable_button_style(false)}
                    disabled = {!this.$is_playing.value && position_seconds == 0}
                >
                    Stop
                </button>
            </div>

            <label style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '6px',
            }}>
                <span>Speed</span>
                <input
                    type    = 'range'
                    min     = {SPEED_MIN}
                    max     = {SPEED_MAX}
                    step    = {SPEED_STEP}
                    value   = {this.$speed.value}
                    onInput = {this.on_speed_input}
                    disabled = {!has_audio}
                />
                <span style={{ minWidth: '42px' }}>
                    {this.$speed.value.toFixed(2)}x
                </span>
            </label>

            <label style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '6px',
            }}>
                <span>Gain</span>
                <input
                    type    = 'range'
                    min     = {GAIN_MIN}
                    max     = {GAIN_MAX}
                    step    = {GAIN_STEP}
                    value   = {this.$gain.value}
                    onInput = {this.on_gain_input}
                    disabled = {!has_audio}
                />
                <span style={{ minWidth: '42px' }}>
                    {this.$gain.value.toFixed(2)}
                </span>
            </label>

            <label style={{
                display:    'flex',
                alignItems: 'center',
                gap:        '6px',
                minWidth:   '220px',
                flex:       '1 1 220px',
            }}>
                <span>Position</span>
                <input
                    type     = 'range'
                    min      = {0}
                    max      = {position_max}
                    step     = {0.01}
                    value    = {position_seconds}
                    onInput  = {this.on_position_input}
                    disabled = {!has_audio}
                    style    = {{ flex: '1 1 auto' }}
                />
                <output>{position_text}</output>
            </label>
        </div>
    }

    $is_playing: Signal<boolean> = new Signal(false)
    
    /** Current playback speed factor */
    $speed: Signal<number> = new Signal(1)
    
    /** Current gain factor */
    $gain:  Signal<number> = new Signal(1)

    /** Current playback position */
    $position_seconds: Signal<number> = new Signal(0)

    on_start_click = (): void => {
        const waveform:AudioWaveform|null = this.props.$audiodata.value
        if(waveform == null)
            return

        const duration_seconds:number = get_duration_seconds(waveform)
        if(duration_seconds <= 0)
            return

        const start_position_seconds:number = clamp_audio_value(
            this.$position_seconds.value,
            0,
            duration_seconds,
        )
        this.$is_playing.value = true
        const start_result:void|Error =
            this.start_playback_from(waveform, start_position_seconds)
        if(start_result instanceof Error) {
            this.$is_playing.value = false
            return
        }
    }

    on_pause_click = (): void => {
        this.update_position_from_audio_clock()
        this.stop_playback()
        this.$is_playing.value = false
    }

    on_stop_click = (): void => {
        this.stop_playback()
        this.$is_playing.value = false
        this.$position_seconds.value = 0
        this.props.on_position_change?.(0)
    }

    on_speed_input = (event:Event): void => {
        const target:HTMLInputElement = event.currentTarget as HTMLInputElement
        const parsed:number|Error = 
            parse_slider_number(target.value, SPEED_MIN, SPEED_MAX)
        if(parsed instanceof Error)
            return

        this.$speed.value = parsed

        if(this.$is_playing.value)
            this.restart_playback_at_current_position()
    }

    on_gain_input = (event:Event): void => {
        const target:HTMLInputElement = event.currentTarget as HTMLInputElement
        const parsed:number|Error = 
            parse_slider_number(target.value, GAIN_MIN, GAIN_MAX)
        if(parsed instanceof Error)
            return

        this.$gain.value = parsed
        if(this.gain_node != null)
            this.gain_node.gain.value = this.$gain.value
    }

    on_position_input = (event:Event): void => {
        const target:HTMLInputElement = event.currentTarget as HTMLInputElement
        const duration_seconds:number = get_duration_seconds(this.props.$audiodata.value)

        const parsed:number|Error = 
            parse_slider_number(target.value, 0, duration_seconds)
        if(parsed instanceof Error)
            return

        this.$position_seconds.value = parsed
        this.props.on_position_change?.(parsed)

        if(this.$is_playing.value)
            this.restart_playback_at_current_position()
    }

    override componentDidUpdate(
        previous_props:AudioPlaybackControlsProps,
    ): void {
        if(previous_props.$audiodata.value === this.props.$audiodata.value)
            return

        this.stop_playback()
        this.$is_playing.value = false
        this.$position_seconds.value = 0
        this.props.on_position_change?.(0)
    }

    override componentWillUnmount(): void {
        this.stop_playback()
        if(this.audio_context != null)
            this.audio_context.close()
    }

    /** Play from a position and start position updates. */
    private start_playback_from(
        waveform:AudioWaveform,
        position_seconds:number,
    ): void|Error {
        this.stop_playback()

        const audio_context:AudioContext|Error = create_audio_context()
        if(audio_context instanceof Error)
            return audio_context

        const audio_buffer:AudioBuffer|Error =
            build_audio_buffer(audio_context, waveform)
        if(audio_buffer instanceof Error)
            return audio_buffer

        const source_node:AudioBufferSourceNode =
            audio_context.createBufferSource()
        source_node.buffer = audio_buffer
        source_node.playbackRate.value = this.$speed.value

        const gain_node:GainNode = audio_context.createGain()
        gain_node.gain.value = this.$gain.value

        source_node.connect(gain_node)
        gain_node.connect(audio_context.destination)

        this.audio_context = audio_context
        this.source_node = source_node
        this.gain_node = gain_node
        this.playback_start_seconds = position_seconds
        this.playback_started_at = audio_context.currentTime

        try {
            source_node.start(0, position_seconds)
        } catch (error:unknown) {
            return new Error(String(error))
        }

        this.schedule_position_updates()
    }

    /** Stop audio source and cancel position updates. */
    private stop_playback(): void {
        if(this.animation_frame_id != null) {
            cancelAnimationFrame(this.animation_frame_id)
            this.animation_frame_id = null
        }

        if(this.source_node != null) {
            try {
                this.source_node.stop()
            } catch {
                // ignore repeated stop
            }
            try {
                this.source_node.disconnect()
            } catch {
                // ignore disconnect errors
            }
        }

        if(this.gain_node != null) {
            try {
                this.gain_node.disconnect()
            } catch {
                // ignore disconnect errors
            }
        }

        if(this.audio_context != null) {
            this.audio_context.close().catch((): void => {})
        }

        this.audio_context = null
        this.source_node = null
        this.gain_node = null
        this.playback_started_at = null
        this.playback_start_seconds = null
    }

    /** Update position from audio clock and notify listeners. */
    private update_position_from_audio_clock(): void {
        if(this.audio_context == null)
            return
        if(this.playback_started_at == null)
            return
        if(this.playback_start_seconds == null)
            return

        const computed_position:number|Error =
            compute_playback_position_seconds(
                this.playback_start_seconds,
                this.playback_started_at,
                this.audio_context.currentTime,
                this.$speed.value,
            )
        if(computed_position instanceof Error)
            return

        const duration_seconds:number =
            get_duration_seconds(this.props.$audiodata.value)
        const clamped_seconds:number = clamp_audio_value(
            computed_position,
            0,
            duration_seconds,
        )

        this.$position_seconds.value = clamped_seconds
        this.props.on_position_change?.(clamped_seconds)

        if(duration_seconds > 0 && clamped_seconds >= duration_seconds)
            this.stop_playback_at_end(duration_seconds)
    }

    /** Schedule animation frame position updates. */
    private schedule_position_updates(): void {
        if(!this.$is_playing.value)
            return

        this.animation_frame_id = requestAnimationFrame((): void => {
            this.update_position_from_audio_clock()
            this.schedule_position_updates()
        })
    }

    /** Restart playback to apply rate or seek changes. */
    private restart_playback_at_current_position(): void {
        const waveform:AudioWaveform|null = this.props.$audiodata.value
        if(waveform == null)
            return

        this.update_position_from_audio_clock()
        const position_seconds:number = this.$position_seconds.value
        const start_result:void|Error =
            this.start_playback_from(waveform, position_seconds)
        if(start_result instanceof Error)
            return
    }

    /** Stop playback when reaching the end. */
    private stop_playback_at_end(duration_seconds:number): void {
        this.stop_playback()
        this.$is_playing.value = false
        this.$position_seconds.value = duration_seconds
        this.props.on_position_change?.(duration_seconds)
    }

    private audio_context:AudioContext|null = null
    private source_node:AudioBufferSourceNode|null = null
    private gain_node:GainNode|null = null
    private playback_started_at:number|null = null
    private playback_start_seconds:number|null = null
    private animation_frame_id:number|null = null
}


/** Clamp finite value to inclusive bounds. */
export function clamp_audio_value(value:number, min:number, max:number): number {
    if(!Number.isFinite(value))
        return min
    return Math.max( Math.min(value, max), min )
}

/** Parse value of a slider <input> and clamp into bounds. */
export function parse_slider_number(
    raw_value:string,
    minimum:number,
    maximum:number,
): number|Error {
    const parsed_value:number = Number(raw_value)
    if(!Number.isFinite(parsed_value))
        return new Error('Invalid slider number')

    return clamp_audio_value(parsed_value, minimum, maximum)
}

/** Format seconds into mm:ss.mmm. */
export function format_playback_position(seconds:number): string|Error {
    if(!Number.isFinite(seconds) || seconds < 0)
        return new Error('Invalid playback position seconds')

    const minutes:number = Math.floor(seconds / 60)
    const remaining_seconds:number = Math.floor(seconds % 60)
    const milliseconds:number = Math.floor((seconds % 1) * 1000)

    const minute_text:string = String(minutes).padStart(2, '0')
    const second_text:string = String(remaining_seconds).padStart(2, '0')
    const millisecond_text:string = String(milliseconds).padStart(3, '0')

    return `${minute_text}:${second_text}.${millisecond_text}`
}

/** Build position output text for the control. */
export function get_position_status_text(
    position_seconds:number,
    duration_seconds:number,
): string {
    const clamped_position:number = 
        clamp_audio_value(position_seconds, 0, duration_seconds)

    const formatted_position:string|Error =
        format_playback_position(clamped_position)
    const formatted_duration:string|Error =
        format_playback_position(duration_seconds)

    if(formatted_position instanceof Error || formatted_duration instanceof Error)
        return '--:--.--- / --:--.---'

    return `${formatted_position} / ${formatted_duration}`
}

/** Compute playback position from audio clock values. */
export function compute_playback_position_seconds(
    playback_start_seconds:number,
    playback_started_at:number,
    current_time_seconds:number,
    speed:number,
): number|Error {
    if(!Number.isFinite(playback_start_seconds))
        return new Error('Invalid playback start seconds')
    if(!Number.isFinite(playback_started_at))
        return new Error('Invalid playback start time')
    if(!Number.isFinite(current_time_seconds))
        return new Error('Invalid current time')
    if(!Number.isFinite(speed) || speed <= 0)
        return new Error('Invalid playback speed')

    if(current_time_seconds < playback_started_at)
        return new Error('Current time is before start time')

    const elapsed_seconds:number = current_time_seconds - playback_started_at
    return playback_start_seconds + (elapsed_seconds * speed)
}

/** Compute the number of seconds for an audio waveform */
function get_duration_seconds(audio:AudioWaveform|null): number {
    if(audio == null)
        return 0

    const seconds:number = audio.data.length / audio.samplerate
    if(!Number.isFinite(seconds) || seconds <= 0)
        return 0
    return seconds
}

/** Create a safe AudioContext for playback. */
function create_audio_context(): AudioContext|Error {
    try {
        return new AudioContext()
    } catch (error:unknown) {
        return new Error(String(error))
    }
}

/** Build AudioBuffer from waveform data. */
function build_audio_buffer(
    audio_context:AudioContext,
    waveform:AudioWaveform,
): AudioBuffer|Error {
    const length:number = waveform.data.length
    if(length <= 0)
        return new Error('Empty audio data')

    const channels:number = 1
    try {
        const buffer:AudioBuffer = audio_context.createBuffer(
            channels,
            length,
            waveform.samplerate,
        )
        buffer.copyToChannel(waveform.data as Float32Array<ArrayBuffer>, 0)
        return buffer
    } catch (error:unknown) {
        return new Error(String(error))
    }
}

