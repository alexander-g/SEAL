import { preact, Signal, signals, JSX } from "../dep.ts"

import * as d3 from "d3";

import { compute_zoom_scales } from './d3-heatmap.tsx'
import type {
    SVGPlotDimensions,
    RowsCols,
} from './d3-heatmap.tsx'
import { strftime_ISO8601_datetime, strftime_ISO8601_time } from "../lib/util.ts";



export class Axes extends preact.Component<{
    /** Sizes of the SVG components */
    $dimensions: Readonly<Signal<SVGPlotDimensions>>,

    /** Number of pixels along x and y axes in the data */
    $rowscols: Readonly<Signal<RowsCols|null>>,

    /** Values along the x axis */
    $x_axis:Readonly<Signal<(number[]|Date[])>>,

    /** Values along the y axis */
    $y_axis:Readonly<Signal<string[]>>,

    /** Optional ticks along the y axis */
    $y_axis_tick_values?: Readonly<Signal<number[]>>

    /** Current zoom state */
    $zoom_transform: Readonly<Signal<d3.ZoomTransform>>,

    /** Optional formatter for x axis labels */
    x_axis_label_formatter?: (value:number) => string,

    /** Optional formatter for y axis labels */
    y_axis_label_formatter?: (index:number, y_axis:string[]) => string,
}> {

    render(): JSX.Element {
        return <>
            <g 
                class     = "axis" 
                transform = {this.$x_axis_transform} 
                ref       = {this.xaxis_ref} 
            />
            <g ref={this.yaxis_ref} class="axis" />
        </>
    }

    xaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()
    yaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()
    
    update_axes = () => {
        // NOTE: accessing $signals up here to make sure they are subscribed to
        const t:d3.ZoomTransform     = this.props.$zoom_transform.value
        const x_axis:number[]|Date[] = this.props.$x_axis.value
        const y_axis:string[]        = this.props.$y_axis.value
        const y_axis_tick_values:number[]|undefined =
            this.props.$y_axis_tick_values?.value
        const colsrows:RowsCols|null = this.props.$rowscols.value
        if(colsrows == null)
            return;
        const { cols, rows } = colsrows;

        const dimensions:SVGPlotDimensions = this.props.$dimensions.value;
        const w:number = dimensions.plot_width
        const h:number = dimensions.plot_height

        const { k_x, k_y } = compute_zoom_scales({
            transform: t,
            rows_cols: colsrows,
            dimensions,
        })

        const zx:d3.ScaleLinear<number,number> =
            new d3.ZoomTransform(k_x, t.x, t.y).rescaleX(
                d3.scaleLinear()
                .domain([0, cols])
                .range([0, w])
            )
        const zy:d3.ScaleLinear<number,number> =
            new d3.ZoomTransform(k_y, t.x, t.y).rescaleY(
                d3.scaleLinear()
                .domain([0, rows])
                .range([h, 0])
            )
        
        
        let d3_x_axis: d3.Axis<Date|d3.NumberValue>|null = 
            create_d3_axis_for_dates_or_numbers(x_axis, zx)
                
        const x_tickvalues:Date[]|d3.NumberValue[] = d3_x_axis?.tickValues() ?? []
        d3_x_axis?.tickFormat(
                ((_, i) => this.#format_x_axis_value(x_tickvalues, i) )
            )
            ?? null
        
        const d3_y_axis: d3.Axis<d3.NumberValue> = 
            d3.axisLeft(zy)
            .tickValues(this.#resolve_y_axis_tick_values(rows, y_axis_tick_values))
            .tickFormat((value) =>
                this.#format_y_axis_value(y_axis, Number(value))
            )

        if(d3_x_axis != null)
            d3.select(this.xaxis_ref.current)
                // @ts-ignore this is correct 
                .call(d3_x_axis);
        d3.select(this.yaxis_ref.current)
            // @ts-ignore this is correct 
            .call(d3_y_axis);
    }
    #_1 = signals.effect( this.update_axes )


    $x_axis_transform:Readonly<Signal<string>> = signals.computed(() =>
        `translate(0,${this.props.$dimensions.value.plot_height})`
    )

    #format_x_axis_value(ticks:d3.NumberValue[]|Date[], tick_index:number): string {
        const value:d3.NumberValue|Date|undefined = ticks[tick_index]
        if(value == undefined)
            return ''

        const formatter:((value:number)=>string)|undefined =
            this.props.x_axis_label_formatter
        if(formatter != undefined && !(value instanceof Date))
            return formatter(Number(value))

        if(!(value instanceof Date))
            return value.toString()

        // TODO: time is only implicit, make it explicit in the props
        const as_date = new Date( value )
        if(tick_index == 0)
            return strftime_ISO8601_datetime(as_date)
        else {
            const previous_date: Date = ticks[tick_index-1]! as Date
            if( same_day(as_date, previous_date) )
                return strftime_ISO8601_time(as_date)
            else
                return strftime_ISO8601_datetime(as_date)
        }
    }

    #format_y_axis_value(y_axis:string[], value:number): string {
        const tick_index:number = Math.floor(value)
        const formatter:((index:number, y_axis:string[]) => string)|undefined =
            this.props.y_axis_label_formatter
        if(formatter != undefined)
            return formatter(tick_index, y_axis)

        const tick_label:string|undefined = y_axis[tick_index]
        return tick_label ?? ''
    }

    #resolve_y_axis_tick_values(
        rows:number,
        y_axis_tick_values:number[]|undefined,
    ): number[] {
        if(y_axis_tick_values != undefined)
            return y_axis_tick_values

        return d3.ticks(0, rows, 5)
    }
}


function same_day(a:Date, b:Date): boolean {
    return (
        a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth() &&
        a.getUTCDate() === b.getUTCDate()
    )
}

function interpolate_axis_value(
    x_axis:      number[],
    float_index: number,
): number | undefined {
    if(x_axis.length == 0)
        return undefined

    if(float_index <= 0)
        return x_axis[0]

    const last_index: number = x_axis.length - 1
    if(float_index >= last_index)
        return x_axis[last_index]

    const low_index: number  = Math.floor(float_index)
    const high_index: number = Math.ceil(float_index)
    const low: number   = x_axis[low_index]!
    const high: number  = x_axis[high_index]!
    const ratio: number = float_index - low_index
    return low + (high - low) * ratio
}



function create_d3_axis_for_dates_or_numbers(
    values: Date[]|number[], 
    scale:  d3.ScaleLinear<number,number>
): d3.Axis<Date|d3.NumberValue>|null {
    const scale_range:number[] = scale.range()
    const scale_domain:number[] = scale.domain()

    const n_pixels:number = scale_range[scale_range.length-1]!
    const n_values:number = scale_domain[scale_domain.length-1]!


    // index of first/last visible data column at plot bounds (clipped)
    const first_index_in_bounds:number = Math.max(scale.invert(0), 0)
    const last_index_in_bounds:number = 
        Math.min(scale.invert(n_pixels), n_values - 1)


    const values_t: number[] = values.map( Number )

    const first_visible_value: number|undefined = 
        interpolate_axis_value(values_t, first_index_in_bounds)
    const last_visible_value: number|undefined = 
        interpolate_axis_value(values_t, last_index_in_bounds)
    if(first_visible_value == undefined || last_visible_value == undefined)
        return null

    if(values[0] instanceof Date) {
        const x_axis_scale: d3.ScaleTime<number, number> = d3.scaleUtc()
            .domain([
                new Date(first_visible_value),
                new Date(last_visible_value),
            ])
            .range([0, n_pixels])

        const x_tickvalues: Date[] = x_axis_scale.ticks(5)
        const d3_axis: d3.Axis<Date|d3.NumberValue> = 
            d3.axisBottom(x_axis_scale)
            .tickValues(x_tickvalues)

        return d3_axis
    } 
    // else

    const x_axis_scale: d3.ScaleLinear<number, number> = d3.scaleLinear()
        .domain([
            first_visible_value,
            last_visible_value,
        ])
        .range([0, n_pixels])

    const x_tickvalues: number[] = x_axis_scale.ticks(5)
    const d3_axis: d3.Axis<d3.NumberValue> = 
        d3.axisBottom(x_axis_scale)
        .tickValues(x_tickvalues)

    return d3_axis
}
