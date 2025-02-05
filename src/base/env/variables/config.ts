export function getDelayTime(): number {
    let value = process.env.DELAY_TIME
    if (!value) value = "0"

    return parseInt(value)
}

export function getTryLimit(): number {
    let value = process.env.TRY_LIMIT
    if (!value) value = "0"

    return parseInt(value)
}

export function getTryDelayTime(): number {
    let value = process.env.TRY_LIMIT
    if (!value) value = "0"

    return parseInt(value)
}