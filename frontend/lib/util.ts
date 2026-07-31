
export function is_deno(): boolean {
    return (self.Deno != undefined);
}


/** fetch() that returns an error if it doesn't succeed (also on 404) */
export async function fetch_no_throw(...x: Parameters<typeof fetch>): Promise<Response|Error> {
    let response: Response;
    try {
        response = await fetch(...x)
    } catch (error) {
        return error as Error;
    }

    if(!response.ok) {
        return new Error(response.statusText)
    }
    return response;
}



export function strftime_UTC(fmt:string, d:Date){
    const z = (n:number) => String(n).padStart(2,'0');
    const map:Record<string, string> = {
        '%Y': String(d.getUTCFullYear()),
        '%m': z(d.getUTCMonth()+1),
        '%d': z(d.getUTCDate()),
        '%H': z(d.getUTCHours()),
        '%M': z(d.getUTCMinutes()),
        '%S': z(d.getUTCSeconds()),
    };
    return fmt.replace(/%[YmdHMS]/g, (m:string) => map[m] ?? m);
}


export function strftime_ISO8601_datetime(d:Date) {
    return strftime_UTC('%Y-%m-%dT%H:%M:%S', d)
}

export function strftime_ISO8601_time(d:Date) {
    return strftime_UTC('%H:%M:%S', d)
}



type NumberArray = number[] | Uint8Array | Float32Array;

export function find_first_above(values:NumberArray, threshold:number): number|null {
    for(let i: number = 0; i < values.length; i++)
        if(values[i]! > threshold)
            return i;
    // none found
    return null;
}

export function find_last_below(values:NumberArray, threshold:number): number|null {
    for(let i: number = values.length - 1; i >= 0; i--)
        if(values[i]! < threshold)
            return i;
    // none found
    return null;
}
