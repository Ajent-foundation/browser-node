import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"
import { dataCollector } from "../../services/dataCollector";

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    scrollBy: z.number(),
    direction: z.enum(['up', 'down']).optional()
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function scroll(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    if (!memory) {
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
        const { scrollBy, direction } = RequestBodySchema.parse(req.body)
        
        // Record scroll action if data collection is enabled
        if (memory.recordData && dataCollector.isActive()) {
            dataCollector.recordScroll({ scrollBy, direction });
        }
        
        const scrollDirection = direction === 'up' ? '4' : '5' // 4 for up, 5 for down

        // 1 Scroll = 120 px of change
        const scrollAmount = Math.abs(scrollBy)/120
        await new Promise((resolve, reject) => {
            exec(`xdotool click --repeat ${scrollAmount} ${scrollDirection}`, (error) => {
                if (error) reject(error)
                resolve(true)
            })
        })

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