import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { BrowserStorageData, setData } from "../../actions/browser"
import { Cookie } from "../../actions/browser/drivers"
import { LOGGER } from "../../base/logger"
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    cookies: z.custom<Cookie[]>(),
    localStorage: z.custom<BrowserStorageData>(),
    sessionStorage: z.custom<BrowserStorageData>()
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function set(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
	if(!memory) {
		next(
			await buildResponse(400, {
				code: "MEMORY_NOT_FOUND",
				message: "Cache memory not found"
			})
		)

		setImmediate(async () => {
			await gracefulShutdown("exit", null, true)
		})
		return
	}

    if (memory.isRunning) {
        try {
            await setData(req.body.cookies, req.body.localStorage, req.body.sessionStorage) 
            next(
                await buildResponse(200, {})
            )
        } catch (error) {
            LOGGER.error(
                `Failed to set data`,
                {
                    error: error
                }
            )

            next(
                await buildResponse(400, {
                    code: "SET_DATA_FAILED",
                    message: "Failed to set data"
                })
            )
        }
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}