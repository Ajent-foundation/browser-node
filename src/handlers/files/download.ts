import { Request, Response, NextFunction } from "express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { buildResponse } from "../../base/utility/express"
import path from "path"
import { z } from "zod"

export const RequestParamsSchema = z.object({
    fileName: z.string().min(1)
});

export const RequestBodySchema = z.object({});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

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
        const filePath = path.join(downloadFolderPath, req.params.fileName)
        res.sendFile(
            filePath,
            async (error) => {
                if(error) {
                    next(
                        await buildResponse(404, {
                            code: "FILE_NOT_FOUND",
                            message: "The requested file does not exists."
                        })
                    )

                    return
                }
            }
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