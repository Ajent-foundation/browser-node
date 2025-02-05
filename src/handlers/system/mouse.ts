import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    click: z.enum(['left', 'right', 'middle']).optional(),
    move: z.boolean().optional()
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function mouse(
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
        const { x, y, click, move } = req.body
        if (move && typeof x === 'number' && typeof y === 'number') {
            await new Promise((resolve, reject) => {
                exec(`xdotool mousemove ${x} ${y}`, (error) => {
                    if (error) reject(error)
                    resolve(true)
                })
            })
        }

        if (click) {
            const button = {
                left: 1,
                right: 3,
                middle: 2
            }[click]

            await new Promise((resolve, reject) => {
                exec(`xdotool click ${button}`, (error) => {
                    if (error) reject(error)
                    resolve(true)
                })
            })
        }
        
        next(
            await buildResponse(200, {})
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