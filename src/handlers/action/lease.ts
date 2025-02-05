import { Request, Response, NextFunction } from "express"
import { LOGGER } from "../../base/logger"
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache"
import { buildResponse } from "../../base/utility/express"
import { gracefulShutdown } from "../../actions"
import { freeBrowser } from "../../actions/browser"
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    leaseTime: z.number().min(1).max(60).optional()
});

export const RequestQuerySchema = z.object({});

export const ResponseBodySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;
export type ResponseBody = z.infer<typeof ResponseBodySchema>;

let timeoutId: NodeJS.Timeout | null = null

export function scheduleTermination(leaseTime: number) : NodeJS.Timeout | null  {
    if (timeoutId !== null) {
        clearTimeout(timeoutId)
    }

    // Schedule a callback to terminate the browser after the lease time
    timeoutId = setTimeout(
        async () => {
            const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
            if(!memory) {
                setImmediate(async () => {
                    await gracefulShutdown("exit", null, true, "CACHE_MEMORY_NOT_FOUND")
                })
                return
            }

            LOGGER.warn(
                "Lease time expired, freeing browser", 
                { 
                    browserID: memory.browserID 
                }
            )

            if (memory.isRunning && memory.instance) {
                const isSuccess = await freeBrowser()
                if (!isSuccess) {
                    setImmediate(async () => {
                        await gracefulShutdown("exit", null, true, "FREE_BROWSER_FAILED")
                    })
                }
            }
        }, 
        leaseTime * 60 * 1000
    )

    return timeoutId
}

export async function lease(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    // Set Default lease time to 10 minutes
    try {
        RequestBodySchema.parse(req.body)
    
        req.body.leaseTime = req.body.leaseTime || 10
        scheduleTermination(req.body.leaseTime)
        next(
            await buildResponse(200, {})
        )
    } catch(error:unknown) {
        if (error instanceof Error) {
            LOGGER.critical(
                "Error scheduling lease termination", 
                { 
                    message: error.message,
                    stack: error.stack
                }
            )
        }

        next(
            await buildResponse(500, {
                code: "INTERNAL_SERVER_ERROR",
                message: "Internal server error"
            })
        )
    }
}


