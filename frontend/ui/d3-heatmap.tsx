import { preact, Signal, signals, JSX } from "../dep.ts"
import { strftime_ISO8601_datetime } from "../lib/util.ts";

import * as d3 from "d3";
import {
    HorizontalMarkerLayer,
    VerticalMarkerLayer,
} from './d3-heatmap-markers.tsx'
import { Axes } from "./d3-heatmap-axes.tsx";
import { 
    PlotTitleLabel, 
    PlotXAxisLabel, 
    PlotYAxisLabel 
} from "./d3-plot-labels.tsx"




export type DataItem = {
    x:     number,
    y:     number,
    color: number|RGB,
}

const OFFSCREEN_CANVAS_MAX_SIDE:number = 65535

/** Values returned to the external `on_hover()` callback */
export type HoverCallbackPosition = Pick<HoverPosition, 'item_index' | 'x' | 'y'>

export type OnClickItem = {
    /** Which data item was clicked on */
    item_index: number, 
    /** Whether or not the SHIFT key was pressed */
    shiftkey:   boolean,
    /** Whether or not the CTRL key was pressed */
    ctrlkey:    boolean,
}


export class D3Heatmap extends preact.Component<{
    $data:  Readonly<Signal<DataItem[]>>,
    $x_axis:Readonly<Signal<number[]>>,
    $y_axis:Readonly<Signal<string[]>>,

    /** Optional values for y axis ticks */
    $y_axis_tick_values?: Readonly<Signal<number[]>>


    /** Optional positions along the x axis to mark with a vertical line */
    $x_axis_markers?: Readonly<Signal<number[]>>

    /** Optional row indices to mark with a horizontal marker */
    $y_axis_markers?: Readonly<Signal<number[]>>

    /** Optional SVG elements on top of the heatmap (hidden when out of bounds) */
    $heatmap_overlays?: Readonly<Signal<JSX.Element[]>>

    /** Called when user clicks on a valid item */
    on_click: (selected:OnClickItem) => void,

    /** Called when user hovers on a valid item, null otherwise */
    on_hover?: (selected:HoverCallbackPosition|null) => void,


    $title?:       Readonly<Signal<string>>,
    x_axis_label?: string,
    y_axis_label?: string,
    x_axis_label_formatter?: (value:number) => string,
    y_axis_label_formatter?: (index:number, y_axis:string[]) => string,

    enable_zoom?:  boolean,
    enable_hover?: boolean,

    /** Downsampling method if height or width exceeds offscreencanvas limits.
     *  Default: `nearest` */
    downsample?: 'nearest'|'maxpool',

    colormap?: 'viridis'|'magma',
}> {
    private static next_clip_id:number = 0
    private clip_path_id:string = `heatmap-clip-${D3Heatmap.next_clip_id++}`


    container_ref: preact.RefObject<HTMLDivElement> = preact.createRef();
    svg_ref:     preact.RefObject<SVGSVGElement> = preact.createRef();
    root_ref:    preact.RefObject<SVGGElement> = preact.createRef();
    xaxis_ref:   preact.RefObject<SVGGElement> = preact.createRef();
    yaxis_ref:   preact.RefObject<SVGGElement> = preact.createRef();
    svgimage_ref:  preact.RefObject<SVGImageElement> = preact.createRef();
    resize_observer: ResizeObserver|null = null

    private margin: PlotMargin = { top: 24, right: 12, bottom: 40, left: 60 }
    private $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })
    private $hover_position: Signal<HoverPosition|null> = new Signal(null)
    private heatmap_image_url:string|null = null

    private $dimensions:Readonly<Signal<SVGPlotDimensions>> = signals.computed(() =>
        this.#get_dimensions()
    )
    private $svg_viewbox:Readonly<Signal<string>> = signals.computed(() => {
        const dimensions:SVGPlotDimensions = this.$dimensions.value
        return `0 0 ${dimensions.svg_width} ${dimensions.svg_height}`
    })
    private $plot_width:Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_width
    )
    private $plot_height:Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_height
    )


    render(): JSX.Element {
        return <div
            class = "d3-container"
            style = {{ width: '100%', height: '100%' }}
            ref   = {this.container_ref}
        >
                <svg 
                    width   = "100%"
                    height  = "100%"
                    viewBox = {this.$svg_viewbox}
                    ref     = {this.svg_ref} 
                >
                <defs>
                    {/* mask to make sure the image stays withing plot boundaries */}
                    <clipPath id={this.clip_path_id}>
                        <rect
                            x = "0"
                            y = "0"
                            width = {this.$plot_width}
                            height = {this.$plot_height}
                        />
                    </clipPath>
                </defs>

                <g 
                    ref = {this.root_ref}
                    transform = {`translate(${this.margin.left},${this.margin.top})`} 
                >
                    
                    <g clip-path={`url(#${this.clip_path_id})`}>
                        {/* with pointer events */}
                        <g transform = {this.$transform_str}>
                            <image 
                                x      = "0" 
                                y      = "0" 
                                width  = {this.$plot_width} 
                                height = {this.$plot_height} 
                                image-rendering = 'pixelated'
                                preserveAspectRatio = "none"
                                onClick = {this.#svgimage_onclick}
                                onMouseMove = {this.#svgimage_onmousemove}
                                onMouseLeave = {this.#svgimage_onmouseleave}
                                href = {this.$svgimage_href}
                                ref  = {this.svgimage_ref} 
                            />
                        </g>

                        {/* without pointer events */}
                        <g 
                            transform = {this.$transform_str}
                            style = {{ pointerEvents: 'none' }}
                        >
                            <HorizontalMarkerLayer 
                                $y_values    = {this.props.$y_axis_markers}
                                $plot_width  = {this.$plot_width}
                                $plot_height = {this.$plot_height}
                                $rows        = {this.$n_rows}
                            />

                            <VerticalMarkerLayer 
                                $x_values    = {this.props.$x_axis_markers}
                                $x_axis      = {this.props.$x_axis}
                                $plot_width  = {this.$plot_width}
                                $plot_height = {this.$plot_height}
                                $cols        = {this.$n_cols}
                            />

                            {this.#is_hover_enabled()
                                ? <HoverMarker 
                                    $position   = {this.$hover_position} 
                                    $dataitems  = {this.props.$data}
                                    $dimensions = {this.$dimensions}
                                    $rowscols   = {this.$rowscols}
                                />
                                : null
                            }

                            { this.props.$heatmap_overlays }
                        </g>
                    </g>


                    <Axes 
                        $dimensions     = {this.$dimensions}
                        $rowscols       = {this.$rowscols}
                        $x_axis         = {this.props.$x_axis}
                        $y_axis         = {this.props.$y_axis}
                        $y_axis_tick_values = {this.props.$y_axis_tick_values}
                        $zoom_transform = {this.$zoom_transform}
                        x_axis_label_formatter = {this.props.x_axis_label_formatter}
                        y_axis_label_formatter = {this.props.y_axis_label_formatter}
                    />
                    <PlotTitleLabel 
                        $plot_width = {this.$plot_width} 
                        $title      = {this.props.$title} 
                    />
                    <PlotXAxisLabel 
                        text         = {this.props.x_axis_label}
                        $plot_height = {this.$plot_height} 
                        $plot_width  = {this.$plot_width}
                    />
                    <PlotYAxisLabel
                        text         = {this.props.y_axis_label}
                        $plot_height = {this.$plot_height}
                    />
                    {this.#is_hover_enabled()
                        ? <HoverOverlay $position = {this.$hover_position} />
                        : null
                    }
                </g>
            </svg>
        </div>
    }


    /** The current number of rows and columns. Cached here to avoid recomputation */
    private $rowscols:Signal<RowsCols|null> = new Signal(null)

    /** Update $rowscols when $ data changes. */
    #_ = this.props.$data.subscribe( () => {
        this.$rowscols.value = this.#get_rows_cols()
    } )

    /** Number of rows in the current data */
    private $n_rows:Readonly<Signal<number>> = signals.computed(() => {
        const colsrows:RowsCols|null = this.$rowscols.value
        if(colsrows == null)
            return 0
        return colsrows.rows
    })

    /** Number of columns in the current data */
    private $n_cols:Readonly<Signal<number>> = signals.computed(() => {
        const colsrows:RowsCols|null = this.$rowscols.value
        if(colsrows == null)
            return 0
        return colsrows.cols
    })


    private $coordinates_to_item_index:Readonly<Signal<Map<string, number>>> = 
        signals.computed(() =>
            create_item_index_by_coord(this.props.$data.value)
        )


    /** The currently active D3 zoom/translation state */
    private $zoom_transform:Signal<d3.ZoomTransform> = new Signal(
        new d3.ZoomTransform( /*k = */ 1, /*x = */  0, /*y = */  0 )
    )

    override componentDidMount(): void {
        if(this.#is_zoom_enabled()) {
            d3.select(this.svg_ref.current!)
                .call(this.zoom)
                // no zoom on doubleclick
                .on('dblclick.zoom', null)
        }

        const container:HTMLDivElement|null = this.container_ref.current
        if(container != null) {
            this.#update_container_size(container.clientWidth, container.clientHeight)
            this.resize_observer = new ResizeObserver(this.#on_container_resize)
            this.resize_observer.observe(container)
        }
    }

    override componentWillUnmount(): void {
        this.resize_observer?.disconnect()
        this.resize_observer = null
        if(this.heatmap_image_url != null)
            URL.revokeObjectURL(this.heatmap_image_url)
        this.heatmap_image_url = null
    }


    /** D3 ZoomTransform converted to a CSS transform string */
    private $transform_str:Readonly<Signal<string>> = signals.computed( () => {
        const t:d3.ZoomTransform = this.$zoom_transform.value
        const colsrows:RowsCols|null = this.$rowscols.value
        const dimensions:SVGPlotDimensions = this.$dimensions.value

        const { k_x, k_y } = compute_zoom_scales({
            transform: t,
            rows_cols: colsrows,
            dimensions,
        })

        const tx:number = t.x ?? 0
        const ty:number = t.y ?? 0
        const transform_str:string =
            `translate(${tx},${ty}) scale(${k_x},${k_y})`
        return transform_str
    })


    /** Compute the current number of rows and columns from the data input */
    #get_rows_cols(): RowsCols|null {
        return get_rows_cols(this.props.$data.value)
    }


    $svgimage_href: Signal<string|undefined> = new Signal(undefined)

    /** Render the current data input onto the <image> element. */
    update_heatmap = async () => {
        // NOTE: $data.value is up here to make sure its subscribed
        const data: DataItem[] = this.props.$data.value
        const rowscols: RowsCols|null = this.$rowscols.value
        if(rowscols == null)
            return

        const pixels:HeatmapRenderedPixels = build_heatmap_render_pixels({
            data,
            data_size:  {width: rowscols.cols, height: rowscols.rows},
            colormap:   this.props.colormap ?? 'viridis',
            downsample: this.props.downsample,
        })

        const canvas = new OffscreenCanvas(pixels.width, pixels.height)
        const ctx:OffscreenRenderingContext = canvas.getContext('2d')!;
        const imdata:ImageData = ctx.createImageData(
            pixels.width,
            pixels.height,
        )
        imdata.data.set(pixels.pixels)
        ctx.putImageData(imdata, 0, 0)


        const blob = await canvas.convertToBlob({ type: 'image/png' })
        const f = new File([blob], 'file.png', { type: blob.type })
        
        if(this.heatmap_image_url != null)
            URL.revokeObjectURL(this.heatmap_image_url)
        this.heatmap_image_url = URL.createObjectURL(f)
        // svgimage.href.baseVal = this.heatmap_image_url
        this.$svgimage_href.value = this.heatmap_image_url
    }
    #_1 = signals.effect( () => { this.update_heatmap() } )


    zoom: d3.ZoomBehavior<SVGSVGElement, unknown> = 
        d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 125])
        .on('zoom', (e) => { this.$zoom_transform.value = e.transform })
    
    /** Update the zoom extent when number of rows and columns changes */
    #_3 = this.$rowscols.subscribe( () => {
        const rows_cols:RowsCols|null = this.$rowscols.value
        if(rows_cols == null)
            return;
        const { cols, rows } = rows_cols

        const dimensions:SVGPlotDimensions = this.#get_dimensions()

        const target_maximum_pixel_size = 25;
        const maximum_zoom_x:number = 
            cols * target_maximum_pixel_size / dimensions.plot_width
        const maximum_zoom_y:number = 
            rows * target_maximum_pixel_size / dimensions.plot_height
        const maximum_zoom:number = Math.max(maximum_zoom_x, maximum_zoom_y)

        this.zoom.scaleExtent([1, maximum_zoom])
    } )

    
    #svgimage_onclick:preact.MouseEventHandler<SVGImageElement> = (event) => {
        const [mx, my] = d3.pointer(event, this.svgimage_ref.current);
        const dimensions:SVGPlotDimensions = this.#get_dimensions()
        const w:number = dimensions.plot_width
        const h:number = dimensions.plot_height
        const rows_cols:RowsCols|null = this.$rowscols.value
        if(rows_cols == null)
            return
        const { cols, rows } = rows_cols

        const imx:number = plot_x_to_col(mx, w, cols)
        const imy:number = plot_y_to_row(my, h, rows)

        const item_index:number|null = get_item_index_at(
            this.$coordinates_to_item_index.value,
            imx,
            imy,
        )
        if(item_index != null) {
            console.log(`Clicked on data item ${item_index} at ${[imx, imy]}`)
            this.props.on_click({
                item_index, 
                shiftkey: event.shiftKey, 
                ctrlkey:  event.ctrlKey,
            })
            return
        }
        console.log(`No data item at ${[imx, imy]}`)
    }

    #svgimage_onmousemove:preact.MouseEventHandler<SVGImageElement> = (event) => {
        if(!this.#is_hover_enabled())
            return
        const [mx, my] = d3.pointer(event, this.svgimage_ref.current)
        const [root_x, root_y] = d3.pointer(event, this.root_ref.current)
        const position:HoverPosition|null = 
            this.#hover_position_from_mouse(mx, my, root_x, root_y)
        this.$hover_position.value = position
        
        this.props.on_hover?.(
            position
            ? {item_index: position.item_index, x:position.x, y:position.y} 
            : null
        )
    }

    #svgimage_onmouseleave:preact.MouseEventHandler<SVGImageElement> = () => {
        if(!this.#is_hover_enabled())
            return
        this.$hover_position.value = null
        this.props.on_hover?.(null)
    }

    #is_zoom_enabled(): boolean {
        return this.props.enable_zoom != false
    }

    #is_hover_enabled(): boolean {
        return this.props.enable_hover != false
    }


    /** Compute svg and plot dimensions from container size */
    #get_dimensions(): SVGPlotDimensions {
        return get_dimensions(this.$container_size.value, this.margin)
    }

    /** Update container dimensions when parent size changes */
    #update_container_size(width:number, height:number): void {
        const next_width:number = Math.max(Math.floor(width), 0)
        const next_height:number = Math.max(Math.floor(height), 0)
        const current:Size = this.$container_size.value
        if(current.width == next_width && current.height == next_height)
            return

        this.$container_size.value = {
            width: next_width,
            height: next_height,
        }
    }

    /** Called when the top <div> changes size */
    #on_container_resize = (entries:ResizeObserverEntry[]) => {
        const first:ResizeObserverEntry|undefined = entries[0]
        if(first == undefined)
            return

        this.#update_container_size(
            first.contentRect.width, 
            first.contentRect.height
        )
    }

    /** Map current mouse position to overlay values */
    #hover_position_from_mouse(
        mx:number, 
        my:number, 
        root_x:number, 
        root_y:number
    ): HoverPosition|null {
        return compute_hover_position_from_mouse({
            mx,
            my,
            root_x,
            root_y,
            x_axis: this.props.$x_axis.value,
            y_axis: this.props.$y_axis.value,
            rows_cols: this.$rowscols.value,
            dimensions: this.#get_dimensions(),
            item_index_by_coord: this.$coordinates_to_item_index.value,
        })
    }
}


/** Show hover details in a fixed-size tooltip box */
function HoverOverlay(props: {
    $position: Readonly<Signal<HoverPosition | null>>,
}): JSX.Element | null {
    const hover:HoverPosition|null = props.$position.value
    if(hover == null)
        return null

    return <g
        transform = {`translate(${hover.overlay_x},${hover.overlay_y})`}
        style = {{ pointerEvents: 'none', fontFamily:'sans' }}
    >
        <rect
            x = '0'
            y = '0'
            width = '200'
            height = '56'
            fill = '#000000'
            fill-opacity = '0.75'
            stroke = '#ffffff'
            stroke-opacity = '0.4'
        />
        <text x = '8' y = '17' fill = '#ffffff' font-size = '11'>
            {`${hover.x_label}`}
        </text>
        <text x = '8' y = '33' fill = '#ffffff' font-size = '11'>
            {`${hover.y_label}`}
        </text>
        <text x = '8' y = '49' fill = '#ffffff' font-size = '11'>
            {hover.data_label}
        </text>
    </g>
}



/** Overlay of the size of one heatmap pixel at the current position of the cursor */
function HoverMarker(props:{
    $position:   Readonly<Signal<HoverPosition|null>>,
    $dimensions: Readonly<Signal<SVGPlotDimensions>>,
    $dataitems:  Readonly<Signal<DataItem[]>>,
    $rowscols:   Readonly<Signal<RowsCols|null>>
}): JSX.Element|null {

    // NOTE: subscribing to signals here before early exit returns
    const {plot_width, plot_height} = props.$dimensions.value;
    const item_index:number|null = props.$position.value?.item_index ?? null
    const data_items:DataItem[]  = props.$dataitems.value;
    const colsrows:RowsCols|null = props.$rowscols.value

    if(item_index == null || colsrows == null)
        return null;

    const item:DataItem|undefined = data_items[item_index];
    if(item == undefined)
        return null;

    const item_width:number  = plot_width / colsrows.cols;
    const item_height:number = plot_height / colsrows.rows;
    
    const x:number = item_width * item.x;
    const y:number = item_height * (colsrows.rows - 1 - item.y)

    return <rect
        x            = {`${x}`}
        y            = {`${y}`}
        width        = {`${item_width}`}
        height       = {`${item_height}`}
        fill         = "#f0f0f0"
        fill-opacity = "0.3"
        stroke       = "none"
        pointer-events = "none"
    />
}



export type SVGPlotDimensions = {
    svg_width: number,
    svg_height: number,
    plot_width: number,
    plot_height: number,
}

type Size = {
    width: number,
    height: number,
}

type Point = {
    x: number,
    y: number,
}

type PlotMargin = {
    top: number,
    right: number,
    bottom: number,
    left: number,
}

export type RowsCols = {
    cols: number,
    rows: number,
}

type HoverPosition = {
    overlay_x: number,
    overlay_y: number,
    x_label: string,
    y_label: string,
    data_label: string,
    item_index: number | null,
    x: number,
    y: number,
}

type ZoomScales = {
    k_x: number,
    k_y: number,
}

/** Compute svg and plot dimensions from measured size */
export function get_dimensions(measured: Size, margin: PlotMargin): SVGPlotDimensions {
    const svg_width: number = measured.width
    const svg_height: number = measured.height
    const plot_width: number = Math.max(svg_width - margin.left - margin.right, 1)
    const plot_height: number = Math.max(svg_height - margin.top - margin.bottom, 1)

    return { svg_width, svg_height, plot_width, plot_height }
}

/** Compute rows/cols from item coordinates */
export function get_rows_cols(data: DataItem[]): RowsCols | null {
    if(data.length == 0)
        return null

    const all_x: number[] = 
        data.map((item: DataItem) => item.x).sort((a: number, b: number) => a - b)
    const all_y: number[] = 
        data.map((item: DataItem) => item.y).sort((a: number, b: number) => a - b)

    const ncols: number = all_x[all_x.length - 1]! - all_x[0]! + 1
    const nrows: number = all_y[all_y.length - 1]! - all_y[0]! + 1

    return {
        cols: ncols,
        rows: nrows,
    }
}

/** Compute non-uniform zoom scales for square-ish pixels */
export function compute_zoom_scales(props: {
    transform: d3.ZoomTransform,
    rows_cols: RowsCols | null,
    dimensions: SVGPlotDimensions,
}): ZoomScales {
    const base_k: number = props.transform.k ?? 1

    if(props.rows_cols == null)
        return {k_x: base_k, k_y: base_k }

    const cols:number = Math.max(props.rows_cols.cols, 1)
    const rows:number = Math.max(props.rows_cols.rows, 1)

    // NOTE: this is unaffected by zoom
    const cell_width:number = props.dimensions.plot_width / cols
    const cell_height:number = props.dimensions.plot_height / rows
    const base_aspect:number =
        (cell_height <= 0) ? 1 : cell_width / cell_height

    if(base_aspect >= 1)
        return {k_x: base_k, k_y: base_k }

    // keep the y axis fixed at 1.0 until the pixels are square
    const threshold:number = 1 / base_aspect
    const k_y:number = (base_k <= threshold) ? 1.0 : base_k * base_aspect
    return { k_x:base_k, k_y }
}

/** Convert mouse coordinate to column index */
export function mouse_to_col(mx: number, plot_width: number, cols: number): number {
    const clamped_x: number = Math.max(0, Math.min(mx, plot_width))
    return Math.min(Math.floor((clamped_x / plot_width) * cols), cols - 1)
}

/** Convert mouse coordinate to row index */
export function mouse_to_row(my: number, plot_height: number, rows: number): number {
    const clamped_y: number = Math.max(0, Math.min(my, plot_height))
    const row_from_top:number =
        Math.min(Math.floor((clamped_y / plot_height) * rows), rows - 1)
    return rows - 1 - row_from_top
}

/** Convert plot coordinate to column index */
export function plot_x_to_col(mx: number, plot_width: number, cols: number): number {
    return Math.floor((mx / plot_width) * cols)
}

/** Convert plot coordinate to row index */
export function plot_y_to_row(my: number, plot_height: number, rows: number): number {
    const row_from_top:number = Math.floor((my / plot_height) * rows)
    return rows - 1 - row_from_top
}

/** Build O(1) lookup index for heatmap items by grid coordinate */
export function create_item_index_by_coord(data: DataItem[]): Map<string, number> {
    const output: Map<string, number> = new Map()
    for(let index: number = 0; index < data.length; index++) {
        const item: DataItem = data[index]!
        output.set(`${item.x}:${item.y}`, index)
    }
    return output
}

/** Resolve item index by x/y coordinate */
export function get_item_index_at(
    item_index_by_coord: Map<string, number>,
    x: number,
    y: number,
): number | null {
    const index: number | undefined = item_index_by_coord.get(`${x}:${y}`)
    if(index == undefined)
        return null
    return index
}

/** Build hover model from mouse and plot state */
export function compute_hover_position_from_mouse(props: {
    mx: number,
    my: number,
    root_x: number,
    root_y: number,
    x_axis: number[],
    y_axis: string[],
    rows_cols: RowsCols | null,
    dimensions: SVGPlotDimensions,
    item_index_by_coord: Map<string, number>,
}): HoverPosition | null {
    const rows_cols: RowsCols | null = props.rows_cols
    if(rows_cols == null)
        return null
    if(rows_cols.cols <= 0 || rows_cols.rows <= 0)
        return null

    const col: number = 
        mouse_to_col(props.mx, props.dimensions.plot_width, rows_cols.cols)
    const row: number = 
        mouse_to_row(props.my, props.dimensions.plot_height, rows_cols.rows)
    if(col < 0 || row < 0)
        return null

    const x_seconds: number | undefined = props.x_axis[col]
    const y_value: string | undefined = props.y_axis[row]
    if(x_seconds == undefined || y_value == undefined)
        return null

    const hover_item_index: number | null = get_item_index_at(
        props.item_index_by_coord,
        col,
        row,
    )
    const data_label: string = (hover_item_index == null) ? 'no data' : ''

    const overlay_x: number = Math.max(0, Math.floor(props.root_x) + 12)
    const overlay_y: number = Math.max(0, Math.floor(props.root_y) + 12)

    return {
        overlay_x,
        overlay_y,
        x_label: strftime_ISO8601_datetime(new Date(x_seconds * 1000)),
        y_label: y_value,
        data_label,
        item_index: hover_item_index,
        x: col,
        y: row,
    }
}


export type RGB = {
    r: number;
    g: number;
    b: number;
}


export type HeatmapRenderedPixels = {
    width:  number,
    height: number,
    pixels: Uint8ClampedArray,
}

/** Clip a {@link Size} between `1` and a maximum value */
export function constrain_size(
    size:     Size,
    max_side: number,
): Size {
    const safe_size: Size = {
        width:  Math.max(Math.floor(size.width), 1),
        height: Math.max(Math.floor(size.height), 1)
    }
    const safe_max:number = Math.max(Math.floor(max_side), 1)

    const render_size: Size = {
        width:  Math.min(safe_size.width, safe_max),
        height: Math.min(safe_size.height, safe_max)
    }
    return render_size
}

function size_exceeds(size: Size, max_side: number): boolean {
    return size.width > max_side || size.height > max_side
}

function size_exceeds_offscreen_canvas_limit(size: Size): boolean {
    return size_exceeds(size, OFFSCREEN_CANVAS_MAX_SIDE)
}


/** Convert an array of {@link DataItem} to a 2D RGBA imagedata for a canvas,
 *  downsampling if too large for the canvas. */
export function build_heatmap_render_pixels(props: {
    data:        DataItem[],
    data_size:   Size,
    colormap:    'viridis' | 'magma',
    downsample?: 'nearest' | 'maxpool',
    max_side?:   number,
}): HeatmapRenderedPixels {
    const max_side: number         = props.max_side ?? OFFSCREEN_CANVAS_MAX_SIDE
    const render_size: Size        = constrain_size(props.data_size, max_side)
    const pixel_count: number      = render_size.width * render_size.height
    const pixels:Uint8ClampedArray = new Uint8ClampedArray(pixel_count * 4)
    const cmap:(t:number) => RGB   = COLORMAPS[props.colormap]

    // gray where no data
    for(let i:number = 0; i < pixel_count; i++) {
        const offset:number = i * 4
        pixels[offset + 0] = 176
        pixels[offset + 1] = 176
        pixels[offset + 2] = 176
        pixels[offset + 3] = 255
    }

    const method:'nearest'|'maxpool' = props.downsample ?? 'nearest'
    if(method == 'maxpool')
        render_pixels_with_maxpool(pixels, props.data, props.data_size, render_size, cmap)
    else
        render_pixels_with_nearest(pixels, props.data, props.data_size, render_size, cmap)

    return {
        width:  render_size.width,
        height: render_size.height,
        pixels: pixels,
    }
}


/** Viridis color palette interpolation (0..1 -> RGB) */
export function viridis(t: number): RGB {
    if (!Number.isFinite(t)) 
        return {r:0, g:0, b:0}
    
    const stops:[number, number, number][] = [
      [ 68,   1,  84],
      [ 59,  82, 139],
      [ 33, 145, 140],
      [ 94, 201,  98],
      [253, 231,  37],
    ];
  
    t = Math.max(0, Math.min(1, t));
  
    const n:number = stops.length - 1;
    const i:number = Math.min(Math.floor(t * n), n - 1);
    const f:number = t * n - i;
  
    const [r1, g1, b1] = stops[i]!;
    const [r2, g2, b2] = stops[i + 1]!;
  
    const r:number = Math.round(r1 + (r2 - r1) * f);
    const g:number = Math.round(g1 + (g2 - g1) * f);
    const b:number = Math.round(b1 + (b2 - b1) * f);
  
    return {r, g, b}
}


/** Magma color palette interpolation (0..1 -> RGB) */
export function magma(t: number): RGB {
    if (!Number.isFinite(t)) 
        return {r:0, g:0, b:0}

    const stops: [number, number, number][] = [
      [  0,   0,   4],
      [ 59,  15, 112],
      [140,  41, 129],
      [221,  73, 104],
      [254, 159, 109],
      [252, 253, 191],
    ];
  
    t = Math.max(0, Math.min(1, t));
  
    const n: number = stops.length - 1;
    const i: number = Math.min(Math.floor(t * n), n - 1);
    const f: number = t * n - i;
  
    const [r1, g1, b1] = stops[i]!;
    const [r2, g2, b2] = stops[i + 1]!;
  
    const r: number = Math.round(r1 + (r2 - r1) * f);
    const g: number = Math.round(g1 + (g2 - g1) * f);
    const b: number = Math.round(b1 + (b2 - b1) * f);
  
    return { r, g, b };
}

const COLORMAPS = {viridis, magma};

function render_pixels_with_nearest(
    output:      Uint8ClampedArray,
    data:        DataItem[],
    data_size:   Size,
    render_size: Size,
    cmap:        (t:number) => RGB,
): void {
    for(const item of data) {
        const p: Point|null = 
            map_point_between_sizes({x:item.x, y:item.y}, data_size, render_size)
        if(p == null)
            continue

        const rgb:RGB =
            typeof item.color == 'number' ? cmap(item.color) : item.color

        const row:number = render_size.height - 1 - p.y
        const index:number = (row * render_size.width + p.x) * 4
        output[index + 0] = rgb.r
        output[index + 1] = rgb.g
        output[index + 2] = rgb.b
        output[index + 3] = 255
    }
}

function render_pixels_with_maxpool(
    output:      Uint8ClampedArray,
    data:        DataItem[],
    data_size:   Size,
    render_size: Size,
    cmap:       (t:number) => RGB,
): void {
    const max_by_cell:Float64Array =
        new Float64Array(render_size.width * render_size.height)
    max_by_cell.fill(Number.NEGATIVE_INFINITY)

    for(const item of data) {
        const p: Point|null = 
            map_point_between_sizes({x:item.x, y:item.y}, data_size, render_size)
        if(p == null)
            continue

        const rgb:RGB =
            typeof item.color == 'number' ? cmap(item.color) : item.color

        const row:number = render_size.height - 1 - p.y
        const cell_index:number = row * render_size.width + p.x
        const intensity:number =
            typeof item.color == 'number'
                ? item.color
                : rgb_luminance(item.color)
        const current_max:number =
            max_by_cell[cell_index] ?? Number.NEGATIVE_INFINITY
        if(intensity < current_max)
            continue

        max_by_cell[cell_index] = intensity
        const byte_index:number = cell_index * 4
        output[byte_index + 0] = rgb.r
        output[byte_index + 1] = rgb.g
        output[byte_index + 2] = rgb.b
        output[byte_index + 3] = 255
    }
}


function map_point_between_sizes(
    point:     Point,
    from_size: Size,
    to_size:   Size,
): Point | null {
    if(point.x < 0 || point.y < 0)
        return null
    if(point.x >= from_size.width || point.y >= from_size.height)
        return null

    const scale_x: number = to_size.width  / from_size.width
    const scale_y: number = to_size.height / from_size.height
    if(!isFinite(scale_x) || !isFinite(scale_y))
        return null

    const new_x: number = Math.floor(
        Math.min(point.x * scale_x, to_size.width - 1)
    )
    const new_y: number = Math.floor(
        Math.min(point.y * scale_y, to_size.height - 1)
    )

    return {x:new_x, y:new_y}
}



function rgb_luminance(color: RGB): number {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}
