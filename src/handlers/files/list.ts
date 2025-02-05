import { Request, Response, NextFunction } from "express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { buildResponse } from "../../base/utility/express"
import { listALLFiles } from "../../db/modules/files"
import { LOGGER } from "../../base/logger"
import { init } from "../../db"
import fs from "fs"
import path from "path"
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({});

export const RequestQuerySchema = z.object({
    type: z.enum(["download", "upload"]).optional().default("download")
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

const downloadFolderPath = "/home/user/downloads"
const uploadFolderPath = "/home/user/uploads"

export async function list(
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
        if(!req.query.type){
            req.query.type = "download"
        } 
        
        if(req.query.type = "upload") {
            const db = init()
            const files = await listALLFiles(db)

            const fileNames: string[] = []
            for (const file of files){
                fileNames.push(file.fileID)
            }

            next(
                await buildResponse(200, {
                    files: fileNames
                })
            )
            return
        }

        try {
            const defaultPath = req.query.type === "download" ? downloadFolderPath : uploadFolderPath

            const f = []
            const files = fs.readdirSync(defaultPath)
            for (const file of files) {
                const filePath = path.join(defaultPath, file)
                const fileStat = fs.statSync(filePath)

                if (fileStat.isDirectory()) {
                    continue
                }

                f.push(file)
            }

            next(
                await buildResponse(200, {
                    files: f
                })
            )
        } catch (error) {
            LOGGER.error(
                `Error listing files`,
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
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}