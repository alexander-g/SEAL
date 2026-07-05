import { 
    parse, 
    type XmlDocument,
    type XmlElement,
    type XmlNode,
} from "xml"



export type Station = {
    code:      string,
    latitude:  number,
    longitude: number,

    channels?: Channel[],
}


type Channel = {
    /** Channel name */
    code:        string;

    /** Location code */
    location:    string;

    /** Instrument response */
    response?:   Response;
}

type Response = {
    /** Physical unit of the channel, e.g `m/s` for velocity */
    input_unit:  string;

    /** Unit of the raw data signal, usually `counts` */
    output_unit: string;

    /** Conversion scale factor from input to output unit */
    sensitivity: number;
}




/** Parse a stationxml file. Version: `1.2` 
 *  http://www.fdsn.org/xml/station/fdsn-station-1.2.xsd */
export async function parse_stationxml_file(file:File): Promise<Station[]|Error> {
    try {
        if(!is_probably_xml_file(file))
            return new Error('File is not in XML format')

        const text:string = await file.text()
        const xml:XmlDocument = parse(text);

        if(xml.root.name.local != 'FDSNStationXML')
            return new Error('Not a STATIONXML file')

        const all_stations:Station[] = []
        for(const child of xml.root.children) {
            if(child.type == 'element' && child.name.local == 'Network')
                for(const subchild of child.children)
                    if(subchild.type == 'element' && subchild.name.local == 'Station'){
                        const station:Station|Error = parse_station_element(subchild)
                        if(station instanceof Error)
                            return new Error(`Invalid STATIONXML: ${station.message}`)
                    
                        all_stations.push(station)
                    }
        }
        
        return all_stations;
    }
    catch (e) {
        return e as Error;
    }
}

/** Quick check if a file is XML without reading the full file. */
export async function is_probably_xml_file(f:File): Promise<boolean> {
    const blob:Blob = f.slice(0, 256);
    const text:string = 
        (await blob
            .text()
            .catch(() => ''))
            .replace(/^\uFEFF/, '')
            .trimStart()
            .toLowerCase();

    return text.startsWith('<?xml');
}


function parse_station_element(element:XmlElement): Station|Error {
    if(element.name.local != 'Station')
        return new Error('Not a <Station> element')

    const code:string|undefined = element.attributes['code']
    if(code == undefined)
        return new Error('<Station> element has no "code" attribute')

    let latitude:number|null = null;
    let longitude:number|null = null;
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == 'Latitude') {
            if(latitude != null)
                return new Error('Multiple <Latitude> in a <Station> element')

            if(child.children.length != 1 || child.children[0]!.type != 'text')
                return new Error('<Latitude> element misformed.')

            latitude = Number(child.children[0]?.text);
            if(isNaN(latitude))
                return new Error('<Latitude> element contains invalid value')
        }

        if(child.type == 'element' && child.name.local == 'Longitude') {
            if(longitude != null)
                return new Error('Multiple <Longitude> in a <Station> element')

            if(child.children.length != 1 || child.children[0]!.type != 'text')
                return new Error('<Longitude> element misformed.')

            longitude = Number(child.children[0]?.text);
            if(isNaN(longitude))
                return new Error('<Longitude> element contains invalid value')
        }
    }
    if(longitude == null)
        return new Error('<Station> does not contain a <Longitude>')
    if(latitude == null)
        return new Error('<Station> does not contain a <Latitude>')

    const channels:Channel[] = []
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == 'Channel') {
            const channel:Channel|Error = parse_channel_element(child)
            if(channel instanceof Error)
                return channel

            channels.push(channel)
        }
    }

    const station:Station = {code, longitude, latitude}
    if(channels.length > 0)
        station.channels = channels

    return station
}


function parse_channel_element(element:XmlElement): Channel|Error {
    if(element.name.local != 'Channel')
        return new Error('Not a <Channel> element')

    const code:string|undefined = element.attributes['code']
    if(code == undefined)
        return new Error('<Channel> element has no "code" attribute')

    const location:string|undefined = element.attributes['locationCode']
    if(location == undefined)
        return new Error('<Channel> element has no "locationCode" attribute')

    let response:Response|undefined = undefined
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == 'Response') {
            if(response != undefined)
                return new Error('Multiple <Response> in a <Channel> element')

            const parsed_response:Response|Error = parse_response_element(child)
            if(parsed_response instanceof Error)
                return parsed_response

            response = parsed_response
        }
    }

    if(response == undefined)
        return {code, location}

    return {code, location, response}
}


function parse_response_element(element:XmlElement): Response|Error {
    if(element.name.local != 'Response')
        return new Error('Not a <Response> element')

    let instrument_sensitivity:XmlElement|null = null
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == 'InstrumentSensitivity') {
            if(instrument_sensitivity != null)
                return new Error('Multiple <InstrumentSensitivity> in a <Response> element')

            instrument_sensitivity = child
        }
    }

    if(instrument_sensitivity == null)
        return new Error('<Response> does not contain <InstrumentSensitivity>')

    const sensitivity:number|Error = parse_instrument_sensitivity_value(instrument_sensitivity)
    if(sensitivity instanceof Error)
        return sensitivity

    const input_unit:string|Error = parse_unit_name(instrument_sensitivity, 'InputUnits')
    if(input_unit instanceof Error)
        return input_unit

    const output_unit:string|Error = parse_unit_name(instrument_sensitivity, 'OutputUnits')
    if(output_unit instanceof Error)
        return output_unit

    return {input_unit, output_unit, sensitivity}
}


function parse_instrument_sensitivity_value(
    element:XmlElement,
): number|Error {
    let value_text:string|null = null
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == 'Value') {
            if(value_text != null)
                return new Error('Multiple <Value> in <InstrumentSensitivity> element')

            const child_text:string|Error = parse_element_text(child)
            if(child_text instanceof Error)
                return child_text

            value_text = child_text
        }
    }

    if(value_text == null)
        return new Error('<InstrumentSensitivity> does not contain <Value>')

    const sensitivity:number = Number(value_text)
    if(isNaN(sensitivity))
        return new Error('<Value> in <InstrumentSensitivity> is invalid')

    return sensitivity
}


function parse_unit_name(
    element:  XmlElement,
    unit_tag: 'InputUnits'|'OutputUnits',
): string|Error {
    let unit_element:XmlElement|null = null
    for(const child of element.children) {
        if(child.type == 'element' && child.name.local == unit_tag) {
            if(unit_element != null)
                return new Error(`Multiple <${unit_tag}> in <InstrumentSensitivity> element`)

            unit_element = child
        }
    }

    if(unit_element == null)
        return new Error(`<InstrumentSensitivity> does not contain <${unit_tag}>`)

    let unit_name:string|null = null
    for(const child of unit_element.children) {
        if(child.type == 'element' && child.name.local == 'Name') {
            if(unit_name != null)
                return new Error(`Multiple <Name> in <${unit_tag}> element`)

            const child_text:string|Error = parse_element_text(child)
            if(child_text instanceof Error)
                return child_text

            unit_name = child_text
        }
    }

    if(unit_name == null)
        return new Error(`<${unit_tag}> does not contain <Name>`)

    return unit_name
}


function parse_element_text(element:XmlElement): string|Error {
    const first_child: XmlNode|undefined = element.children[0]
    if(element.children.length != 1 || first_child == undefined ||
       first_child.type != 'text')
        return new Error(`<${element.name.local}> element misformed.`)

    return first_child.text
}
