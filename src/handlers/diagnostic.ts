import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../base/utility/express"
import { nodeVars, expressVars, podVars } from "../base/env"
import { CACHE, NodeCacheKeys, NodeMemory } from "../base/cache"
import { LOGGER } from "../base/logger"
import { z } from "zod"
import axios from "axios"
import net from "net"
import fs from "fs"
import { execSync } from "child_process"

const LOG_FILES = {
    websockify: "/home/user/logs/websockify.log"
}

const LOG_TAIL_LINES = 100

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

// Read tail of a log file
function readLogTail(filePath: string, lines: number = LOG_TAIL_LINES): { exists: boolean; lines?: string[]; error?: string } {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false, error: "File does not exist" }
        }
        
        const output = execSync(`tail -n ${lines} "${filePath}"`, { encoding: "utf-8", timeout: 5000 })
        return {
            exists: true,
            lines: output.split("\n").filter(line => line.trim() !== "")
        }
    } catch (err) {
        return {
            exists: fs.existsSync(filePath),
            error: err instanceof Error ? err.message : String(err)
        }
    }
}

// Check if a TCP port is reachable
async function isPortReachable(port: number, host: string = "localhost", timeout: number = 2000): Promise<{ reachable: boolean; error?: string }> {
    return new Promise((resolve) => {
        const socket = new net.Socket()
        
        const timer = setTimeout(() => {
            socket.destroy()
            resolve({ reachable: false, error: "Connection timeout" })
        }, timeout)
        
        socket.connect(port, host, () => {
            clearTimeout(timer)
            socket.destroy()
            resolve({ reachable: true })
        })
        
        socket.on("error", (err) => {
            clearTimeout(timer)
            socket.destroy()
            resolve({ reachable: false, error: err.message })
        })
    })
}

// Get status from new websockify
async function getNewWebsockifyStatus(port: number): Promise<{ type: "new" | "legacy" | "unknown"; status?: any; error?: string }> {
    try {
        const response = await axios.get(`http://localhost:${port}/status`, { timeout: 2000 })
        return {
            type: "new",
            status: response.data
        }
    } catch (err) {
        if (axios.isAxiosError(err)) {
            if (err.response?.status === 404) {
                return { type: "legacy", error: "No /status endpoint - likely legacy websockify" }
            }
            if (err.code === "ECONNREFUSED") {
                return { type: "unknown", error: "Connection refused - websockify not running" }
            }
            return { type: "unknown", error: err.message }
        }
        return { type: "unknown", error: String(err) }
    }
}

export async function diagnostic(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    
    const vncPort = nodeVars.getNodeVNCPort()
    const browserPort = nodeVars.getNodeBrowserPort()
    const x11vncPort = 5900

    try {
        // Check ports in parallel
        const [x11vncCheck, websockifyCheck, browserCheck] = await Promise.all([
            isPortReachable(x11vncPort),
            isPortReachable(vncPort),
            isPortReachable(browserPort)
        ])
        
        // Get websockify status if reachable
        let websockifyStatus: { type: "new" | "legacy" | "unknown"; status?: any; error?: string } = {
            type: "unknown",
            error: "Not reachable"
        }
        
        if (websockifyCheck.reachable) {
            websockifyStatus = await getNewWebsockifyStatus(vncPort)
        }
        
        next(
            await buildResponse(200, {
                node: {
                    podIP: podVars.getPodIP(),
                    podName: podVars.getPodName(),
                    appPort: expressVars.getExpressPort(),
                    browserPort: browserPort,
                    vncPort: vncPort
                },
                memory: {
                    isRunning: memory?.isRunning || false,
                    vncVersion: memory?.vncVersion || "legacy",
                    recordData: memory?.recordData || false,
                    ...(memory?.browserID && { browserID: memory.browserID })
                },
                ports: {
                    x11vnc: {
                        port: x11vncPort,
                        reachable: x11vncCheck.reachable,
                        ...(x11vncCheck.error && { error: x11vncCheck.error })
                    },
                    websockify: {
                        port: vncPort,
                        reachable: websockifyCheck.reachable,
                        type: websockifyStatus.type,
                        ...(websockifyStatus.status && { status: websockifyStatus.status }),
                        ...(websockifyStatus.error && { error: websockifyStatus.error })
                    },
                    browser: {
                        port: browserPort,
                        reachable: browserCheck.reachable,
                        ...(browserCheck.error && { error: browserCheck.error })
                    }
                },
                logs: {
                    websockify: readLogTail(LOG_FILES.websockify)
                }
            })
        )
    } catch (error) {
        LOGGER.error(
            "Failed to get diagnostic",
            {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            }
        )
        next(
            await buildResponse(500, {
                code: "DIAGNOSTIC_FAILED",
                message: "Failed to get diagnostic info"
            })
        )
    }
}
