import { preact, Signal, signals, JSX } from "../dep.ts"
import { OverlayDiv } from "./overlay-div.tsx";

import * as d3 from "d3";
import * as d3tile from "d3-tile"


// @ts-ignore for debugging
globalThis.d3 = d3;
// @ts-ignore for debugging
globalThis.d3tile = d3tile;



export type Marker = {
    latitude:  number;
    longitude: number;
    label?:    string;
    ignore_for_centering?: boolean;
    visual?:   MarkerVisual;
    rings?:    MarkerRings;
}

export type MarkerShape = 'circle'|'diamond'|'square'|'triangle'

export type MarkerVisual = {
    shape?: MarkerShape;
    color?: string;
    highlight_color?: string;
    stroke_color?:    string;
    size?:            number;
}

export type MarkerRings = {
    distances_km: number[];
    color?: string;
    stroke_width?: number;
}

type D3MapProps = {
    $markers: Readonly<Signal<Marker[]>>

    /** Optional override for empty-overlay visibility */
    $overlay_visible?: Readonly<Signal<boolean>>

    /** Called when mouse hovers above a marker. Argument: index or null if none */
    on_marker_hover?: (index:number|null) => void,

    /** Indices of markers to highlight */
    $highlighted_markers?: Readonly<Signal<number[]>>,
}

export class D3Map extends preact.Component<D3MapProps> {
    static override defaultProps = { width: 400, height: 400 };
    static readonly scale_min:number = 1 << 8
    static readonly scale_max:number = 1 << 22
    static readonly fit_padding_ratio:number = 0.85

    private static next_clip_id:number = 0
    private clip_path_id:string = `map-clip-${D3Map.next_clip_id++}`

    svg_ref:   preact.RefObject<SVGSVGElement> = preact.createRef();
    xaxis_ref: preact.RefObject<SVGGElement>   = preact.createRef();
    yaxis_ref: preact.RefObject<SVGGElement>   = preact.createRef();
    container_ref:preact.RefObject<HTMLDivElement> = preact.createRef()

    zoom_behavior: d3.ZoomBehavior<SVGSVGElement, unknown>|null = null
    current_transform: d3.ZoomTransform = d3.zoomIdentity
    markers_center_key:string = ''

    /** SVG map elements */
    $svg_tiles:Signal<JSX.Element[]> = new Signal([])

    /** SVG coordinate grid lines */
    $svg_grid_lines:Signal<JSX.Element[]> = new Signal([])

    /** SVG bubbles */
    $svg_annotations:Signal<JSX.Element[]> = new Signal([])

    /** HTML tooltips shown for highlighted markers */
    $marker_tooltips:Signal<JSX.Element[]> = new Signal([])

    $markers_empty:Readonly<Signal<boolean>> = signals.computed(
        () => (this.props.$markers.value.length == 0)
    )

    /** Whether or not to show the "No stations loaded" overlay message */
    $overlay_visible:Readonly<Signal<boolean>> =
        this.props.$overlay_visible ?? this.$markers_empty

    
    /** Current size of the top <div>. Updated via ResizeObserver. */
    $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })

    $dimensions: Readonly<Signal<MapPlotDimensions>> = signals.computed(() =>
        compute_map_dimensions(this.$container_size.value)
    )
    $plot_width: Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_width
    )
    $plot_height: Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_height
    )
    $x_axis_transform: Readonly<Signal<string>> = signals.computed(() =>
        `translate(0,${this.$plot_height.value})`
    )


    render(): JSX.Element {
        const { width, height } = this.$container_size.value;


        return <div 
            class = "d3-container d3-map" 
            style = {{position:"relative", 'width':'100%', 'height':'100%'}}
            ref   = {this.container_ref}
        >
            <svg
                ref = {this.svg_ref} 
                width  = {width}
                height = {height}
            >
                <defs>
                    <clipPath id={this.clip_path_id}>
                        <rect
                            x      = "0"
                            y      = "0"
                            width  = {this.$plot_width}
                            height = {this.$plot_height}
                        />
                    </clipPath>
                </defs>

                <g transform={`translate(${MAP_PLOT_MARGIN.left},${MAP_PLOT_MARGIN.top})`}>
                    <g clip-path={`url(#${this.clip_path_id})`}>
                        <rect
                            x      = "0"
                            y      = "0"
                            width  = {this.$plot_width}
                            height = {this.$plot_height}
                            fill   = "rgb(224,230,224)"
                        />
                        <g class="tiles" pointer-events="none">
                            { this.$svg_tiles }
                        </g>
                        <g class="grid-lines" pointer-events="none">
                            { this.$svg_grid_lines }
                        </g>
                        <g class="annotations">
                            { this.$svg_annotations }
                        </g>
                    </g>

                    <g
                        class     = "axis x-axis"
                        transform = {this.$x_axis_transform}
                        ref       = {this.xaxis_ref}
                    />
                    <g
                        class = "axis y-axis"
                        ref   = {this.yaxis_ref}
                    />
                </g>
            </svg>

            { this.$marker_tooltips }

            <OverlayDiv $visible={this.$overlay_visible} >
                No stations loaded.
            </OverlayDiv>
        </div>
    }



    resize_observer: ResizeObserver|null = null

    override componentDidMount(): void {
        const { plot_width, plot_height } = this.$dimensions.value;

        const zoom:d3.ZoomBehavior<SVGSVGElement, unknown> = 
            d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([D3Map.scale_min, D3Map.scale_max])
            .on("zoom", (event) => this.on_zoom(event.transform));
        
        const transform:d3.ZoomTransform = 
            d3.zoomIdentity
            .translate(plot_width >> 1, plot_height >> 1)
            .scale(1 << 12)

        this.zoom_behavior = zoom
        this.current_transform = transform

        d3.select(this.svg_ref.current!)
            .call(zoom)
            .call(zoom.transform, transform);

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
    }

    center_on_markers(): void {
        const markers:Marker[] = this.props.$markers.value;
        if(markers.length == 0)
            return;

        const markers_for_centering:Marker[] = markers
            .filter((marker:Marker) => !marker.ignore_for_centering)
        if(markers_for_centering.length == 0)
            return

        // to avoid re-computing if markers dont change
        // for some reason this function gets triggered when it should not be
        const next_center_key:string = markers_for_centering
            .map((marker:Marker) => `${marker.latitude},${marker.longitude}`)
            .join('|')
        if(next_center_key == this.markers_center_key)
            return;

        if(this.zoom_behavior == null || this.svg_ref.current == null)
            return;


        let latitude_min:number = markers_for_centering[0]!.latitude
        let latitude_max:number = markers_for_centering[0]!.latitude
        let longitude_min:number = markers_for_centering[0]!.longitude
        let longitude_max:number = markers_for_centering[0]!.longitude

        for(const marker of markers_for_centering){
            latitude_min = Math.min(latitude_min, marker.latitude)
            latitude_max = Math.max(latitude_max, marker.latitude)
            longitude_min = Math.min(longitude_min, marker.longitude)
            longitude_max = Math.max(longitude_max, marker.longitude)
        }

        const base_projection:d3.GeoProjection = d3.geoMercator()
            .scale(1 / (2 * Math.PI))
            .translate([0, 0])

        let x_min:number = Number.POSITIVE_INFINITY
        let x_max:number = Number.NEGATIVE_INFINITY
        let y_min:number = Number.POSITIVE_INFINITY
        let y_max:number = Number.NEGATIVE_INFINITY

        for(const marker of markers_for_centering){
            const projected:[number,number]|null =
                base_projection([marker.longitude, marker.latitude])
            if(projected == null)
                continue;

            x_min = Math.min(x_min, projected[0])
            x_max = Math.max(x_max, projected[0])
            y_min = Math.min(y_min, projected[1])
            y_max = Math.max(y_max, projected[1])
        }

        if(!Number.isFinite(x_min) || !Number.isFinite(y_min))
            return;

        const center_x:number = (x_min + x_max) / 2
        const center_y:number = (y_min + y_max) / 2
        const span_x:number = x_max - x_min
        const span_y:number = y_max - y_min

        let next_scale:number = this.current_transform.k

        const { plot_width, plot_height } = this.$dimensions.value;

        if(span_x > 0 && span_y > 0){
            const usable_width:number = plot_width * D3Map.fit_padding_ratio
            const usable_height:number = plot_height * D3Map.fit_padding_ratio
            const fit_scale_x:number = usable_width / span_x
            const fit_scale_y:number = usable_height / span_y
            next_scale = Math.min(fit_scale_x, fit_scale_y)
        } else if(span_x > 0) {
            const usable_width:number = plot_width * D3Map.fit_padding_ratio
            next_scale = usable_width / span_x
        } else if(span_y > 0) {
            const usable_height:number = plot_height * D3Map.fit_padding_ratio
            next_scale = usable_height / span_y
        }

        next_scale = Math.max(D3Map.scale_min, Math.min(D3Map.scale_max, next_scale))

        const transform:d3.ZoomTransform = d3.zoomIdentity
            .translate(
                (plot_width / 2) - (center_x * next_scale), 
                (plot_height / 2) - (center_y * next_scale)
            )
            .scale(next_scale)

        this.markers_center_key = next_center_key

        d3.select(this.svg_ref.current)
            .call(this.zoom_behavior.transform, transform)
    }
    #_1 = signals.effect(() => this.center_on_markers())


    on_marker_hover(index:number|null): void {
        this.props.on_marker_hover?.(index)
    }

    on_highlighted_markers_changed(): void {
        // dependency tracking for signal-based props
        this.props.$markers.value
        this.props.$highlighted_markers?.value

        this.update_annotations(this.current_transform)
        this.update_marker_tooltips(this.current_transform)
    }
    #_2 = signals.effect(() => this.on_highlighted_markers_changed())


    update_axes(transform:d3.ZoomTransform): void {
        if(this.xaxis_ref.current == null || this.yaxis_ref.current == null)
            return

        const { plot_width, plot_height } = this.$dimensions.value
        const bounds =
            compute_visible_coordinate_bounds(transform, plot_width, plot_height)
        if(bounds instanceof Error)
            return

        const projection:d3.GeoProjection = create_mercator_projection(transform)

        const x_scale:d3.ScaleLinear<number, number> = d3.scaleLinear()
            .domain(bounds.longitude_domain)
            .range([0, plot_width])
        const longitude_ticks:number[] = x_scale.ticks(4)

        const x_axis:d3.Axis<d3.NumberValue> = d3.axisBottom(x_scale)
            .tickValues(longitude_ticks)
            .tickFormat((value:d3.NumberValue) => {
                const label:string|Error =
                    format_coordinate_axis_label(Number(value), 'longitude')
                return label instanceof Error ? '' : label
            })

        const latitude_ticks:number[] =
            d3.ticks(bounds.latitude_domain[0], bounds.latitude_domain[1], 4)
        const y_scale:d3.ScaleLinear<number, number> = d3.scaleLinear()
            .domain(bounds.latitude_domain)
            .range([plot_height, 0])

        if(latitude_ticks.length >= 2) {
            const tick_positions:number[] = latitude_ticks.map((lat:number) => {
                const projected:[number, number]|null = projection([0, lat])
                return projected != null ? projected[1] : y_scale(lat)
            })
            y_scale.domain(latitude_ticks).range(tick_positions)
        }

        const y_axis:d3.Axis<d3.NumberValue> = d3.axisLeft(y_scale)
            .tickValues(latitude_ticks)
            .tickFormat((value:d3.NumberValue) => {
                const label:string|Error =
                    format_coordinate_axis_label(Number(value), 'latitude')
                return label instanceof Error ? '' : label
            })

        d3.select(this.xaxis_ref.current).call(x_axis)
        d3.select(this.yaxis_ref.current).call(y_axis)

        const grid_lines:JSX.Element[] = []
        for(const lon of longitude_ticks) {
            const x:number = x_scale(lon)
            grid_lines.push(
                <line
                    key            = {`grid-x-${lon}`}
                    x1             = {x}
                    y1             = {0}
                    x2             = {x}
                    y2             = {plot_height}
                    stroke         = 'black'
                    stroke-opacity = {0.15}
                />
            )
        }
        for(const lat of latitude_ticks) {
            const y:number = y_scale(lat)
            grid_lines.push(
                <line
                    key            = {`grid-y-${lat}`}
                    x1             = {0}
                    y1             = {y}
                    x2             = {plot_width}
                    y2             = {y}
                    stroke         = 'black'
                    stroke-opacity = {0.15}
                />
            )
        }
        this.$svg_grid_lines.value = grid_lines
    }


    update_annotations(transform:d3.ZoomTransform): void {
        const projection:d3.GeoProjection = create_mercator_projection(transform)

        const highlighted_markers:number[] = this.props.$highlighted_markers?.value ?? []
        const highlighted_indices:Set<number> = new Set(highlighted_markers)

        const svg_regular_rings:JSX.Element[] = []
        const svg_highlighted_rings:JSX.Element[] = []
        const svg_markers_regular:JSX.Element[] = []
        const svg_markers_highlighted:JSX.Element[] = []

        for(const markerindex in this.props.$markers.value) {
            const marker:Marker = this.props.$markers.value[markerindex]!
            const projected:[number,number]|null = 
                projection([marker.longitude, marker.latitude]);
            if(projected == null)
                continue;

            const index:number = Number(markerindex)
            const marker_is_highlighted:boolean = highlighted_indices.has(index)
            const marker_shape:MarkerShape = marker.visual?.shape ?? 'circle'
            const marker_size:number = marker.visual?.size ?? 5
            const marker_fill:string = marker_is_highlighted
                ? (marker.visual?.highlight_color ?? '#f57c00')
                : (marker.visual?.color ?? 'red')
            const marker_stroke:string = marker.visual?.stroke_color ?? '#fff'

            const ring_distances:number[] = marker.rings?.distances_km ?? []
            for(const ring_distance_km of ring_distances) {
                const ring_radius:number = distance_km_to_pixel_radius(
                    ring_distance_km,
                    marker.latitude,
                    transform,
                )
                if(!Number.isFinite(ring_radius) || ring_radius <= 0)
                    continue

                const ring_element:JSX.Element =
                    <circle
                        cx = {projected[0]}
                        cy = {projected[1]}
                        r  = {ring_radius}
                        fill = 'none'
                        stroke = {marker.rings?.color ?? 'rgba(30, 80, 190, 0.55)'}
                        stroke-width = {marker.rings?.stroke_width ?? 1.5}
                        pointer-events = 'none'
                        key = {`${index}-ring-${ring_distance_km}`}
                    />

                if(marker_is_highlighted)
                    svg_highlighted_rings.push(ring_element)
                else
                    svg_regular_rings.push(ring_element)
            }

            const marker_svg:JSX.Element =
                render_map_marker(
                    projected[0],
                    projected[1],
                    marker_shape,
                    marker_size,
                    marker_fill,
                    marker_stroke,
                    index,
                    () => this.on_marker_hover(index),
                    () => this.on_marker_hover(null),
                )

            if(marker_is_highlighted)
                svg_markers_highlighted.push(marker_svg)
            else
                svg_markers_regular.push(marker_svg)
        }

        this.$svg_annotations.value = [
            ...svg_regular_rings,
            ...svg_markers_regular,
            ...svg_highlighted_rings,
            ...svg_markers_highlighted,
        ]
    }

    update_marker_tooltips(transform:d3.ZoomTransform): void {
        const projection:d3.GeoProjection = create_mercator_projection(transform)

        const highlighted_markers:number[] = this.props.$highlighted_markers?.value ?? []
        const tooltips:JSX.Element[] = []
        const container_size:Size = this.$container_size.value
        const tooltip_offset:number    = 12
        const tooltip_padding:number   = 8
        const tooltip_max_width:number = 240
        const tooltip_height:number    = 24

        for(const index of highlighted_markers){
            const marker:Marker|undefined = this.props.$markers.value[index]
            if(marker == null)
                continue;

            const label:string = marker.label ?? ''
            if(label.trim().length == 0)
                continue;

            const projected:[number,number]|null = 
                projection([marker.longitude, marker.latitude])
            if(projected == null)
                continue;

            // to make sure the tooltips stay within the map bounds
            const estimated_width:number = Math.min(
                (label.length * 7) + (tooltip_padding * 2),
                tooltip_max_width,
            )
            const base_left:number = projected[0] + MAP_PLOT_MARGIN.left + tooltip_offset
            const base_top:number = projected[1] + MAP_PLOT_MARGIN.top + tooltip_offset
            const clamped_left:number = Math.max(
                tooltip_padding,
                Math.min(
                    base_left,
                    container_size.width - estimated_width - tooltip_padding,
                ),
            )
            const clamped_top:number = Math.max(
                tooltip_padding,
                Math.min(
                    base_top,
                    container_size.height - tooltip_height - tooltip_padding,
                ),
            )

            tooltips.push(
                <div
                    class = 'map-marker-tooltip'
                    style = {{
                        position:       'absolute',
                        left:           `${clamped_left}px`,
                        top:            `${clamped_top}px`,
                        pointerEvents:  'none',
                        color:          '#fff',
                        padding:        '2px 6px',
                        fontSize:       '12px',
                        fontFamily:     'sans',
                        lineHeight:     '1.2',
                        whiteSpace:     'nowrap',
                        maxWidth:       `${tooltip_max_width}px`,
                        overflow:       'hidden',
                        textOverflow:   'ellipsis',
                        zIndex:         1,
                        backgroundColor:'rgba(0, 0, 0, 0.82)',
                    }}
                >
                    {label}
                </div>
            )
        }

        this.$marker_tooltips.value = tooltips
    }


    on_zoom(transform:d3.ZoomTransform): void {
        this.current_transform = transform
        const { plot_width, plot_height } = this.$dimensions.value;

        const tilelayout:d3tile.TileLayout = 
            d3tile.tile()
            .extent([[0, 0], [plot_width, plot_height]])
            .tileSize(512)
            .clampX(false);

        const deltas:number[] = [0];
        const svg_tilegroups:JSX.Element[] = []
        for(const d of deltas){
            const svg_tiles:JSX.Element[] = []

            const tiles:d3tile.Tiles = tilelayout.zoomDelta(d)(transform);
            for(const tile of tiles){
                const url:string = url4tile(...d3tile.tileWrap(tile))
                
                const [tile_x, tile_y] = tile;
                const image_x:number = (tile_x + tiles.translate[0]) * tiles.scale
                const image_y:number = (tile_y + tiles.translate[1]) * tiles.scale

                const svg_tile:JSX.Element = 
                    <image 
                        xlink:href = {url}
                        x = {image_x}
                        y = {image_y}
                        width  = {tiles.scale}
                        height = {tiles.scale}
                    />
                svg_tiles.push(svg_tile);
            }

            svg_tilegroups.push(
                <g class={`tilegroup-delta${d}`}>
                    { svg_tiles }
                </g>
            )
        }
        this.$svg_tiles.value = svg_tilegroups;

        this.update_annotations(transform)
        this.update_marker_tooltips(transform)
        this.update_axes(transform)
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
        this.on_zoom(this.current_transform)
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
}

type Size = {
    width: number,
    height:number,
}

type PlotMargin = {
    top:    number,
    right:  number,
    bottom: number,
    left:   number,
}

export type MapPlotDimensions = {
    svg_width:   number,
    svg_height:  number,
    plot_width:  number,
    plot_height: number,
}

export type CoordinateAxisDirection = 'latitude'|'longitude'

const MAP_PLOT_MARGIN:PlotMargin = {
    top:    2,
    right:  2,
    bottom: 20,
    left:   46,
}

const MERCATOR_MAX_LATITUDE:number = 85.05112878

/** Compute map SVG and inner plot dimensions given container size. */
export function compute_map_dimensions(
    container_size: Size,
): MapPlotDimensions {
    const svg_width:number = Math.max(container_size.width, 0)
    const svg_height:number = Math.max(container_size.height, 0)
    const plot_width:number = Math.max(
        svg_width - MAP_PLOT_MARGIN.left - MAP_PLOT_MARGIN.right,
        1,
    )
    const plot_height:number = Math.max(
        svg_height - MAP_PLOT_MARGIN.top - MAP_PLOT_MARGIN.bottom,
        1,
    )
    return {
        svg_width,
        svg_height,
        plot_width,
        plot_height,
    }
}

/** Format decimal degrees into fixed degrees and 2-digit minutes with hemisphere, e.g. "1°30'N". */
export function format_coordinate_axis_label(
    degrees:   number,
    direction: CoordinateAxisDirection,
): string | Error {
    if(!Number.isFinite(degrees))
        return new Error('Coordinate value must be finite.')

    const hemisphere:string = direction == 'latitude'
        ? (degrees < 0 ? 'S' : 'N')
        : (degrees < 0 ? 'W' : 'E')

    const total_minutes:number = Math.round(Math.abs(degrees) * 60)
    const deg:number = Math.floor(total_minutes / 60)
    const min:number = total_minutes % 60
    const min_str:string = String(min).padStart(2, '0')

    return `${deg}°${min_str}'${hemisphere}`
}

/** Compute visible longitude and latitude bounds from a zoom transform and plot size. */
export function compute_visible_coordinate_bounds(
    transform:   d3.ZoomTransform,
    plot_width:  number,
    plot_height: number,
): { longitude_domain: [number, number], latitude_domain: [number, number] } | Error {
    if(plot_width <= 0 || plot_height <= 0 || transform.k <= 0)
        return new Error('Invalid map plot dimensions or scale.')

    const lon_min:number = ((0 - transform.x) / transform.k) * 360
    const lon_max:number = ((plot_width - transform.x) / transform.k) * 360

    const projection:d3.GeoProjection = create_mercator_projection(transform)
    const top_left:[number, number]|null = projection.invert?.([0, 0]) ?? null
    const bottom_right:[number, number]|null =
        projection.invert?.([plot_width, plot_height]) ?? null
    if(top_left == null || bottom_right == null)
        return new Error('Failed to invert map projection.')

    const lat_max:number = clamp_latitude(top_left[1])
    const lat_min:number = clamp_latitude(bottom_right[1])

    return {
        longitude_domain: [lon_min, lon_max],
        latitude_domain:  [lat_min, lat_max],
    }
}

function create_mercator_projection(transform:d3.ZoomTransform): d3.GeoProjection {
    return d3.geoMercator()
        .scale(transform.k / (2 * Math.PI))
        .translate([transform.x, transform.y])
}

function clamp_latitude(latitude:number): number {
    return Math.max(
        -MERCATOR_MAX_LATITUDE,
        Math.min(MERCATOR_MAX_LATITUDE, latitude),
    )
}



function url4tile(x:number, y:number, z:number): string {
    return `https://tile.opentopomap.org/${z}/${x}/${y}.png`;
}

function distance_km_to_pixel_radius(
    distance_km: number,
    latitude:    number,
    transform:   d3.ZoomTransform,
): number {
    const earth_radius_m:number = 6378137
    const latitude_radians:number = (latitude * Math.PI) / 180
    const circumference_at_latitude_m:number =
        2 * Math.PI * earth_radius_m * Math.max(Math.cos(latitude_radians), 1e-6)
    const meters_per_pixel:number = circumference_at_latitude_m / transform.k
    return (distance_km * 1000) / meters_per_pixel
}

function render_map_marker(
    x:      number,
    y:      number,
    shape:  MarkerShape,
    size:   number,
    fill:   string,
    stroke: string,
    key:    number,
    on_mouse_enter:() => void,
    on_mouse_leave:() => void,
): JSX.Element {
    if(shape == 'diamond') {
        return <polygon
            points = {`${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`}
            fill = {fill}
            stroke = {stroke}
            stroke-width = {1}
            onMouseEnter = {on_mouse_enter}
            onMouseLeave = {on_mouse_leave}
            key = {key}
        />
    }

    if(shape == 'square') {
        return <rect
            x = {x - size}
            y = {y - size}
            width = {size * 2}
            height = {size * 2}
            fill = {fill}
            stroke = {stroke}
            stroke-width = {1}
            onMouseEnter = {on_mouse_enter}
            onMouseLeave = {on_mouse_leave}
            key = {key}
        />
    }

    if(shape == 'triangle') {
        return <polygon
            points = {`${x},${y - size} ${x + size},${y + size} ${x - size},${y + size}`}
            fill = {fill}
            stroke = {stroke}
            stroke-width = {1}
            onMouseEnter = {on_mouse_enter}
            onMouseLeave = {on_mouse_leave}
            key = {key}
        />
    }

    return <circle
        cx = {x}
        cy = {y}
        r  = {size}
        fill = {fill}
        stroke = {stroke}
        stroke-width = {1}
        onMouseEnter = {on_mouse_enter}
        onMouseLeave = {on_mouse_leave}
        key = {key}
    />
}
