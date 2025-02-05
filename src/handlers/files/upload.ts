import { Request, Response, NextFunction } from "express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { buildResponse } from "../../base/utility/express"
import { LOGGER } from "../../base/logger"
import { init } from "../../db"
import { insertFile } from "../../db/modules/files"

export type RequestParams = {
}

export type RequestBody = {}

export type RequestQuery = {}

export async function preUpload(
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
        next()
    } else {
        next( 
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}

export async function upload(
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
    if (!memory.isRunning) {
        next( 
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
        return
    }

    if(!req.file) {
        next(
            await buildResponse(400, {
                code: "MISSING_FILE_NAME",
                message: "The file name is required."
            })
        )

        return
    }

    LOGGER.info(
        `File uploaded`,
        {
            file: req.file
        }
    )

    const db = init()
    try {
        const fileToInsert = {
            fileID: req.file.filename,
            name: req.file.originalname,
            path: req.file.path
        }

        await insertFile(db, fileToInsert)
        next(
            await buildResponse(200, {
                fileName: fileToInsert.fileID
            })
        )
    } catch (error) {
        LOGGER.error(
            `Error inserting file into database`,
            {
                error: error
            }
        )

        next(
            await buildResponse(500, {
                code: "INTERNAL_SERVER_ERROR",
                message: "An internal server error occurred."
            })
        )
    }
}