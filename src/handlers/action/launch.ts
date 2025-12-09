import { NextFunction, Request, Response } from "express"
import { LOGGER } from "../../base/logger"
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache"
import { buildResponse } from "../../base/utility/express"
import { SMGR_API } from "../../apis"
import { podVars } from "../../base/env"
import { FingerprintingProtection, IPGeolocation } from '../../actions/browser/fingerprinting';
import { launchBrowser, BrowserConfig, SupportedResolution } from "../../actions/browser"
import { gracefulShutdown } from "../../actions"
import { scheduleTermination } from "./lease"
import { z } from "zod"
import { dataCollector } from "../../services/dataCollector"
import { enableNetworkRecording } from "../../actions/browser"
import axios from "axios"
import { nodeVars } from "../../base/env"

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
	vncVersion: z.enum(["legacy", "new"]).optional(),
	vnc: z.object({
		mode: z.enum(["ro", "rw"]),
		isPasswordProtected: z.boolean()
	}).optional(),
	browser: z.enum(["chrome"]).optional(),
	numberOfCameras: z.number().min(1).max(4).optional(),
	numberOfMicrophones: z.number().min(1).max(4).optional(),
	numberOfSpeakers: z.number().min(1).max(4).optional(),
	driver: z.enum(["puppeteer", "playwright"]).default("puppeteer").optional(),
	locale: z.string().optional(),
	language: z.string().optional(),
	timezone: z.string().optional(),
	platform: z.enum(["win32", "linux", "darwin"]).optional(),
	extensions: z.array(z.string()).optional(),
	overrideUserAgent: z.string().optional(),
	fingerprinting: z.object({
		enabled: z.boolean().optional().default(true),
		profile: z.string().optional(), // Profile name or "random" for weighted random selection
		hardwareConcurrency: z.number().min(1).max(32).optional(),
		deviceMemory: z.number().min(1).max(64).optional(),
		maxTouchPoints: z.number().min(0).max(10).optional(),
		timezone: z.string().optional(),
		language: z.string().optional(),
		languages: z.array(z.string()).optional(),
		locale: z.string().optional()
	}).optional().default({}),
	// Data collection flag - when true, records all actions, network, CDP, VNC
	recordData: z.boolean().optional().default(false),
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

			// Config - will be updated with IP-adjusted values later
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
				fingerprinting: req.body.fingerprinting,
				recordData: req.body.recordData, // Browser uses port 9223 when true, so CDP proxy can intercept on 9222
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
				config.vnc.version = req.body.vncVersion || "legacy"
			}

			// VNC Version
			if(!config.vnc && req.body.vncVersion === "new"){
				config.vnc = {
					isPasswordProtected: true,
					mode: "rw",
					version: "new"
				}
			}

			// If recordData is enabled, require vncVersion to be "new" for VNC recording support
			if (req.body.recordData && config.vnc?.version !== "new") {
				next(
					await buildResponse(400, {
						code: "VNC_VERSION_REQUIRED",
						message: "Recording requires vncVersion to be 'new'. Set vncVersion: 'new' in request body."
					})
				)
				return
			}

			// Create fingerprinting protection with profile support and IP-based adjustment
			let fingerprintingProtection: FingerprintingProtection | null = null;
			let fingerprintingConfig = req.body.fingerprinting || {};
			
			if (fingerprintingConfig.enabled !== false) { // Default to enabled
				// Adjust fingerprinting config based on IP geolocation using IPInfo.io
				try {
					const adjustedConfig = await IPGeolocation.adjustConfigForIP(fingerprintingConfig);
					// Merge the adjusted config back, preserving the original structure
					fingerprintingConfig = {
						...fingerprintingConfig,
						...adjustedConfig
					};
				} catch (error) {
					// Failed to adjust config based on IP, using original config
				}
				
				// Extract criteria from request for intelligent profile matching
				const requestCriteria = {
					platform: req.body.platform,
					timezone: req.body.timezone || fingerprintingConfig.timezone,
					language: req.body.language || fingerprintingConfig.language,
					locale: req.body.locale || fingerprintingConfig.locale
				};
				
				fingerprintingProtection = new FingerprintingProtection(fingerprintingConfig, requestCriteria);
				
				// Update the main browser config with IP-adjusted values
				if (fingerprintingConfig.timezone) {
					config.timezone = fingerprintingConfig.timezone;
				}
				if (fingerprintingConfig.language) {
					config.language = fingerprintingConfig.language;
				}
				if (fingerprintingConfig.locale) {
					config.locale = fingerprintingConfig.locale;
				}
			}

			// 1- Launch browser (pass the IP-adjusted fingerprinting protection)
			const browserRes = await launchBrowser(
				sessionID || memory.browserID,
				config,
				fingerprintingProtection
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

			// Initialize data collection if recordData flag is set
			let recordingSessionId: string | null = null;
			if (req.body.recordData) {
				try {
					// Use browserID as session ID - same ID used for reporting
					recordingSessionId = memory.browserID;
					dataCollector.initialize();
					dataCollector.startRecording(recordingSessionId);
					
					// Enable network recording in browser module (attaches to existing + new pages)
					await enableNetworkRecording(dataCollector.getDbPath(), recordingSessionId);
					
					// Start CDP interceptor as proxy: listens on 9222, forwards to browser on 9223
					dataCollector.startCDPInterceptor(9222, 9223);
					
					// Start VNC recording via websockify API (only if new websockify is enabled)
					if (config.vnc?.version === "new") {
						setTimeout(async () => {
							try {
								const vncPort = nodeVars.getNodeVNCPort();
								await axios.post(`http://localhost:${vncPort}/recording/start`, {
									sessionId: recordingSessionId
								}, { timeout: 5000 });
								LOGGER.info("VNC recording started", { recordingSessionId });
							} catch (vncError) {
								LOGGER.warn("Failed to start VNC recording", { vncError });
							}
						}, 2000);
					}
					
					LOGGER.info(
						"Data collection initialized",
						{ recordingSessionId }
					)
				} catch (error) {
					LOGGER.error(
						"Failed to initialize data collection",
						{ error }
					)
				}
			}

			// Update cache
			memory.isRunning = true
			memory.instance = browserRes.instance
			memory.startedAt = now
			memory.leaseTime = req.body.leaseTime
			memory.pids = browserRes.pids
			memory.recordData = req.body.recordData || false
			memory.sessionId = recordingSessionId
			memory.vncVersion = config.vnc?.version || "legacy"
			CACHE.set(NodeCacheKeys.MEMORY, memory)

			next(
				await buildResponse(201, {
					browserID: memory.browserID,
					password: process.env.API_KEY,
					wsPath: browserRes.uuid,
					recordingSessionId: recordingSessionId
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