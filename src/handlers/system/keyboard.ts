import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    key: z.string().optional(),
    text: z.string().optional(),
    modifiers: z.array(
        z.enum(['ctrl', 'alt', 'shift', 'super'])
    ).optional(),
    type: z.enum(['keydown', 'keyup', 'type']).optional().default('type')
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function keyboard(
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
        const { key, text, modifiers = [], type = 'type' } = req.body
        if (text) {
            // Type text directly
            await new Promise((resolve, reject) => {
                exec(`xdotool type "${text}"`, (error) => {
                    if (error) reject(error)
                    resolve(true)
                })
            })
        } else if (key) {
            let command = 'xdotool '
            
            // Add modifiers if present
            if (modifiers.length > 0) {
                if (type === 'type') {
                    // For key combinations (e.g., Ctrl+C)
                    command += `key ${modifiers.join('+')}+${key}`
                } else {
                    // For key down/up events
                    command += `${type === 'keydown' ? 'keydown' : 'keyup'} ${modifiers.join(' ')} ${key}`
                }
            } else {
                // Single key
                if (type === 'type') {
                    command += `key ${key}`
                } else {
                    command += `${type === 'keydown' ? 'keydown' : 'keyup'} ${key}`
                }
            }

            await new Promise((resolve, reject) => {
                exec(command, (error) => {
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