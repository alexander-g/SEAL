import { preact, Signal, signals, JSX } from "../dep.ts"

import * as d3 from "d3";

import { compute_zoom_scales } from './d3-heatmap.tsx'
import type {
    SVGPlotDimensions,
    RowsCols,
} from './d3-heatmap.tsx'
import { strftime_ISO8601_datetime } from "../lib/util.ts";



export class Axes extends preact.Component<{
    /** Sizes of the SVG components */
    $dimensions: Readonly<Signal<SVGPlotDimensions>>,

    /** Number of pixels along x and y axes in the data */
    $rowscols: Readonly<Signal<RowsCols|null>>,

    /** Values along the x axis */
    $x_axis:Readonly<Signal<number[]>>,

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

    update_axes = () => {
        // NOTE: accessing $signals up here to make sure they are subscribed to
        const t:d3.ZoomTransform = this.props.$zoom_transform.value
        const x_axis:number[]    = this.props.$x_axis.value
        const y_axis:string[]    = this.props.$y_axis.value
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


        const step_size_x:number = Math.floor((zx.invert(w) - zx.invert(0)) / 10)

        // index of first data column at plot position 0 (clipped)
        const first_col_in_bounds:number = Math.max(zx.invert(0), 0)
        const last_col_in_bounds:number = Math.min(zx.invert(w), cols)
        

        const d3_x_axis:d3.Axis<d3.NumberValue> = 
            d3.axisBottom(zx)
            .tickValues(
                d3.range( 
                    Math.ceil(first_col_in_bounds), 
                    Math.floor(last_col_in_bounds), 
                    step_size_x 
                )
            )
            // TODO: too many assumptions for this component
            .tickFormat( t => this.#format_x_axis_value(x_axis, Number(t)) )
        const d3_y_axis:d3.Axis<d3.NumberValue> = 
            d3.axisLeft(zy)
            .tickValues(this.#resolve_y_axis_tick_values(rows, y_axis_tick_values))
            .tickFormat((value) =>
                this.#format_y_axis_value(y_axis, Number(value))
            )

        d3.select(this.xaxis_ref.current)
            // @ts-ignore this is correct 
            .call(d3_x_axis);
        d3.select(this.yaxis_ref.current)
            // @ts-ignore this is correct 
            .call(d3_y_axis);
    }
    #_1 = signals.effect( this.update_axes )

    xaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()
    yaxis_ref: preact.RefObject<SVGGElement> = preact.createRef()

    $x_axis_transform:Readonly<Signal<string>> = signals.computed(() =>
        `translate(0,${this.props.$dimensions.value.plot_height})`
    )

    #format_x_axis_value(x_axis:number[], index:number): string {
        const value:number|undefined = x_axis[index]
        if(value == undefined)
            return ''

        const formatter:((value:number)=>string)|undefined =
            this.props.x_axis_label_formatter
        if(formatter != undefined)
            return formatter(value)

        return strftime_ISO8601_datetime(new Date( value * 1000 ) )
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
