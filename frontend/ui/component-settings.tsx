import { preact, Signal, JSX } from '../dep.ts'
import { HoverActionContainer } from "./hover-action-container.tsx"



type SettingsContainerProps = {
    /** The main content */
    children: preact.ComponentChildren;

    settings_entries: SettingsEntry[];

    extra_actions?: SettingsAction[];

    /** Callback when user clicked on the `Apply` button */
    on_apply?: () => void;
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
                    extra_actions    = {this.props.extra_actions}
                    on_close         = {this.close_settings}
                />
            :   null
            }

        </HoverActionContainer>
        </>
    }

    /** `true` when the settings overlay is shown */
    $settings_open: Signal<boolean> = new Signal(false)

    close_settings = (ok:boolean): void => {
        this.$settings_open.value = false
        if(ok)
            this.props.on_apply?.()
    }

    show_settings = () => {
        this.$settings_open.value = true
    }
}






type SettingsOverlayProps = {
    settings_entries: SettingsEntry[]

    extra_actions?: SettingsAction[];

    /** Callback when user clicks on `Apply` or `Cancel` */
    on_close: (ok:boolean) => void;
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

        const settingspanel_css: preact.CSSProperties = {
            display:       'flex',
            flexDirection: 'column',
            gap:           '10px',
            width:         '100%',
            maxWidth:      '500px',
            fontFamily:    'sans-serif',
            fontSize:      '12px',
            color:         '#20262d',
        }

        const actions_css: preact.CSSProperties = {
            display:        'flex',
            justifyContent: 'flex-end',
            gap:            '8px',
            marginTop:      '8px',
        }

        const extra_actions_css: preact.CSSProperties = {
            display:        'flex',
            justifyContent: 'flex-end',
            gap:            '8px',
            marginTop:      '8px',
        }

        const button_css: preact.CSSProperties = {
            border:       '1px solid #b9c5cf',
            borderRadius: '4px',
            background:   '#ffffff',
            color:        '#20262d',
            padding:      '4px 10px',
            fontSize:     '12px',
            cursor:       'pointer',
        }

        const apply_button_css: preact.CSSProperties = {
            ...button_css,
            background: '#e8f2fa',
        }

        const title_css: preact.CSSProperties = {
            fontWeight:    700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            fontSize:      '11px',
            color:         '#2f3f4f',
        }

        const entry_components: JSX.Element[] = []
        for(const [entry_index, entry] of this.props.settings_entries.entries()) {
            if(entry.type == 'boolean')
                entry_components.push( 
                    <BooleanSettingsEntryComponent
                        key       = {entry_index}
                        ref       = {this.entries_refs[entry_index]}
                        {...entry}
                    /> 
                )
            else if(entry.type == 'number')
                entry_components.push(
                    <NumberSettingsEntryComponent
                        key       = {entry_index}
                        ref       = {this.entries_refs[entry_index]}
                        {...entry}
                    />
                )
        }

        const extra_action_buttons: JSX.Element[] = []
        for(
            const [action_index, action]
            of (this.props.extra_actions ?? []).entries()
        ) {
            extra_action_buttons.push(
                <button
                    key     = {action_index}
                    type    = 'button'
                    style   = {button_css}
                    onClick = {action.on_click}
                >
                    {action.label}
                </button>
            )
        }

        return  <>
        <div style = {overlay_css}>
            <div style={settingspanel_css}>
                <div style={title_css}>
                    Settings
                </div>

                { entry_components }

                <div style={actions_css}>
                    <button
                        type    = 'button'
                        style   = {button_css}
                        onClick = {() => this.props.on_close(false)}
                    >
                        Cancel
                    </button>
                    <button
                        type    = 'button'
                        style   = {apply_button_css}
                        onClick = {this.on_apply}
                    >
                        Apply
                    </button>
                </div>

                {
                extra_action_buttons.length > 0
                ?   <div style={extra_actions_css}>
                        {extra_action_buttons}
                    </div>
                :   null
                }
            </div>
        </div>
        </>
    }


    entries_refs: preact.RefObject<SettingsEntryComponent>[] = 
        this.props.settings_entries.map( () => preact.createRef() )

    private on_apply = (): void => {
        for(const [entry_index, entry] of this.props.settings_entries.entries()) {
            const next_value: SettingsValue|undefined = 
                this.entries_refs[entry_index]?.current?.draft_value
            entry.$signal.value = next_value as never;
        }
        this.props.on_close(true)
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

export type SettingsAction = {
    label:    string;
    on_click: () => void;
}

export type SettingsEntry = BooleanSettingsEntry | NumberSettingsEntry;

type SettingsValue = SettingsEntry['$signal']['value']




type SettingsEntryComponent = NumberSettingsEntryComponent | BooleanSettingsEntryComponent




class BooleanSettingsEntryComponent extends preact.Component<BooleanSettingsEntry> {
    public draft_value: boolean = this.props.$signal.value;
    
    render(): JSX.Element {
        return <label style={settings_row_css}>
            <span>{this.props.label}</span>
            <input
                type     = 'checkbox'
                checked  = {this.draft_value}
                onChange = {
                    (event:preact.TargetedEvent<HTMLInputElement>) =>
                        this.draft_value = 
                            (event.target as HTMLInputElement).checked
                }
            />
        </label>
    }
}

class NumberSettingsEntryComponent extends preact.Component<NumberSettingsEntry>{
    public draft_value: number = this.props.$signal.value;

    render(): JSX.Element {
        const input_css: preact.CSSProperties = {
            width:        '90px',
            border:       '1px solid #b9c5cf',
            borderRadius: '4px',
            padding:      '2px 6px',
            fontSize:     '12px',
        }

        return <label style={settings_row_css}>
            <span>{this.props.label}</span>
            <input
                type    = 'number'
                step    = {this.props.step}
                value   = {this.draft_value}
                style   = {input_css}
                onChange = { 
                    (event:preact.TargetedEvent<HTMLInputElement>) =>
                        this.draft_value = 
                            Number((event.target as HTMLInputElement).value)
                 }
            />
        </label>
    }
} 




const settings_row_css: preact.CSSProperties = {
    display:             'grid',
    gridTemplateColumns: '1fr auto',
    alignItems:          'center',
    gap:                 '12px',
}
