import { Request, Response, NextFunction } from "express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { buildResponse } from "../../base/utility/express"
import path from "path"

export type RequestParams = {
    fileName:string
}

export type RequestBody = {}

export type RequestQuery = {}

const downloadFolderPath = "/home/user/downloads"

export async function download(
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
        // Sanitize and validate the filename to prevent path traversal
        const sanitizedFileName = path.basename(req.params.fileName);
        const filePath = path.join(downloadFolderPath, sanitizedFileName);
        
        // Verify the final path is within the downloads directory
        const normalizedPath = path.normalize(filePath);
        if (!normalizedPath.startsWith(path.normalize(downloadFolderPath))) {
            return res.status(400).json({ error: 'Invalid file path' });
        }
        
        res.sendFile(normalizedPath, async (error) => {
            if(error) {
                next(
                    await buildResponse(404, {
                        code: "FILE_NOT_FOUND",
                        message: "The requested file does not exists."
                    })
                )

                return
            }
        })
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}