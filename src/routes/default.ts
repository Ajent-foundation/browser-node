import { Router, NextFunction, Request, Response } from "express"
import { buildResponse, IError } from "../base/utility/express"
import { NodeMemory, NodeCacheKeys, CACHE } from "../base/cache"
import { expressVars, SMGRVars, podVars, nodeVars } from "../base/env"
import { diagnostic } from "../handlers/diagnostic"

// The Routing Sheet
const DEFAULT_ROUTES = Router()

DEFAULT_ROUTES.get(
	"/",
	async (req: Request, res:Response, next:NextFunction) => {
		try{
			next(
				await buildResponse(200, {
					message: "Browser-node-ts is running!",
					config: {
						EXPRESS_PORT: expressVars.getExpressPort(),
						STATE_MGR_URL: SMGRVars.getStateMGRUrl(),
						NODE_BROWSER_PORT: nodeVars.getNodeBrowserPort(),
						NODE_VNC_PORT: nodeVars.getNodeVNCPort(),
						POD_NAMESPACE: podVars.getNameSpace(),
						POD_NAME: podVars.getPodName(),
						POD_IP: podVars.getPodIP(),
					}
				})
			)
		} catch(err) {
			next(
				await buildResponse<IError>(500, {
					code: "INTERNAL_SERVER_ERROR",
					message: "An error occurred while processing the request."
				})
			)
		}
	}
)

DEFAULT_ROUTES.get(
  "/memory",
  async (req: Request, res:Response, next:NextFunction) => {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
	if(!memory) {
		next(
			await buildResponse(400, {
				error: "Memory not found"
			})
		)
		return
	}
	
	next(
		await buildResponse(200, memory)
	)
  }
)

DEFAULT_ROUTES.get(
	"/healthz",
	async (req: Request, res:Response, next:NextFunction) => {
		next(await buildResponse(200, null))
	}
)

DEFAULT_ROUTES.get(
	"/readyz",
	async (req: Request, res:Response, next:NextFunction) => {
		next(await buildResponse(200, null))
	}
)

// Diagnostic endpoint - helps debug connection issues (VNC, browser, ports)
DEFAULT_ROUTES.get("/diagnostic", diagnostic)

module.exports = DEFAULT_ROUTES