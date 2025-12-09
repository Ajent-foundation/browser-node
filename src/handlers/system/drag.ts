import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { exec } from 'child_process';
import { z } from "zod"
import { promisify } from 'util';
import { dataCollector } from "../../services/dataCollector";

const execAsync = promisify(exec);

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({
	startX: z.number(),
	startY: z.number(),
	endX: z.number(),
	endY: z.number(),
	button: z.enum(['left', 'right', 'middle']).optional().default('left'),
	duration: z.number().optional().default(500) // Duration in milliseconds
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
			const { startX, startY, endX, endY, button, duration } = RequestBodySchema.parse(req.body);

			// Record drag action if data collection is enabled
			if (memory.recordData && dataCollector.isActive()) {
				dataCollector.recordMouse({
					x: startX,
					y: startY,
					action: 'mousedown',
					button: button
				});
				// Record the drag end point as well
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

			// Move to start position
			await execAsync(`xdotool mousemove ${startX} ${startY}`);
			
			// Press and hold the mouse button
			await execAsync(`xdotool mousedown ${buttonNum}`);
			
			// Move to end position with smooth movement
			// Calculate steps for smooth drag (approximately 10 steps per 100ms)
			const steps = Math.max(10, Math.floor(duration / 10));
			const deltaX = (endX - startX) / steps;
			const deltaY = (endY - startY) / steps;
			const stepDelay = duration / steps;

			for (let i = 1; i <= steps; i++) {
				const currentX = Math.round(startX + deltaX * i);
				const currentY = Math.round(startY + deltaY * i);
				await execAsync(`xdotool mousemove ${currentX} ${currentY}`);
				// Small delay between steps (only if not the last step)
				if (i < steps) {
					await new Promise(resolve => setTimeout(resolve, Math.max(1, stepDelay)));
				}
			}

			// Release the mouse button
			await execAsync(`xdotool mouseup ${buttonNum}`);

			next(
				await buildResponse(200, {
					success: true
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

