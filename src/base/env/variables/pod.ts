export function getPodName() : string {
    let podName = process.env.POD_NAME || process.env.PORTER_POD_NAME
    if(!podName) podName = ""
    return podName
}

export function getNameSpace() : string {
    let value = process.env.POD_NAMESPACE
    if(!value) value = "default"
    return value
}

export function getPodIP(): string {
    let value = process.env.POD_IP || process.env.PORTER_POD_IP
    if (!value) value = "127.0.0.1"

    return value
}