import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { spawn } from 'child_process';
import { z } from "zod"

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({
	command: z.string(),
	timeout: z.number().optional().default(30000) // 30 seconds default timeout
});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function shellCommand(
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
			const { command, timeout } = RequestBodySchema.parse(req.body);

			// Security: Basic command validation (you may want to enhance this)
			const dangerousCommands = ['rm -rf', 'mkfs', 'dd if=', 'format', 'fdisk'];
			const isDangerous = dangerousCommands.some(dangerous => 
				command.toLowerCase().includes(dangerous.toLowerCase())
			);

			if (isDangerous) {
				next(
					await buildResponse(400, {
						code: "DANGEROUS_COMMAND",
						message: "Command contains potentially dangerous operations"
					})
				)
				return
			}

			// Execute command with timeout using spawn for proper signal handling
			// When using shell: true, pass command as-is to preserve quotes, spaces, etc.
			let stdout = '';
			let stderr = '';
			let exitCode = 0;
			let timedOut = false;

			const proc = spawn(command.trim(), {
				shell: true,
				stdio: ['ignore', 'pipe', 'pipe']
			});

			// Collect stdout
			proc.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			// Collect stderr
			proc.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			// Set up timeout
			const timeoutId = setTimeout(() => {
				timedOut = true;
				proc.kill('SIGTERM');
				// Force kill after 2 seconds if still running
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill('SIGKILL');
					}
				}, 2000);
			}, timeout);

			// Wait for process to complete
			await new Promise<void>((resolve) => {
				proc.on('close', (code) => {
					clearTimeout(timeoutId);
					exitCode = code || 0;
					resolve();
				});

				proc.on('error', (error) => {
					clearTimeout(timeoutId);
					stderr += error.message;
					exitCode = 1;
					resolve();
				});
			});

			if (timedOut) {
				next(
					await buildResponse(408, {
						code: "COMMAND_TIMEOUT",
						message: "Command execution timed out",
						timeout: timeout
					})
				)
				return
			}

			// Return result (non-zero exit codes are normal for some commands)
			next(
				await buildResponse(200, {
					stdout: stdout || '',
					stderr: stderr || '',
					exitCode: exitCode
				})
			)
		} catch (error) {
			LOGGER.error(
				"Failed to execute shell command",
				{
					error: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined
				}
			)
			next(
				await buildResponse(500, {
					code: "SHELL_COMMAND_FAILED",
					message: "Failed to execute shell command",
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

