export type ResponseType = {
    status: number,
    body: any
}

export interface IError {
    code: string,
    message: string
}

export async function buildResponse<T>(status:number, requestBody:T): Promise<ResponseType> {
    return {
        status: status,
        body: requestBody
    }
}
