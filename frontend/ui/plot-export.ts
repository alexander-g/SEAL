type Size = {
    width: number
    height: number
}

type Point = {
    x: number
    y: number
}

export type StackedExportLayout = {
    width:   number
    height:  number
    offsets: Point[]
}

/** Export the provided visible SVG nodes as one stacked PNG file. */
export async function export_visible_svgs_to_png(
    svg_elements: SVGSVGElement[],
    filename:     string,
): Promise<File | Error> {
    const sizes: Size[] | Error = compute_svg_sizes(svg_elements)
    if(sizes instanceof Error)
        return sizes

    const layout: StackedExportLayout | Error =
        compute_stacked_export_layout(sizes)
    if(layout instanceof Error)
        return layout

    const canvas: HTMLCanvasElement = document.createElement('canvas')
    const device_pixel_ratio: number = 
        normalize_device_pixel_ratio(window.devicePixelRatio)
    canvas.width  = Math.max(1, Math.round(layout.width  * device_pixel_ratio))
    canvas.height = Math.max(1, Math.round(layout.height * device_pixel_ratio))

    const context: CanvasRenderingContext2D | null = canvas.getContext('2d')
    if(context == null)
        return new Error('Could not initialize canvas context')

    context.setTransform(device_pixel_ratio, 0, 0, device_pixel_ratio, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, layout.width, layout.height)

    for(let index: number = 0; index < svg_elements.length; index++) {
        const svg_element: SVGSVGElement = svg_elements[index]!
        const size: Size = sizes[index]!
        const offset: Point = layout.offsets[index]!

        const draw_result: null | Error = await draw_svg_to_canvas(
            context,
            svg_element,
            size,
            offset,
        )
        if(draw_result instanceof Error)
            return draw_result
    }

    const blob: Blob | Error = await create_png_blob(canvas)
    if(blob instanceof Error)
        return blob

    return new File([blob], filename, { type: 'image/png' })
}

/** Build a deterministic export filename for rendered plots. */
export function format_png_export_filename(
    timestamp: string,
    code:      string,
    suffix:    string,
): string {
    const safe_code: string = code.trim().replace(/\s+/g, '_')
    return `${timestamp}-${safe_code}-${suffix}.png`
}

/** Clamp export scale to a valid device-pixel ratio. */
export function normalize_device_pixel_ratio(
    device_pixel_ratio: number | undefined,
): number {
    if(device_pixel_ratio == undefined)
        return 1
    if(!Number.isFinite(device_pixel_ratio))
        return 1

    return Math.max(device_pixel_ratio, 1)
}

/** Create a top-to-bottom stacking layout for image export. */
export function compute_stacked_export_layout(
    sizes: Size[],
): StackedExportLayout | Error {
    if(sizes.length == 0)
        return new Error('No SVG elements to export')

    let width: number = 0
    let height: number = 0
    const offsets: Point[] = []

    for(const size of sizes) {
        width = Math.max(width, size.width)
        offsets.push({ x: 0, y: height })
        height += size.height
    }

    if(width <= 0 || height <= 0)
        return new Error('Invalid SVG export dimensions')

    return { width, height, offsets }
}

/** Trigger a browser download for a File. */
export function trigger_file_download(file: File): void {
    const file_url: string = URL.createObjectURL(file)
    const anchor: HTMLAnchorElement = document.createElement('a')
    anchor.href = file_url
    anchor.download = file.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(file_url)
}

function compute_svg_sizes(svg_elements: SVGSVGElement[]): Size[] | Error {
    if(svg_elements.length == 0)
        return new Error('No SVG elements to export')

    const sizes: Size[] = []
    for(const svg_element of svg_elements) {
        const rect: DOMRect = svg_element.getBoundingClientRect()
        const width: number = Math.max(1, Math.round(rect.width))
        const height: number = Math.max(1, Math.round(rect.height))
        if(width <= 0 || height <= 0)
            return new Error('Invalid SVG export dimensions')

        sizes.push({ width, height })
    }

    return sizes
}

async function draw_svg_to_canvas(
    context:     CanvasRenderingContext2D,
    svg_element: SVGSVGElement,
    size:        Size,
    offset:      Point,
): Promise<null | Error> {
    const image: HTMLImageElement | Error = await render_svg_to_image(
        svg_element,
        size,
    )
    if(image instanceof Error)
        return image

    context.drawImage(image, offset.x, offset.y, size.width, size.height)
    return null
}

async function render_svg_to_image(
    svg_element: SVGSVGElement,
    size:        Size,
): Promise<HTMLImageElement | Error> {
    const cloned: SVGSVGElement = svg_element.cloneNode(true) as SVGSVGElement
    const inline_result: null | Error = await inline_embedded_images(cloned)
    if(inline_result instanceof Error)
        return inline_result

    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    cloned.setAttribute('width', `${size.width}`)
    cloned.setAttribute('height', `${size.height}`)

    const serializer: XMLSerializer = new XMLSerializer()
    const svg_markup: string = serializer.serializeToString(cloned)
    const svg_blob: Blob = new Blob([svg_markup], {
        type: 'image/svg+xml;charset=utf-8',
    })
    const svg_url: string = URL.createObjectURL(svg_blob)

    const image: HTMLImageElement | Error = await load_image(svg_url)
    URL.revokeObjectURL(svg_url)
    return image
}

async function load_image(url: string): Promise<HTMLImageElement | Error> {
    return await new Promise((resolve) => {
        const image: HTMLImageElement = new Image()

        image.onload = () => resolve(image)
        image.onerror = () =>
            resolve(new Error('Could not render SVG for export'))

        image.src = url
    })
}

async function inline_embedded_images(
    svg_element: SVGSVGElement,
): Promise<null | Error> {
    const image_elements: SVGImageElement[] = Array.from(
        svg_element.querySelectorAll('image')
    )

    for(const image_element of image_elements) {
        const href: string | null = read_image_href(image_element)
        if(href == null)
            continue
        if(href.startsWith('data:'))
            continue

        const data_url: string | Error = await fetch_url_as_data_url(href)
        if(data_url instanceof Error)
            return data_url

        image_element.setAttribute('href', data_url)
        image_element.setAttributeNS(
            'http://www.w3.org/1999/xlink',
            'xlink:href',
            data_url,
        )
    }

    return null
}

function read_image_href(image_element: SVGImageElement): string | null {
    const href_attr: string | null = image_element.getAttribute('href')
    if(href_attr != null && href_attr.trim().length > 0)
        return href_attr

    const xlink_href_attr: string | null = image_element.getAttributeNS(
        'http://www.w3.org/1999/xlink',
        'href',
    )
    if(xlink_href_attr != null && xlink_href_attr.trim().length > 0)
        return xlink_href_attr

    return null
}

async function fetch_url_as_data_url(url: string): Promise<string | Error> {
    try {
        const response: Response = await fetch(url)
        if(!response.ok)
            return new Error('Could not load embedded image for export')

        const blob: Blob = await response.blob()
        const data_url: string | Error = await blob_to_data_url(blob)
        return data_url
    } catch {
        return new Error('Could not load embedded image for export')
    }
}

async function blob_to_data_url(blob: Blob): Promise<string | Error> {
    return await new Promise((resolve) => {
        const reader: FileReader = new FileReader()
        reader.onload = () => {
            const output: string | ArrayBuffer | null = reader.result
            if(typeof output != 'string') {
                resolve(new Error('Could not prepare embedded image for export'))
                return
            }
            resolve(output)
        }
        reader.onerror = () =>
            resolve(new Error('Could not prepare embedded image for export'))
        reader.readAsDataURL(blob)
    })
}

async function create_png_blob(canvas: HTMLCanvasElement): Promise<Blob|Error> {
    return await new Promise((resolve) => {
        canvas.toBlob((blob: Blob | null) => {
            if(blob == null) {
                resolve(new Error('Could not encode PNG'))
                return
            }
            resolve(blob)
        }, 'image/png')
    })
}
