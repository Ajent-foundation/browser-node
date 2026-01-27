import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { exec } from 'child_process';
import { readFile, unlink } from 'fs/promises';  
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    quality: z.number().optional()
});

export const RequestQuerySchema = z.object({
    quality: z.string().optional() // Accept quality as query param (from scraper-service)
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function screenshot(
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
        const bodyParams = RequestBodySchema.parse(req.body)
        const queryParams = RequestQuerySchema.parse(req.query)
        // Support quality from both body and query (query from scraper-service)
        const quality = bodyParams.quality ?? (queryParams.quality ? parseInt(queryParams.quality, 10) : undefined)
        const tempPath = `/tmp/screenshot_${Date.now()}.jpg`;

        try {
            await new Promise((resolve, reject) => {
                exec(`scrot -q ${quality ? quality : 50} -f ${tempPath}`, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(true);
                    }
                });
            });

            // Read the file and convert to base64
            const imageBuffer = await readFile(tempPath);
            const base64Image = imageBuffer.toString('base64');

            // Delete the temporary file
            await unlink(tempPath);

            next(
                await buildResponse(200, {
                    image: `data:image/jpeg;base64,${base64Image}`
                })
            );
        } catch (error) {
            LOGGER.error(
                "Failed to capture screenshot",
                {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                }
            )
            next(
                await buildResponse(500, {
                    code: "SCREENSHOT_FAILED",
                    message: "Failed to capture screenshot",
                })
            );
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