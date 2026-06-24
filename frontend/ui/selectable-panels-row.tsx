import { preact, Signal, signals, type JSX } from '../dep.ts'


/** Describe a selectable panel item. */
export type PanelItem = {
    key: string
    label: string
    element: JSX.Element
}

/** Store container size for responsive layout. */
type Size = {
    width: number
    height: number
}

type SelectablePanelsRowProps = {
    items: PanelItem[]
    bottom_left_element?: JSX.Element
    initial_preference?: string[]
}

/** Render a responsive row with selectable panels. */
export class SelectablePanelsRow extends preact.Component<SelectablePanelsRowProps> {

    render(): JSX.Element {

        return <div
            ref={this.container_ref}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
            }}
        >
            <div style={{
                display: 'flex',
                gap: '8px',
                padding: '8px',
                height: '100%',
                minHeight: 0,
            }}>
                { this.props.items.map((item:PanelItem) => (
                    <div
                        key   = {item.key}
                        style = {{
                            flex: '1 1 0%',
                            minWidth: 0,
                            height: '100%',
                            display: this.is_visible(item.key)? null : 'none',
                        }}
                    >
                        {item.element}
                    </div>
                )) }
            </div>
            <div style={{
                display:   'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap:       '8px',
                padding:   '6px 8px',
                borderTop: '1px solid #d7d7d7',
                fontSize:  '12px',
                color:     '#4b4b4b',
            }}>
                <div>
                    {this.props.bottom_left_element}
                </div>
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                }}>
                    { this.props.items.map((item:PanelItem) => (
                        <button
                            key   = {item.key}
                            style = {this.get_button_style(item.key)}
                            type  = 'button'
                            onClick = {() => this.select_panel(item.key)}
                            aria-pressed = {this.is_visible(item.key)}
                        >
                            {item.label}
                        </button>
                    )) }
                </div>
            </div>
        </div>
    }

    /** The panels that the user prefers to be shown. Most important ones first.
     *  Updated on button click */
    $item_preference: Signal<string[]> = 
        new Signal(
            get_initial_preference(this.props.items, this.props.initial_preference)
        )

    /** The currently selected panels, i.e. preferred, limited by component width 
     *  and in a given order  */
    $selected_items: Readonly<Signal<PanelItem[]>> = signals.computed( () => {
        const max_visible: number = 
            get_max_visible_panels(this.$container_size.value.width)
        const order: string[] = this.props.items.map( item => item.key )
        const preference: string[] = this.$item_preference.value
        const selected_item_keys:string[] = 
            select_items_by_preference(order, preference, max_visible)
        
        const itemkey_to_item_map: Record<string, PanelItem> = 
            Object.fromEntries(this.props.items.map( item => [item.key, item] ))
        
        return selected_item_keys
                .map( key => itemkey_to_item_map[key]! )
                .filter(Boolean)
    } )

    /** Size of the top `<div>`, updated via a resize observer */
    $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })


    override componentDidMount(): void {
        this.resize_observer = new ResizeObserver((entries:ResizeObserverEntry[]) => {
            const rect:DOMRectReadOnly|undefined = entries[0]?.contentRect
            if(rect == undefined)
                return

            this.set_container_size(rect.width, rect.height)
        })

        if(this.container_ref.current != null)
            this.resize_observer.observe(this.container_ref.current)
    }

    override componentWillUnmount(): void {
        this.resize_observer?.disconnect()
    }

    /** Promote a panel */
    select_panel(key:string): void {
        // do nothing if already selected
        if(this.is_visible(key))
            return;

        this.$item_preference.value = 
            set_new_preference(this.$item_preference.value, key)
    }

    /** Check if a panel is visible. */
    is_visible(key:string): boolean {
        return this.$selected_items.value.map( item => item.key ).includes(key)
    }

    /** Build inline button CSS styles. */
    get_button_style(key:string): preact.CSSProperties {
        const selected:boolean = this.is_visible(key)
        return get_selectable_button_style(selected)
    }

    /** Store container size and enforce visibility. */
    set_container_size(width:number, height:number): void {
        this.$container_size.value = { width, height }
    }

    container_ref: preact.RefObject<HTMLDivElement> = preact.createRef()
    resize_observer: ResizeObserver|undefined
}

/** Select panel count based on width. */
function get_max_visible_panels(width:number): number {
    if(width >= 1200)
        return 3
    return 2
}



/** Return up to `maximum` items of `preferred` in the given order  */
export function select_items_by_preference(
    ordered:   readonly string[], 
    preferred: readonly string[], 
    maximum:   number
): string[] {
    const selected = preferred.slice(0, maximum)
    const selected_and_ordered:string[] = 
        ordered.filter(item => selected.includes(item));
    return selected_and_ordered
}


/** Move an item to the start of a list */
export function set_new_preference(items:readonly string[], new_item:string): string[] {
    const result:string[] = [...items]
    const index:number = result.indexOf(new_item);
    if(index !== -1)
        result.splice(index, 1);

    return [new_item, ...result]
}

/** Normalize initial preference to existing item keys. */
function get_initial_preference(
    items: PanelItem[],
    initial_preference: string[]|undefined,
): string[] {
    const ordered_keys: string[] = items.map(item => item.key)
    if(initial_preference == null)
        return ordered_keys

    const filtered: string[] = initial_preference
        .filter(key => ordered_keys.includes(key))

    const missing: string[] = ordered_keys
        .filter(key => !filtered.includes(key))

    return [...filtered, ...missing]
}

/** Return shared style for panel-like buttons. */
export function get_selectable_button_style(
    selected:boolean,
): preact.CSSProperties {
    return {
        padding: '4px 8px',
        border: '1px solid #bdbdbd',
        borderRadius: '4px',
        cursor: selected ? null : 'pointer',
        backgroundColor: selected ? '#2e4964' : '#ffffff',
        color: selected ? '#ffffff' : '#2e2e2e',
    }
}
