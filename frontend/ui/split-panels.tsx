import { preact, Signal, type JSX } from '../dep.ts'



type SplitPanelsProps = {
    items:              SplitPanelItem[]
    direction:          SplitDirection
    initial_ratios?:    number[]
    min_panel_size_px?: number
    handle_size_px?:    number
}

/** Render split panels with draggable resize handles. */
export class SplitPanels extends preact.Component<SplitPanelsProps> {
    static override defaultProps: Partial<SplitPanelsProps> = {
        min_panel_size_px: 160,
        handle_size_px: 8,
    }


    render(): JSX.Element {
        const ratios: number[] = normalize_ratios(this.$panel_ratios.value)

        const direction: SplitDirection = this.props.direction

        return <div
            ref = {this.container_ref}
            style = {{
                display: 'flex',
                flexDirection: direction == 'horizontal' ? 'row' : 'column',
                position: 'relative',
                width: '100%',
                height: '100%',
                minWidth: 0,
                minHeight: 0,
            }}
        >
            {this.render_items_with_handles(ratios)}
            {this.render_drag_indicator()}
        </div>
    }



    $panel_ratios: Signal<number[]> = new Signal(
        resolve_initial_ratios(this.props.items, this.props.initial_ratios)
    )

    container_ref:   preact.RefObject<HTMLDivElement> = preact.createRef()
    resize_observer: ResizeObserver | null = null

    override componentDidMount(): void {
        const container: HTMLDivElement | null = this.container_ref.current
        if(container != null) {
            this.set_container_size(container.clientWidth, container.clientHeight)
            this.resize_observer = new ResizeObserver(this.on_container_resize)
            this.resize_observer.observe(container)
        }
    }

    override componentDidUpdate(prev_props: Readonly<SplitPanelsProps>): void {
        const previous_keys: string[] =
            prev_props.items.map((item: SplitPanelItem) => item.key)
        const next_keys: string[] =
            this.props.items.map((item: SplitPanelItem) => item.key)
        if(arrays_equal(previous_keys, next_keys))
            return

        const reconciled: number[] = reconcile_panel_ratios_by_keys(
            previous_keys,
            next_keys,
            this.$panel_ratios.value,
        )
        this.$panel_ratios.value = reconciled
    }

    override componentWillUnmount(): void {
        this.resize_observer?.disconnect()
        this.resize_observer = null
        globalThis.removeEventListener('pointermove', this.on_pointer_move)
        globalThis.removeEventListener('pointerup', this.on_pointer_up)
    }

    private render_items_with_handles(ratios: number[]): JSX.Element[] {
        const output: JSX.Element[] = []
        const item_count: number = this.props.items.length

        for(let panel_index: number = 0; panel_index < item_count; panel_index++) {
            const item: SplitPanelItem = this.props.items[panel_index]!
            const ratio: number = ratios[panel_index] ?? 0
            output.push(
                <div
                    key = {`panel-${item.key}`}
                    style = {this.get_panel_style(ratio)}
                >
                    {item.element}
                </div>
            )

            if(panel_index < item_count - 1) {
                output.push(
                    <div
                        key = {`handle-${item.key}-${panel_index}`}
                        style = {this.get_handle_style()}
                        onPointerDown = {(event) =>
                            this.on_handle_pointerdown(event, panel_index)}
                    >
                        <div style = {this.get_handle_grip_style()} />
                    </div>
                )
            }
        }

        return output
    }

    private get_panel_style(ratio: number): preact.CSSProperties {
        return {
            flexGrow: Math.max(0, ratio),
            flexShrink: 1,
            flexBasis: 0,
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
        }
    }

    private get_handle_style(): preact.CSSProperties {
        const direction: SplitDirection = this.props.direction
        const handle_size: number = this.props.handle_size_px ?? 8

        return {
            flex: `0 0 ${handle_size}px`,
            minWidth: direction == 'horizontal' ? `${handle_size}px` : '100%',
            minHeight: direction == 'vertical' ? `${handle_size}px` : '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: direction == 'horizontal' ? 'col-resize' : 'row-resize',
            touchAction: 'none',
            userSelect: 'none',
        }
    }

    private get_handle_grip_style(): preact.CSSProperties {
        const direction: SplitDirection = this.props.direction
        if(direction == 'horizontal') {
            return {
                width: '2px',
                height: '100%',
                background: '#c5cbd2',
                borderRadius: '1px',
            }
        }

        return {
            width: '100%',
            height: '2px',
            background: '#c5cbd2',
            borderRadius: '1px',
        }
    }



    drag_state: DragState | null = null
    $drag_preview: Signal<DragPreview | null> = new Signal(null)

    private on_handle_pointerdown(event: PointerEvent, handle_index: number): void {
        event.preventDefault()

        const direction: SplitDirection = this.props.direction
        const start_client: number =
            direction == 'horizontal' ? event.clientX : event.clientY
        this.drag_state = {
            handle_index,
            start_client,
            start_ratios: this.$panel_ratios.value,
            preview_ratios: null,
        }

        globalThis.addEventListener('pointermove', this.on_pointer_move)
        globalThis.addEventListener('pointerup', this.on_pointer_up)
    }



    $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })

    private on_pointer_move = (event: PointerEvent): void => {
        if(this.drag_state == null)
            return

        const direction: SplitDirection = this.props.direction
        const next_client: number =
            direction == 'horizontal' ? event.clientX : event.clientY
        const delta: number = next_client - this.drag_state.start_client

        const container_main_size: number =
            direction == 'horizontal'
                ? this.$container_size.value.width
                : this.$container_size.value.height
        if(container_main_size <= 0)
            return

        const mins: number[] = this.props.items.map((item: SplitPanelItem) =>
            item.min_size_px ?? (this.props.min_panel_size_px ?? 160)
        )
        const next_ratios: number[] = apply_drag_to_panel_ratios(
            this.drag_state.start_ratios,
            this.drag_state.handle_index,
            delta,
            container_main_size,
            this.props.handle_size_px ?? 8,
            mins,
        )
        this.drag_state.preview_ratios = next_ratios
        this.$drag_preview.value = {
            handle_index: this.drag_state.handle_index,
            ratios: next_ratios,
        }
    }

    private on_pointer_up = (): void => {
        if(this.drag_state?.preview_ratios != null) {
            this.$panel_ratios.value = this.drag_state.preview_ratios
        }

        this.drag_state = null
        this.$drag_preview.value = null
        globalThis.removeEventListener('pointermove', this.on_pointer_move)
        globalThis.removeEventListener('pointerup', this.on_pointer_up)
    }

    private render_drag_indicator(): JSX.Element | null {
        const preview: DragPreview | null = this.$drag_preview.value
        if(preview == null)
            return null

        const direction: SplitDirection = this.props.direction
        const container_main_size: number =
            direction == 'horizontal'
                ? this.$container_size.value.width
                : this.$container_size.value.height
        const handle_size: number = this.props.handle_size_px ?? 8
        const position_px: number = get_handle_center_position_px(
            preview.ratios,
            preview.handle_index,
            container_main_size,
            handle_size,
        )

        if(!Number.isFinite(position_px))
            return null

        const css: preact.CSSProperties = {
            position:      'absolute',
            background:    '#2b6cb0',
            transform:     'translateX(-1px)',
            pointerEvents: 'none',
            zIndex:         5,
        }
        if(direction == 'horizontal') {
            return <div style = {{
                ...css,
                left:   `${position_px}px`,
                top:    0,
                bottom: 0,
                width:  '2px',
            }} />
        }

        return <div style = {{
            ...css,
            left:   0,
            right:  0,
            top:    `${position_px}px`,
            height: '2px',
        }} />
    }

    private on_container_resize = (entries: ResizeObserverEntry[]): void => {
        const rect: DOMRectReadOnly | undefined = entries[0]?.contentRect
        if(rect == undefined)
            return
        this.set_container_size(rect.width, rect.height)
    }

    private set_container_size(width: number, height: number): void {
        this.$container_size.value = { width, height }
    }
}


export type SplitPanelItem = {
    key:          string
    element:      JSX.Element
    min_size_px?: number
}

type SplitDirection = 'horizontal'|'vertical'


type Size = {
    width: number
    height: number
}

type DragState = {
    handle_index: number
    start_client: number
    start_ratios: number[]
    preview_ratios: number[] | null
}

type DragPreview = {
    handle_index: number
    ratios: number[]
}




/** Return initial ratios from optional values or evenly split. */
export function resolve_initial_ratios(
    items:           SplitPanelItem[],
    initial_ratios?: number[],
): number[] {
    if(items.length == 0)
        return []

    if(initial_ratios != undefined
    && initial_ratios.length == items.length) {
        return normalize_ratios(initial_ratios)
    }

    return create_equal_ratios(items.length)
}

/** Normalize ratios to sum to one and stay non-negative. */
export function normalize_ratios(values: readonly number[]): number[] {
    if(values.length == 0)
        return []

    const cleaned: number[] = values.map((value: number) =>
        Number.isFinite(value) ? Math.max(0, value) : 0
    )
    const total: number = cleaned.reduce((sum: number, value: number) =>
        sum + value, 0
    )
    if(total <= 0)
        return create_equal_ratios(values.length)

    return cleaned.map((value: number) => value / total)
}

/** Keep known ratios by key and split new keys from leftover ratio. */
export function reconcile_panel_ratios_by_keys(
    previous_keys:   readonly string[],
    next_keys:       readonly string[],
    previous_ratios: readonly number[],
): number[] {
    if(next_keys.length == 0)
        return []

    const normalized_previous: number[] = normalize_ratios(previous_ratios)
    const ratio_by_key: Record<string, number> = {}
    for(const [index, key] of previous_keys.entries())
        ratio_by_key[key] = normalized_previous[index] ?? 0

    const known_keys: string[] =
        next_keys.filter((key: string) => (key in ratio_by_key))
    const next_known_total:number = known_keys.length / next_keys.length

    const missing_ratio: number = 1 / next_keys.length

    const next_ratios: number[] = next_keys.map((key: string) =>
        //(ratio_by_key[key] ?? 0 * next_known_total) || missing_ratio
        (key in ratio_by_key) 
        ? ratio_by_key[key]! * next_known_total 
        : missing_ratio
    )

    return normalize_ratios(next_ratios)
}


/** Resize two adjacent panels while preserving all others. */
export function apply_drag_to_panel_ratios(
    ratios:                 readonly number[],
    handle_index:           number,
    delta_px:               number,
    container_main_size_px: number,
    handle_size_px:         number,
    min_panel_sizes_px:     readonly number[],
): number[] {
    if(ratios.length < 2)
        return normalize_ratios(ratios)
    if(handle_index < 0 || handle_index + 1 >= ratios.length)
        return normalize_ratios(ratios)

    const normalized: number[] = normalize_ratios(ratios)
    const available_size_px: number =
        container_main_size_px - handle_size_px * (normalized.length - 1)
    if(available_size_px <= 0)
        return normalized

    const panel_sizes_px: number[] = normalized.map((ratio: number) =>
        ratio * available_size_px
    )

    const left_size: number = panel_sizes_px[handle_index] ?? 0
    const right_size: number = panel_sizes_px[handle_index + 1] ?? 0
    const pair_size: number = left_size + right_size

    const min_left: number = Math.max(0, min_panel_sizes_px[handle_index] ?? 0)
    const min_right: number = 
        Math.max(0, min_panel_sizes_px[handle_index + 1] ?? 0)

    const max_left: number = Math.max(0, pair_size - min_right)
    const effective_min_left: number = Math.min(min_left, max_left)
    const next_left: number = clamp(
        left_size + delta_px,
        effective_min_left,
        max_left,
    )
    const next_right: number = Math.max(0, pair_size - next_left)

    panel_sizes_px[handle_index] = next_left
    panel_sizes_px[handle_index + 1] = next_right

    const next_ratios: number[] = panel_sizes_px.map((size: number) =>
        size / available_size_px
    )
    return normalize_ratios(next_ratios)
}


function create_equal_ratios(count: number): number[] {
    if(count <= 0)
        return []
    const value: number = 1 / count
    return Array(count).fill(value)
}

function arrays_equal(a: readonly string[], b: readonly string[]): boolean {
    if(a.length != b.length)
        return false

    for(let index: number = 0; index < a.length; index++) {
        if(a[index] != b[index])
            return false
    }

    return true
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

function get_handle_center_position_px(
    ratios:                 readonly number[],
    handle_index:           number,
    container_main_size_px: number,
    handle_size_px:         number,
): number {
    if(ratios.length < 2)
        return Number.NaN
    if(handle_index < 0 || handle_index + 1 >= ratios.length)
        return Number.NaN

    const normalized: number[] = normalize_ratios(ratios)
    const available_size_px: number =
        container_main_size_px - handle_size_px * (normalized.length - 1)
    if(available_size_px <= 0)
        return Number.NaN

    let panel_sum_px: number = 0
    for(let index: number = 0; index <= handle_index; index++) {
        panel_sum_px += (normalized[index] ?? 0) * available_size_px
    }

    const preceding_handles_px: number = handle_index * handle_size_px
    return panel_sum_px + preceding_handles_px + (handle_size_px / 2)
}
