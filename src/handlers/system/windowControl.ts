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
export const RequestBodySchema = z.object({
	windowId: z.number().optional(),
	windowName: z.string().optional(),
	action: z.enum(['focus', 'minimize', 'maximize', 'close', 'restore'])
});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

async function getWindowId(windowId?: number, windowName?: string): Promise<number> {
	if (windowId) {
		return windowId;
	}
	
	if (windowName) {
		const { stdout } = await execAsync(`xdotool search --name "${windowName}" | head -1`);
		const id = stdout.trim();
		if (!id) {
			throw new Error(`Window with name "${windowName}" not found`);
		}
		return parseInt(id, 10);
	}
	
	// Default to active window
	const { stdout } = await execAsync('xdotool getactivewindow');
	return parseInt(stdout.trim(), 10);
}

export async function windowControl(
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
			const { windowId, windowName, action } = RequestBodySchema.parse(req.body);
			
			if (!windowId && !windowName && action !== 'focus') {
				next(
					await buildResponse(400, {
						code: "MISSING_WINDOW_IDENTIFIER",
						message: "windowId or windowName is required for this action"
					})
				)
				return
			}

			const targetWindowId = await getWindowId(windowId, windowName);

			switch (action) {
				case 'focus':
					if (windowId || windowName) {
						await execAsync(`xdotool windowactivate ${targetWindowId}`);
					} else {
						// Focus active window (no-op but valid)
						await execAsync('xdotool getactivewindow');
					}
					break;
					
				case 'minimize':
					await execAsync(`xdotool windowminimize ${targetWindowId}`);
					break;
					
				case 'maximize':
					await execAsync(`xdotool windowmaximize ${targetWindowId}`);
					break;
					
				case 'restore':
					// Restore from minimized/maximized
					await execAsync(`xdotool windowactivate ${targetWindowId}`);
					await execAsync(`xdotool windowmap ${targetWindowId}`);
					break;
					
				case 'close':
					await execAsync(`xdotool windowclose ${targetWindowId}`);
					break;
					
				default:
					next(
						await buildResponse(400, {
							code: "INVALID_ACTION",
							message: `Invalid action: ${action}`
						})
					)
					return
			}

			next(
				await buildResponse(200, {
					success: true,
					windowId: targetWindowId,
					action
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to control window",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "WINDOW_CONTROL_FAILED",
					message: "Failed to control window",
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

