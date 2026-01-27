import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
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
	startX: z.number(),
	startY: z.number(),
	endX: z.number(),
	endY: z.number(),
	button: z.enum(['left', 'right', 'middle']).optional().default('left'),
	duration: z.number().optional().default(500), // Duration in milliseconds
	// New: human-like movement options
	humanLike: z.boolean().optional().default(false),
	profile: MovementProfileSchema,
	// Preset profile name (overridden by profile object if both provided)
	preset: z.enum(['normal', 'fast', 'slow', 'hesitant', 'precise']).optional(),
});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function drag(
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
			const { 
				startX, startY, endX, endY, 
				button, duration, 
				humanLike, profile, preset 
			} = RequestBodySchema.parse(req.body);

			// Record drag action if data collection is enabled
			if (memory.recordData && dataCollector.isActive()) {
				dataCollector.recordMouse({
					x: startX,
					y: startY,
					action: 'mousedown',
					button: button
				});
				dataCollector.recordMouse({
					x: endX,
					y: endY,
					move: true,
					action: 'mouseup',
					button: button
				});
			}

			const buttonMap = {
				left: 1,
				right: 3,
				middle: 2
			};
			const buttonNum = buttonMap[button];

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
				{ x: endX, y: endY },
				{
					humanLike,
					profile: movementProfile,
					duration,
				}
			);

			// Move to start position (first point in path)
			await execAsync(`xdotool mousemove ${path[0].x} ${path[0].y}`);
			
			// Press and hold the mouse button
			await execAsync(`xdotool mousedown ${buttonNum}`);
			
			// Move through all points in the path
			for (let i = 1; i < path.length; i++) {
				const point = path[i];
				await execAsync(`xdotool mousemove ${point.x} ${point.y}`);
				
				// Delay between steps (except for last point)
				if (i < path.length - 1) {
					await new Promise(resolve => setTimeout(resolve, Math.max(1, stepDelay)));
				}
			}

			// Release the mouse button
			await execAsync(`xdotool mouseup ${buttonNum}`);

			next(
				await buildResponse(200, {
					success: true,
					pathLength: path.length,
					humanLike,
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to perform drag operation",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "DRAG_FAILED",
					message: "Failed to perform drag operation",
					error: error instanceof Error ? error.message : 'Unknown error'
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
