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

interface WindowInfo {
	id: number;
	name: string;
	className?: string;
	geometry?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	visible?: boolean;
	active?: boolean;
}

export async function windows(
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
			// Get all window IDs
			const { stdout: windowIds } = await execAsync('xdotool search --onlyvisible --class "" 2>/dev/null || xdotool search --onlyvisible "" 2>/dev/null || echo ""');
			
			const windowIdList = windowIds.trim().split('\n').filter(id => id.trim() !== '').map(id => parseInt(id.trim(), 10));
			
			const windows: WindowInfo[] = [];
			const activeWindowId = parseInt((await execAsync('xdotool getactivewindow')).stdout.trim(), 10);

			// Get details for each window
			for (const windowId of windowIdList) {
				try {
					const [nameResult, geometryResult, classResult] = await Promise.allSettled([
						execAsync(`xdotool getwindowname ${windowId}`),
						execAsync(`xdotool getwindowgeometry ${windowId}`),
						execAsync(`xdotool getwindowclassname ${windowId}`).catch(() => ({ stdout: '' }))
					]);

					const name = nameResult.status === 'fulfilled' ? nameResult.value.stdout.trim() : '';
					const geometry = geometryResult.status === 'fulfilled' ? geometryResult.value.stdout : '';
					const className = classResult.status === 'fulfilled' ? classResult.value.stdout.trim() : '';

					// Parse geometry: "Window 12345678
					//   Position: 100,100 (screen: 0)
					//   Geometry: 800x600"
					let x = 0, y = 0, width = 0, height = 0;
					const posMatch = geometry.match(/Position:\s*(\d+),(\d+)/);
					const geomMatch = geometry.match(/Geometry:\s*(\d+)x(\d+)/);
					
					if (posMatch) {
						x = parseInt(posMatch[1], 10);
						y = parseInt(posMatch[2], 10);
					}
					if (geomMatch) {
						width = parseInt(geomMatch[1], 10);
						height = parseInt(geomMatch[2], 10);
					}

					// Check if window is visible
					let visible = true;
					try {
						await execAsync(`xdotool getwindowname ${windowId}`);
					} catch {
						visible = false;
					}

					windows.push({
						id: windowId,
						name: name || `Window ${windowId}`,
						className: className || undefined,
						geometry: (width > 0 && height > 0) ? { x, y, width, height } : undefined,
						visible,
						active: windowId === activeWindowId
					});
				} catch (error) {
					// Skip windows that can't be queried
					LOGGER.warn(
						`Failed to get info for window ${windowId}`,
						{ windowId, error: error instanceof Error ? error.message : 'Unknown error' }
					);
				}
			}

			next(
				await buildResponse(200, {
					windows,
					count: windows.length
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to get windows list",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "WINDOWS_LIST_FAILED",
					message: "Failed to get windows list",
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

