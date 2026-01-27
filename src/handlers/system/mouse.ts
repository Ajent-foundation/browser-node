import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';
import { z } from "zod"
import { promisify } from 'util';
import { dataCollector } from "../../services/dataCollector";
import { planMovement, MovementProfile, PROFILES } from "../../services/humanMouse";

const execAsync = promisify(exec);

// Movement profile schema for fine-tuning
const MovementProfileSchema = z.object({
    speed: z.number().min(0.1).max(5).optional(),
    spread: z.number().min(2).max(200).optional(),
    overshootThreshold: z.number().min(0).optional(),
    overshootRadius: z.number().min(0).optional(),
    minSteps: z.number().min(5).optional(),
    jitter: z.boolean().optional(),
    jitterIntensity: z.number().min(0).max(5).optional(),
}).optional();

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    click: z.enum(['left', 'right', 'middle']).optional(),
    doubleClick: z.boolean().optional().default(false),
    move: z.boolean().optional(),
    action: z.enum(['mousedown', 'mouseup']).optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    // New: human-like movement options
    humanLike: z.boolean().optional().default(false),
    profile: MovementProfileSchema,
    preset: z.enum(['normal', 'fast', 'slow', 'hesitant', 'precise']).optional(),
    duration: z.number().optional().default(100), // Duration for move in ms (fast default)
    // Starting position for human-like movement (if not provided, gets current mouse position)
    fromX: z.number().optional(),
    fromY: z.number().optional(),
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

/**
 * Get current mouse position using xdotool
 */
async function getCurrentMousePosition(): Promise<{ x: number; y: number }> {
    const { stdout } = await execAsync('xdotool getmouselocation --shell');
    const lines = stdout.split('\n');
    let x = 0, y = 0;
    for (const line of lines) {
        const match = line.match(/(\w+)=(\d+)/);
        if (match) {
            const key = match[1].toLowerCase();
            const value = parseInt(match[2], 10);
            if (key === 'x') x = value;
            if (key === 'y') y = value;
        }
    }
    return { x, y };
}

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
            const { 
                x, y, click, doubleClick, move, action, button,
                humanLike, profile, preset, duration, fromX, fromY
            } = RequestBodySchema.parse(req.body);
            
            // Record mouse action if data collection is enabled
            if (memory.recordData && dataCollector.isActive()) {
                dataCollector.recordMouse({ x, y, click, doubleClick, move, action, button });
            }
            
            // Move mouse if requested
            if (move && typeof x === 'number' && typeof y === 'number') {
                if (humanLike) {
                    // Get starting position
                    let startX = fromX;
                    let startY = fromY;
                    
                    if (startX === undefined || startY === undefined) {
                        const currentPos = await getCurrentMousePosition();
                        startX = startX ?? currentPos.x;
                        startY = startY ?? currentPos.y;
                    }

                    // Build movement profile
                    let movementProfile: MovementProfile | undefined;
                    if (preset && PROFILES[preset]) {
                        movementProfile = { ...PROFILES[preset], ...profile };
                    } else if (profile) {
                        movementProfile = profile;
                    }

                    // Plan the movement path
                    const { path, stepDelay } = planMovement(
                        { x: startX, y: startY },
                        { x, y },
                        {
                            humanLike: true,
                            profile: movementProfile,
                            duration,
                        }
                    );

                    // Move through all points in the path
                    for (let i = 0; i < path.length; i++) {
                        const point = path[i];
                        await execAsync(`xdotool mousemove ${point.x} ${point.y}`);
                        
                        // Delay between steps (except for last point)
                        if (i < path.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, Math.max(1, stepDelay)));
                        }
                    }
                } else {
                    // Direct movement (instant)
                    await execAsync(`xdotool mousemove ${x} ${y}`);
                }
            }

            // Handle mouse button actions (mousedown/mouseup for holding buttons)
            if (action) {
                const buttonMap = {
                    left: 1,
                    right: 3,
                    middle: 2
                };
                
                // Determine which button to use
                const buttonName = button || click || 'left';
                const buttonNum = buttonMap[buttonName];
                
                await execAsync(`xdotool ${action} ${buttonNum}`);
            }

            // Handle click (atomic click - press and release)
            if (click && !action) {
                const buttonNum = {
                    left: 1,
                    right: 3,
                    middle: 2
                }[click];

                if (doubleClick) {
                    // Double click: click twice with small delay
                    await execAsync(`xdotool click ${buttonNum}`);
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await execAsync(`xdotool click ${buttonNum}`);
                } else {
                    await execAsync(`xdotool click ${buttonNum}`);
                }
            }
            
            next(
                await buildResponse(200, {
                    humanLike: move ? humanLike : undefined,
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
