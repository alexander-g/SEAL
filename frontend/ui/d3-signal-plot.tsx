import { preact, Signal, signals, JSX } from '../dep.ts'
import { strftime_ISO8601_time, strftime_ISO8601_datetime } from "../lib/util.ts"
import { 
    PlotTitleLabel, 
    PlotXAxisLabel, 
    PlotYAxisLabel 
} from "./d3-plot-labels.tsx"

import * as d3 from 'd3'


/** Signal plot inputs derived from MSEED selection */
export type SignalPlotData = {
    data: Float32Array,
    start_time: Date,
    sample_rate_hz: number,
    title: string,
    x_domain: [Date, Date],
}

export type D3SignalPlotProps = {
    $plot_data: Readonly<Signal<SignalPlotData | null>>
}



/** Render a static signal plot with axes and overlays */
export class D3SignalPlot extends preact.Component<D3SignalPlotProps> {
    private static next_clip_id: number = 0
    private clip_path_id: string = `signal-clip-${D3SignalPlot.next_clip_id++}`

    container_ref: preact.RefObject<HTMLDivElement> = preact.createRef()
    svg_ref: preact.RefObject<SVGSVGElement> = preact.createRef()
    root_ref: preact.RefObject<SVGGElement> = preact.createRef()
    path_ref: preact.RefObject<SVGPathElement> = preact.createRef()
    xaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()
    yaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()

    resize_observer: ResizeObserver | null = null

    private margin: PlotMargin = { top: 24, right: 12, bottom: 40, left: 60 }
    private $container_size: Signal<Size> = new Signal({ width: 0, height: 0 })

    private $dimensions: Readonly<Signal<SVGPlotDimensions>> = signals.computed(() =>
        get_plot_dimensions(this.$container_size.value, this.margin)
    )
    private $svg_viewbox: Readonly<Signal<string>> = signals.computed(() => {
        const dimensions: SVGPlotDimensions = this.$dimensions.value
        return `0 0 ${dimensions.svg_width} ${dimensions.svg_height}`
    })
    private $plot_width: Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_width
    )
    private $plot_height: Readonly<Signal<number>> = signals.computed(() =>
        this.$dimensions.value.plot_height
    )
    private $x_axis_transform: Readonly<Signal<string>> = signals.computed(() =>
        `translate(0,${this.$plot_height.value})`
    )

    render(): JSX.Element {
        return <>
        <div
            class = 'd3-container d3-signal-plot'
            style = {{ 
                position:   'relative', 
                width:      '100%', 
                height:     '100%', 
                userSelect: 'none' 
            }}
            ref   = {this.container_ref}
        >
            <svg
                width = '100%'
                height = '100%'
                viewBox = {this.$svg_viewbox}
                ref = {this.svg_ref}
            >
                <defs>
                    <clipPath id={this.clip_path_id}>
                        <rect
                            x = '0'
                            y = '0'
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
                        <path
                            ref = {this.path_ref}
                            fill = 'none'
                            stroke = '#1f6fb2'
                            stroke-width = '1.5'
                        />
                    </g>

                    <g ref = {this.yaxis_ref} />
                    <g ref = {this.xaxis_ref} transform = {this.$x_axis_transform} />

                    <PlotTitleLabel 
                        $plot_width = {this.$plot_width}
                        $title      = {this.$plot_title}
                    />
                    <PlotXAxisLabel 
                        text         = 'Time (UTC)'
                        $plot_height = {this.$plot_height} 
                        $plot_width  = {this.$plot_width}
                    />
                    <PlotYAxisLabel
                        text         = 'Amplitude'
                        $plot_height = {this.$plot_height}
                    />
                </g>
            </svg>
        </div>
        </>
    }

    override componentDidMount(): void {
        const container: HTMLDivElement | null = this.container_ref.current
        if(container != null) {
            this.#update_container_size(container.clientWidth, container.clientHeight)
            this.resize_observer = new ResizeObserver(this.#on_container_resize)
            this.resize_observer.observe(container)
        }
        this.#update_plot()
    }

    override componentWillUnmount(): void {
        this.resize_observer?.disconnect()
        this.resize_observer = null

        // unsubscribe
        this.#_plotdata_subscription()
        this.#_containersize_subscription()
    }

    #_plotdata_subscription = this.props.$plot_data.subscribe(() => {
        this.#update_plot()
    })

    #_containersize_subscription = this.$container_size.subscribe(() => {
        this.#update_plot()
    })

    #on_container_resize = (entries: ResizeObserverEntry[]): void => {
        for(const entry of entries) {
            const { width, height } = entry.contentRect
            this.#update_container_size(width, height)
        }
    }

    #update_container_size(width: number, height: number): void {
        this.$container_size.value = { width, height }
    }

    #update_plot(): void {
        const dimensions: SVGPlotDimensions = this.$dimensions.value
        if(dimensions.plot_width <= 0 || dimensions.plot_height <= 0)
            return
        if(this.path_ref.current == null)
            return
        if(this.xaxis_ref.current == null || this.yaxis_ref.current == null)
            return

        const plot_data: SignalPlotData | null = this.props.$plot_data.value
        if(plot_data == null) {
            this.#clear_plot()
            return
        }

        const data: Float32Array = plot_data.data
        const time_domain: [Date, Date] = plot_data.x_domain

        const y_domain: [number, number] | Error = 
            compute_signal_y_domain(data, data)
        if(y_domain instanceof Error) {
            this.#clear_plot()
            return
        }

        const start_ms: number = time_domain[0].getTime()
        const sample_period_ms: number = (1000 / plot_data.sample_rate_hz)

        const x_scale: d3.ScaleTime<number, number> = d3.scaleTime()
            .domain(time_domain)
            .range([0, dimensions.plot_width])

        const y_scale: d3.ScaleLinear<number, number> = d3.scaleLinear()
            .domain(y_domain)
            .range([dimensions.plot_height, 0])
            .nice()

        const line_generator: d3.Line<number> = d3.line<number>()
            .x((_value: number, index: number) => {
                const time_ms: number =
                    start_ms + index * sample_period_ms
                return x_scale(new Date(time_ms))
            })
            .y((value: number) => y_scale(value))
        const line_path: string | null = line_generator(data)

        const tick_format = (d: Date, index:number) => 
            (index == 0)? strftime_ISO8601_datetime(d) : strftime_ISO8601_time(d)
        const x_axis: d3.Axis<Date|d3.NumberValue> = d3.axisBottom(x_scale)
            .ticks(5)
            // @ts-ignore yeah whatever
            .tickFormat(tick_format)
        const y_axis: d3.Axis<d3.NumberValue> = d3.axisLeft(y_scale)
            .ticks(5)

        d3.select(this.path_ref.current)
            .attr('d', line_path ?? '')

        d3.select(this.xaxis_ref.current)
            .call(x_axis)

        d3.select(this.yaxis_ref.current)
            .call(y_axis)

        this.$plot_title.value = plot_data.title
    }

    #clear_plot(): void {
        if(this.path_ref.current != null)
            d3.select(this.path_ref.current).attr('d', '')
        if(this.xaxis_ref.current != null)
            d3.select(this.xaxis_ref.current).selectAll('*').remove()
        if(this.yaxis_ref.current != null)
            d3.select(this.yaxis_ref.current).selectAll('*').remove()
        this.$plot_title.value = ''
    }

    private $plot_title: Signal<string> = new Signal('')
}



type Size = {
    width: number,
    height: number,
}

type PlotMargin = {
    top: number,
    right: number,
    bottom: number,
    left: number,
}

type SVGPlotDimensions = {
    svg_width: number,
    svg_height: number,
    plot_width: number,
    plot_height: number,
}



/** Compute svg and plot dimensions from measured size */
function get_plot_dimensions(measured: Size, margin: PlotMargin): SVGPlotDimensions {
    const svg_width: number = measured.width
    const svg_height: number = measured.height
    const plot_width: number = Math.max(svg_width - margin.left - margin.right, 1)
    const plot_height: number = Math.max(svg_height - margin.top - margin.bottom, 1)

    return { svg_width, svg_height, plot_width, plot_height }
}


/** Convert a slice into time bounds */
export function compute_time_domain(
    start_time: Date,
    start_index: number,
    stop_index: number,
    sample_rate_hz: number,
): [Date, Date] | Error {
    if(sample_rate_hz <= 0)
        return new Error('Invalid sample rate.')
    if(stop_index <= start_index)
        return new Error('No data to plot.')

    const start_ms: number =
        start_time.getTime() + (start_index / sample_rate_hz) * 1000
    const stop_ms: number =
        start_time.getTime() + ((stop_index - 1) / sample_rate_hz) * 1000

    return [new Date(start_ms), new Date(stop_ms)]
}

/** Compute y domain and enforce minimum range based on std(data) */
export function compute_signal_y_domain(
    full_data: Float32Array,
    sliced_data: Float32Array,
): [number, number] | Error {
    if(full_data.length == 0 || sliced_data.length == 0)
        return new Error('No data to plot.')

    let data_min: number = sliced_data[0]!
    let data_max: number = sliced_data[0]!
    for(const value of sliced_data) {
        data_min = Math.min(data_min, value)
        data_max = Math.max(data_max, value)
    }

    const data_std: number | Error = compute_standard_deviation(full_data)
    if(data_std instanceof Error)
        return data_std

    const data_range: number = data_max - data_min
    const min_range: number = data_std
    if(data_range < min_range) {
        const center: number = (data_min + data_max) / 2
        return [center - min_range / 2, center + min_range / 2]
    }

    return [data_min, data_max]
}

/** Compute standard deviation without throwing */
function compute_standard_deviation(data: Float32Array): number | Error {
    const n_samples: number = data.length
    if(n_samples == 0)
        return new Error('No data to plot.')

    let mean: number = 0
    for(const value of data)
        mean += value
    mean /= n_samples

    let variance: number = 0
    for(const value of data) {
        const delta: number = value - mean
        variance += delta * delta
    }
    variance /= n_samples
    return Math.sqrt(variance)
}
