export function getStateMGRUrl(): string {
    let value = process.env.STATE_MGR_URL
    if (!value) value = ""

    return value
}

export function getReportState(): boolean {
    let value = process.env.REPORT_STATE
    if (!value) value = "false"

    return value === "true"
}