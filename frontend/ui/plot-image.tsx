import { preact, Signal, signals, JSX } from "../dep.ts"
import { OverlayDiv } from "./overlay-div.tsx"



type PlotImageProps = {
    $is_loading: Readonly<Signal<boolean>>
}

export class PlotImage extends preact.Component<PlotImageProps> {
    img_ref:preact.RefObject<HTMLImageElement> = preact.createRef()

    render(): JSX.Element {
        return <> 
        <ContainerWithOverlay
            $is_loading     = {this.props.$is_loading}
            uninitialized_message = 'Select a MSEED channel and time to plot here.'
        >
            <img 
                ref   = {this.img_ref} 
                style = {{width:'100%', height:'100%', border:"1px gray solid"}} 
            />
        </ContainerWithOverlay>
        </>
    }

    set_src(file:File): void {
        const objurl:string = URL.createObjectURL(file)
        this.img_ref.current?.addEventListener(
            'load',
            () => URL.revokeObjectURL(objurl),
            {once:true}
        )
        this.img_ref.current!.src = objurl;
        // this.$initialized.value = true;
    }
}


type ContainerWithOverlayProps = {
    $is_loading: Readonly<Signal<boolean>>;

    /** Which message to show when `$is_loading` is `true`. 
     *  Default: `"Loading..."` */
    loading_message?: string|Readonly<Signal<string>>;

    /** Message to show until `$is_loading` becomes `true`. 
     *  Won't show if not provided. */
    uninitialized_message?: string;

    children: preact.ComponentChildren;
}


export class ContainerWithOverlay extends preact.Component<ContainerWithOverlayProps> {
    $initialized:Signal<boolean> = 
        new Signal(this.props.uninitialized_message == undefined)

    render(): JSX.Element {
        return <div class='container' style={{position:'relative', width:'100%'}}>
            { this.props.children }

            <OverlayDiv $visible={this.$overlay_on}>
                { this.$overlay_message.value }
            </OverlayDiv>
        </div>
    }

    $overlay_on:Readonly<Signal<boolean>> = signals.computed( () => 
        (!this.$initialized.value) 
        || this.props.$is_loading.value
    )

    $overlay_message: Readonly<Signal<string>> = signals.computed(
        () => this.props.$is_loading.value
            ? resolve_string_or_string_signal(this.props.loading_message ?? 'Loading...')
            : this.props.uninitialized_message ?? ''
    )

    #_1 = this.props.$is_loading.subscribe( (value:boolean) => {
        if(value)
            this.$initialized.value = true;
    } )
}


function resolve_string_or_string_signal(x:string|Readonly<Signal<string>>): string {
    if(typeof x == 'string')
        return x
    else
        return x.value;
}