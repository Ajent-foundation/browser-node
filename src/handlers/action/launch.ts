import { NextFunction, Request, Response } from "express"
import { LOGGER } from "../../base/logger"
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache"
import { buildResponse } from "../../base/utility/express"
import { SMGR_API } from "../../apis"
import { podVars } from "../../base/env"
import { launchBrowser, BrowserConfig, SupportedResolution } from "../../actions/browser"
import { gracefulShutdown } from "../../actions"
import { scheduleTermination } from "./lease"
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
	leaseTime: z.number().min(1).max(60).optional(),
	proxy: z.object({
		url: z.string().url(),
		username: z.string(),
		password: z.string()
	}).optional(),
	screen: z.object({
		resolution: z.custom<SupportedResolution>(),
		dpi: z.enum(["96", "120", "192"]).optional(),
		depth: z.enum(["24", "30", "32"]).optional()
	}).optional(),
	vnc: z.object({
		mode: z.enum(["ro", "rw"]),
		isPasswordProtected: z.boolean()
	}).optional(),
	browser: z.enum(["chrome"]).optional(),
	numberOfCameras: z.number().min(1).max(4).optional(),
	numberOfMicrophones: z.number().min(1).max(4).optional(),
	numberOfSpeakers: z.number().min(1).max(4).optional(),
	// To be added: "playwright", "selenium"
	driver: z.enum(["puppeteer"]).default("puppeteer").optional(),
	locale: z.string().optional(),
	language: z.string().optional(),
	timezone: z.string().optional(),
	platform: z.enum(["win32", "linux", "darwin"]).optional(),
	extensions: z.array(z.string()).optional(),
	overrideUserAgent: z.string().optional(),
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function launch(
  req  : Request<RequestParams, {}, RequestBody, RequestQuery>, 
  res  : Response,
  next : NextFunction
) {
	const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
	if(!memory) {
		next(
			await buildResponse(400, {
				code: "MEMORY_NOT_FOUND",
				message: "Cache memory not found"
			})
		)

		setImmediate(async () => {
			await gracefulShutdown("exit", null, true, "CACHE_MEMORY_NOT_FOUND")
		})
		return
	}

	LOGGER.info(
		`Received launch request`,
		{ 
			browserID: memory.browserID,
		}
	)

	// Make sure browser is not already running
	if (!memory.isRunning){
		if(!req.body.leaseTime) {
			// Set default lease time to 10 minute
			req.body.leaseTime = 10
		}

		// Make sure leasTime is not bigger than 60 minutes
		if (req.body.leaseTime > 60 && req.body.leaseTime < 1) {
			next(
				await buildResponse(400, {
					code: "LEASE_TIME_TOO_LONG",
					message: "Lease time cannot be greater than 60 minutes or less than 1 minute"
				})
			)
			return
		}

		let isSuccess = false;

		// Move node status to yellow (indicating that it is used)
		isSuccess = await SMGR_API.setNodeLabel(memory.browserID, {
			name: podVars.getPodName(),
			namespace: podVars.getNameSpace(),
			labelName: "status",
			labelValue: "yellow"
		})

		if(!isSuccess) {
			next(
				await buildResponse(400, {
					code: "NODE_LABEL_UPDATE_FAILED",
					message: "Failed to update node label, check executablePath"
				})
			)

			setImmediate(async () => {
				await gracefulShutdown("exit", null, true, "NODE_LABEL_UPDATE_FAILED")
			})
		}


		// set name to web-active
		isSuccess = await SMGR_API.setNodeLabel(memory.browserID, {
			name: podVars.getPodName(),
			namespace: podVars.getNameSpace(),
			labelName: "app.kubernetes.io~1name",
			labelValue: "web-active"
		})

		if(!isSuccess) {
			next(
				await buildResponse(400, {
					code: "NODE_LABEL_UPDATE_FAILED",
					message: "Failed to update node label, check executablePath"
				})
			)

			setImmediate(async () => {
				await gracefulShutdown("exit", null, true, "NODE_LABEL_UPDATE_FAILED")
			})
		} else {
			let sessionID = null

			// Config
			const config: BrowserConfig = {
				proxy: req.body.proxy,
				overrideUserAgent: req.body.overrideUserAgent,
				language: req.body.language,
				timezone: req.body.timezone,
				platform: req.body.platform,
				extensions: req.body.extensions || [],
				locale: req.body.locale,
				numberOfCameras: req.body.numberOfCameras,
				numberOfMicrophones: req.body.numberOfMicrophones,
				numberOfSpeakers: req.body.numberOfSpeakers,
				driver: req.body.driver,
			}
			
			// Screen Resolution
			if(req.body.screen && req.body.screen.resolution){
				config.window = {
					screen: {
						resolution: req.body.screen.resolution,
						depth: req.body.screen.depth || "24",
						dpi: req.body.screen.dpi || "96"
					}
				}
			}

			// VNC
			if(req.body.vnc){
				config.vnc = req.body.vnc
			}

			// 1- Launch browser
			const browserRes = await launchBrowser(
				sessionID || memory.browserID,
				config
			)
			if(!browserRes) {
				next(
					await buildResponse(400, {
						code: "BROWSER_LAUNCH_FAILED",
						message: "Failed to launch browser"
					})
				)

				setImmediate(async () => {
					await gracefulShutdown("exit", null, true, "BROWSER_LAUNCH_FAILED")
				})
				return
			}

			// 2- Update node param
			const isSuccess = await SMGR_API.setNodeParam(memory.browserID, {
				param: "wsPath",
				value: browserRes.uuid,
				createIfNotExists: true
			})
			
			if(!isSuccess) {
				next(
					await buildResponse(400, {
						code: "NODE_PARAM_UPDATE_FAILED",
						message: "Failed to update node param"
					})
				)

				setImmediate(async () => {
					await gracefulShutdown("exit", null, true, "NODE_PARAM_UPDATE_FAILED")
				})
			} else {
				LOGGER.info(
					"Browser launched", 
					{ browser: browserRes }
				)

				// Schedule a callback to terminate the browser after the lease time
				const now = Date.now()
				const id = scheduleTermination(req.body.leaseTime || 10)
				if(!id){
					next(
						await buildResponse(400, {
							code: "FAILED_TO_SCHEDULE_TERMINATION",
							message: "Failed to schedule termination"
						})
					)
					return
				}

				// Update cache
				memory.isRunning = true
				memory.instance = browserRes.instance
				memory.startedAt = now
				memory.leaseTime = req.body.leaseTime
				memory.pids = browserRes.pids
				CACHE.set(NodeCacheKeys.MEMORY, memory)

				next(
					await buildResponse(201, {
						browserID: memory.browserID,
						password: process.env.API_KEY,
						wsPath: browserRes.uuid
					})
				)
			}
		}
	} else {
		LOGGER.warn(
			"Browser is already running", 
			{ 
				browserID: memory.browserID 
			}
		)

		next(
			await buildResponse(400, {
				code: "BROWSER_ALREADY_RUNNING",
				message: "Browser is already running"
			})
		)
	}
}