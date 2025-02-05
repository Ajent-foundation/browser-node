export function getExpressPort(): number {
    let value = process.env.EXPRESS_PORT
    if (!value) value = "8080"

    return parseInt(value)
}