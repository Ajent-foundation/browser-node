import { Request, Response, NextFunction, ErrorRequestHandler } from "express"
import { LOGGER } from "../base/logger"
import { buildResponse, IError } from "../base/utility/express"

export async function NOT_FOUND( req:Request, res:Response, next:NextFunction ){
    const response = (
        await buildResponse<IError>(404,{
            code: "NOT_FOUND",
            message: "The requested resource was not found"
        })
    )
    res.status(response.status).send(response.body)
}

export const ERR_HANDLER: ErrorRequestHandler = (err:any, req:Request, res:Response ) => {
    LOGGER.error(
        "Unknown Error", 
        {
            message: err.message,
            stack: err.stack
        }
    )

    res.status(500).send({
        code: "UNKNOWN_ERROR",
        message: "Unknown Error"
    })
}