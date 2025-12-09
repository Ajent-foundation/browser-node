import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { exec } from 'child_process';
import { z } from "zod"
import { promisify } from 'util';

const execAsync = promisify(exec);

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function mouseLocation(
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
			// Get mouse location using xdotool
			const { stdout } = await execAsync('xdotool getmouselocation --shell');
			const location: { x: number; y: number; screen: number; window: number } = {
				x: 0,
				y: 0,
				screen: 0,
				window: 0
			};

			// Parse the output
			stdout.split('\n').forEach(line => {
				const match = line.match(/(\w+)=(\d+)/);
				if (match) {
					const key = match[1].toLowerCase();
					const value = parseInt(match[2], 10);
					if (key === 'x') location.x = value;
					if (key === 'y') location.y = value;
					if (key === 'screen') location.screen = value;
					if (key === 'window') location.window = value;
				}
			});

			next(
				await buildResponse(200, {
					x: location.x,
					y: location.y,
					screen: location.screen,
					window: location.window
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to get mouse location",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "MOUSE_LOCATION_FAILED",
					message: "Failed to get mouse location",
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

