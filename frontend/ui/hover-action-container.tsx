import { preact, Signal, JSX } from '../dep.ts'


type HoverActionContainerProps = {
    children:          preact.ComponentChildren
    label:             string
    on_action?:        () => void
    $action_visible?:  Readonly<Signal<boolean>>
    $action_disabled?: Readonly<Signal<boolean>>
    $force_visible?:   Readonly<Signal<boolean>>
}

/** Wrap content with a hover-revealed floating action button. */
export class HoverActionContainer extends preact.Component<HoverActionContainerProps> {

    render(): JSX.Element {
        const action_visible: boolean =
            this.props.$action_visible?.value ?? true
        const force_visible: boolean =
            this.props.$force_visible?.value ?? false
        const show_action: boolean =
            action_visible
            && (this.$hovered.value || force_visible /* || settings_open */)
        const action_disabled: boolean =
            this.props.$action_disabled?.value ?? false

        const button_style: preact.CSSProperties = {
            position:      'absolute',
            top:           '2px',
            left:          '2px',
            padding:       '6px 10px',
            borderRadius:  '6px',
            border:        '1px solid rgba(0,0,0,0.25)',
            background:    'rgba(255,255,255,0.95)',
            fontFamily:    'sans-serif',
            fontSize:      '12px',
            color:         '#1f1f1f',
            boxShadow:     '0 2px 8px rgba(0,0,0,0.12)',
            cursor:        action_disabled ? 'not-allowed' : 'pointer',
            opacity:       show_action ? 1 : 0,
            pointerEvents: show_action ? 'auto' : 'none',
            transition:    'opacity 120ms ease',
            zIndex:        5,
        }

        

        return <div
            style = {{ position: 'relative', width: '100%', height: '100%' }}
            onMouseEnter = {this.on_mouse_enter}
            onMouseLeave = {this.on_mouse_leave}
        >
            {this.props.children}
            <button
                type     = 'button'
                style    = {button_style}
                disabled = {action_disabled}
                onClick  = {this.on_action}
            >
                {this.props.label}
            </button>
        </div>
    }

    /** Flag indicating if the mouse is hovering above the child component 
     *  and thus the action button is shown. */
    $hovered: Signal<boolean> = new Signal(false)

    on_mouse_enter = (): void => {
        if(!this.$hovered.value)
            this.$hovered.value = true
    }

    on_mouse_leave = (): void => {
        if(this.$hovered.value)
            this.$hovered.value = false
    }

    on_action = (): void => {
        if(this.props.$action_disabled?.value)
            return

        this.props.on_action?.()
    }
}
