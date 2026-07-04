import { preact, Signal, JSX } from '../dep.ts'
import { HoverActionContainer } from "./hover-action-container.tsx"



type SettingsContainerProps = {
    /** The main content */
    children: preact.ComponentChildren;

    settings_entries: SettingsEntry[];
}


/** Wrapper for a component with a settings overlay, activated via an action button */
export class SettingsContainer extends preact.Component<SettingsContainerProps> {
    render(): JSX.Element {
        return <>
        <HoverActionContainer
            label     = "Settings"
            on_action = {this.show_settings}
        >
            { this.props.children }

            {
            this.$settings_open.value
            ?   <SettingsOverlay 
                    settings_entries = {this.props.settings_entries}
                    on_close         = {this.close_settings}
                />
            :   null
            }

        </HoverActionContainer>
        </>
    }

    /** `true` when the settings overlay is shown */
    $settings_open: Signal<boolean> = new Signal(false)

    close_settings = (): void => {
        this.$settings_open.value = false
    }

    show_settings = () => {
        this.$settings_open.value = true
    }
}






type SettingsOverlayProps = {
    settings_entries: SettingsEntry[]

    /** Callback when user wants to close the settings overlay */
    on_close: () => void;
}

/** Overlay with widgets on top of a plot component */
export class SettingsOverlay extends preact.Component<SettingsOverlayProps> {
    render(): JSX.Element {
        const overlay_css: preact.CSSProperties = {
            position:        'absolute',
            top:             '0',
            left:            '0',
            width:           '100%',
            height:          '100%',
            background:      'rgba(245, 249, 252, 0.96)',
            border:          '1px solid rgba(0,0,0,0.12)',
            borderRadius:    '6px',
            boxSizing:       'border-box',
            padding:         '10px',
            overflowY:       'auto',
            zIndex:          8,
        }

        const close_css: preact.CSSProperties = {
            position:      'absolute',
            top:           '8px',
            right:         '8px',
            width:         '24px',
            height:        '24px',
            borderRadius:  '4px',
            border:        '1px solid rgba(0,0,0,0.18)',
            background:    '#ffffff',
            color:         '#2a2a2a',
            cursor:        'pointer',
            fontSize:      '16px',
            lineHeight:    '20px',
            padding:       0,
        }

        const settingspanel_css: preact.CSSProperties = {
            display:       'flex',
            flexDirection: 'column',
            gap:           '10px',
            paddingRight:  '28px',
            fontFamily:    'sans-serif',
            fontSize:      '12px',
            color:         '#20262d',
        }

        const title_css: preact.CSSProperties = {
            fontWeight:    700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            fontSize:      '11px',
            color:         '#2f3f4f',
        }

        const entry_components: JSX.Element[] = []
        for(const entry of this.props.settings_entries) {
            if(entry.type == 'boolean')
                entry_components.push( 
                    <BooleanSettingsEntryComponent {...entry} /> 
                )
            else if(entry.type == 'number')
                entry_components.push(
                    <NumberSettingsEntryComponent {...entry} />
                )
        }

        return  <>
        <div style = {overlay_css}>
            <button
                type    = 'button'
                style   = {close_css}
                onClick = {this.props.on_close}
                aria-label = 'Close settings'
            >
                ×
            </button>
            <div style={settingspanel_css}>
                <div style={title_css}>
                    Settings
                </div>

                { entry_components }
            </div>
        </div>
        </>
    }
}


type BooleanSettingsEntry = {
    type:    'boolean';
    label:   string;
    $signal: Signal<boolean>
}

type NumberSettingsEntry = {
    type:    'number';
    label:   string;
    step:    number;
    $signal: Signal<number>
}

export type SettingsEntry = BooleanSettingsEntry | NumberSettingsEntry;





function BooleanSettingsEntryComponent(props:BooleanSettingsEntry): JSX.Element {
    return <label style={settings_row_css}>
        <span>{props.label}</span>
        <input
            type     = 'checkbox'
            checked  = {props.$signal}
            onChange = {
                (event:preact.TargetedEvent<HTMLInputElement>) =>
                    props.$signal.value = (event.target as HTMLInputElement).checked
            }
        />
    </label>
}

function NumberSettingsEntryComponent(props:NumberSettingsEntry): JSX.Element {
    const input_css: preact.CSSProperties = {
        width:        '90px',
        border:       '1px solid #b9c5cf',
        borderRadius: '4px',
        padding:      '2px 6px',
        fontSize:     '12px',
    }

    return <label style={settings_row_css}>
        <span>{props.label}</span>
        <input
            type    = 'number'
            step    = {props.step}
            value   = {props.$signal}
            style   = {input_css}
            onChange = { 
                (event:preact.TargetedEvent<HTMLInputElement>) =>
                    props.$signal.value = 
                        Number( (event.target as HTMLInputElement).value )
             }
        />
    </label>
}

const settings_row_css: preact.CSSProperties = {
    display:             'grid',
    gridTemplateColumns: '1fr auto',
    alignItems:          'center',
    gap:                 '12px',
}


