import { preact, Signal, JSX } from "../dep.ts"



type OverlayDivProps = {
    children: preact.ComponentChildren;
    $visible: Readonly<Signal<boolean>>;

    opacity?:    number;
    background?: string;
}

export function OverlayDiv(props:OverlayDivProps): JSX.Element {
    return <div
        class = "overlay"
        style = {{
            background:     props.background ?? "honeydew",
            opacity:        props.opacity ?? 0.6,
            position:       "absolute",
            top:            0,
            left:           0,
            width:          "100%",
            height:         "100%",
            display:        (props.$visible.value)? 'flex': 'none',
            justifyContent: 'center',
            alignItems:     'center',
            fontFamily:     'sans-serif',
            pointerEvents:  'none',
        }}
    >
        { props.children }
    </div>
}

