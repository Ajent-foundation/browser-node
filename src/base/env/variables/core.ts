export function getServiceName(): string {
    let value = process.env.SERVICE_NAME
    if (!value) value = ""

    return value
}

export function getDeployment(): string {
    let value = process.env.DEPLOYMENT
    if (!value) value = ""

    return value
}