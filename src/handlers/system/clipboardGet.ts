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

export async function clipboardGet(
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
			const { stdout } = await execAsync('xclip -selection clipboard -o');

			next(
				await buildResponse(200, {
					content: stdout
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to get clipboard content",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "CLIPBOARD_GET_FAILED",
					message: "Failed to get clipboard content",
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

