import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"
import { promisify } from 'util';
import { dataCollector } from "../../services/dataCollector";

const execAsync = promisify(exec);

// Point in the path
const PointSchema = z.object({
    x: z.number(),
    y: z.number(),
});

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    // Array of points to follow
    points: z.array(PointSchema).min(2),
    // Total duration to play back the path in ms (optional)
    duration: z.number().optional().default(1000),
    // Whether to click at the end
    clickAtEnd: z.boolean().optional().default(false),
    // Button to click if clickAtEnd is true
    button: z.enum(['left', 'right', 'middle']).optional().default('left'),
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

/**
 * Replay a path by moving the mouse through a series of points.
 * The movement is evenly distributed over the specified duration.
 */
export async function path(
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
        try {
            const { points, duration, clickAtEnd, button } = RequestBodySchema.parse(req.body);
            
            // Record path action if data collection is enabled
            if (memory.recordData && dataCollector.isActive()) {
                dataCollector.recordMouse({ 
                    x: points[points.length - 1].x, 
                    y: points[points.length - 1].y, 
                    move: true 
                });
            }
            
            // Calculate delay between points
            const stepDelay = Math.max(1, Math.floor(duration / (points.length - 1)));
            
            // Move through all points
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                await execAsync(`xdotool mousemove ${Math.round(point.x)} ${Math.round(point.y)}`);
                
                // Delay between steps (except for last point)
                if (i < points.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, stepDelay));
                }
            }
            
            // Click at end if requested
            if (clickAtEnd) {
                const buttonNum = {
                    left: 1,
                    right: 3,
                    middle: 2
                }[button];
                await execAsync(`xdotool click ${buttonNum}`);
            }
            
            next(
                await buildResponse(200, {
                    pointsTraversed: points.length,
                    duration,
                })
            )
        } catch (error) {
            next(
                await buildResponse(400, {
                    code: "INVALID_INPUT",
                    message: error instanceof Error ? error.message : 'Unknown error'
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
