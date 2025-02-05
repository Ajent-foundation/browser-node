import { Request, Response, NextFunction } from "express"
import { LOGGER } from "../../base/logger"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { freeBrowser } from "../../actions/browser"
import { gracefulShutdown } from "../../actions"
import { buildResponse } from "../../base/utility/express"

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

export async function free(
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

	LOGGER.info(
		"Freeing up browser",
		{
			browserID: memory.browserID,
		}
	)
  
	// Kill the running browser process
	if (memory.isRunning && memory.instance) {
		next(
			await buildResponse(200, {})
		)
		
		const isSuccess = await freeBrowser()
		if(!isSuccess) {
			next(
				await buildResponse(400, {
					code: "BROWSER_ERROR",
					message: "Failed to close browser"
				})
			)

			setImmediate(async () => {
				await gracefulShutdown("exit", null, true)
			})
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