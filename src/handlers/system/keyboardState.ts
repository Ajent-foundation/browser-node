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

export async function keyboardState(
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
			// Get currently pressed keys using xinput (more reliable than xdotool for state queries)
			const pressedKeys: string[] = [];
			
			// Try to use xinput to query keyboard state
			try {
				// Query the keyboard device state
				const { stdout } = await execAsync('xinput query-state "Virtual core keyboard" 2>/dev/null || xinput list | grep -i keyboard | head -1 | grep -o "id=[0-9]*" | cut -d= -f2 | xargs -I {} xinput query-state {} 2>/dev/null || echo ""');
				
				// Parse xinput output to find pressed keys
				// Format: "key[38]=down" or "key[50]=up"
				const keyMatches = stdout.match(/key\[(\d+)\]=down/g);
				if (keyMatches) {
					// Map key codes to key names (common modifier keys)
					const keyCodeMap: { [key: string]: string } = {
						'37': 'ctrl', '105': 'ctrl', // Left/Right Ctrl
						'50': 'shift', '62': 'shift', // Left/Right Shift
						'64': 'alt', '108': 'alt', // Left/Right Alt
						'133': 'super', '134': 'super' // Left/Right Super
					};
					
					keyMatches.forEach(match => {
						const keyCode = match.match(/key\[(\d+)\]/)?.[1];
						if (keyCode && keyCodeMap[keyCode]) {
							const keyName = keyCodeMap[keyCode];
							if (!pressedKeys.includes(keyName)) {
								pressedKeys.push(keyName);
							}
						}
					});
				}
			} catch {
				// xinput not available or failed, that's okay
				// xdotool doesn't support querying key states directly
			}

			next(
				await buildResponse(200, {
					pressedKeys: pressedKeys,
					note: pressedKeys.length === 0 ? "Key state detection requires xinput. Currently only detects common modifier keys (ctrl, shift, alt, super)." : undefined
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to get keyboard state",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "KEYBOARD_STATE_FAILED",
					message: "Failed to get keyboard state",
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

