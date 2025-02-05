import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { extractData } from "../../actions/browser"

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

export async function data(
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
        // Get Pages
        const data = await extractData()
        if(data.length === 0) {
            next(
                await buildResponse(400, {
                    code: "NO_PAGES",
                    message: "No pages found"
                })
            )
            return
        }

        next(
            await buildResponse(200, data[0])
        )
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}