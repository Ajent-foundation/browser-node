export function getNodeBrowserPort(): number {
    let value = process.env.NODE_BROWSER_PORT
    if (!value) value = "-1"

    return parseInt(value)
}

export function getNodeVNCPort(): number {
    let value = process.env.NODE_VNC_PORT
    if (!value) value = "-1"

    return parseInt(value)
}