import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"
import { promisify } from 'util';
import { dataCollector } from "../../services/dataCollector";

const execAsync = promisify(exec);

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    click: z.enum(['left', 'right', 'middle']).optional(),
    doubleClick: z.boolean().optional().default(false),
    move: z.boolean().optional(),
    action: z.enum(['mousedown', 'mouseup']).optional(),
    button: z.enum(['left', 'right', 'middle']).optional()
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
        try {
            const { x, y, click, doubleClick, move, action, button } = RequestBodySchema.parse(req.body);
            
            // Record mouse action if data collection is enabled
            if (memory.recordData && dataCollector.isActive()) {
                dataCollector.recordMouse({ x, y, click, doubleClick, move, action, button });
            }
            
            // Move mouse if requested
            if (move && typeof x === 'number' && typeof y === 'number') {
                await execAsync(`xdotool mousemove ${x} ${y}`);
            }

            // Handle mouse button actions (mousedown/mouseup for holding buttons)
            if (action) {
                const buttonMap = {
                    left: 1,
                    right: 3,
                    middle: 2
                };
                
                // Determine which button to use
                // Use 'button' parameter if provided, otherwise 'click', otherwise default to left
                const buttonName = button || click || 'left';
                const buttonNum = buttonMap[buttonName];
                
                await execAsync(`xdotool ${action} ${buttonNum}`);
            }

            // Handle click (atomic click - press and release)
            if (click && !action) {
                const button = {
                    left: 1,
                    right: 3,
                    middle: 2
                }[click];

                if (doubleClick) {
                    // Double click: click twice with small delay
                    await execAsync(`xdotool click ${button}`);
                    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between clicks
                    await execAsync(`xdotool click ${button}`);
                } else {
                    await execAsync(`xdotool click ${button}`);
                }
            }
            
            next(
                await buildResponse(200, {})
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