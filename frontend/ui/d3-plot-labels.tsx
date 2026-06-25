import { Signal, JSX } from "../dep.ts"




export function PlotTitleLabel(props:{
    $title?:     Readonly<Signal<string>>,
    $plot_width: Readonly<Signal<number>>
}): JSX.Element {
    const title_x:number = props.$plot_width.value / 2;
    return <>
    {props.$title != null
        ? <text
            x = {title_x}
            y = {-8}
            text-anchor = 'middle'
            font-size   = '12px'
            font-family = 'sans-serif'
        >
            {props.$title}
        </text>
        : null
    }
    </>
}


export function PlotXAxisLabel(props: {
    text?:        string,
    $plot_width:  Readonly<Signal<number>>,
    $plot_height: Readonly<Signal<number>>,
}): JSX.Element {
    const label_x: number = props.$plot_width.value / 2
    const label_y: number = props.$plot_height.value + 32
    return <text
        x = {label_x}
        y = {label_y}
        text-anchor = 'middle'
        font-size   = '11px'
        font-family = 'sans-serif'
    >
        { props.text }
    </text>
}

export function PlotYAxisLabel(props: {
    text?:        string,
    $plot_height: Readonly<Signal<number>>,
}): JSX.Element {
    const label_x: number = -props.$plot_height.value / 2
    return <text
        x = {label_x}
        y = {-46}
        transform   = 'rotate(-90)'
        text-anchor = 'middle'
        font-size   = '11px'
        font-family = 'sans-serif'
    >
        { props.text }
    </text>    
}

