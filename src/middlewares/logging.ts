import { Request, Response, NextFunction } from "express"
import { v4 as uuidv4 } from "uuid"
import { LOGGER } from "../base/logger"
import { coreVars, podVars } from "../base/env"
import { ResponseType } from "../base/utility/express"
import { ERR_HANDLER } from "./generics"

export async function preRequest(req:Request, res:Response, next:NextFunction) {
    const requestId = uuidv4()
    const startTime = Date.now()

    res.locals.httpInfo = {
        url: req.url,
        method:  req.method,
        status_code: 0,
        request_id: requestId,
    }

    res.locals.requestInfo = {
        startTime: startTime
    }

    LOGGER.info(
        "Received request",
        {
            serviceName: coreVars.getServiceName(),
            deployment: coreVars.getDeployment(),
            podName: podVars.getPodName(),
            podNameSpace: podVars.getNameSpace(),
            nodeIP: podVars.getPodIP(),
            httpInfo: res.locals.httpInfo,
            startTime: startTime
        }
    )

    next()
}

export async function postRequest(data:ResponseType, req:Request, res:Response, next:NextFunction) {
    const endTime = Date.now()

    // Log the result
    res.locals.httpInfo.status_code = data.status
    LOGGER.info(
        "Completed request",
        {
            serviceName: coreVars.getServiceName(),
            deployment: coreVars.getDeployment(),
            podName: podVars.getPodName(),
            podNameSpace: podVars.getNameSpace(),
            nodeIP: podVars.getPodIP(),
            httpInfo: res.locals.httpInfo,
            startTime: res.locals.requestInfo.startTime,
            endTime: endTime,
            millis: endTime - res.locals.requestInfo.startTime
        }
    )

    // Decide what to send
    if(data && data.status){
        res.setHeader("Content-Type", "application/json")
        res.status(data.status).send(data.body)
    }
    else {
        ERR_HANDLER(data, req, res, next)
    }
}

export async function respond(data:ResponseType, req:Request, res:Response, next:NextFunction) {
    // Decide what to send
    if(data && data.status){
        res.setHeader('Content-Type', 'application/json')
        res.status(data.status).send(data.body)
    }
    else {
        ERR_HANDLER(data, req, res, next)
    }
}