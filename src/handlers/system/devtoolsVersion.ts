import axios from "axios"
import { Request, Response, NextFunction } from "express"

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {
    host?: string
    port?: string
}

export async function devtoolsVersion(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    try {
        // DevTools is forwarded inside the container from 19222 -> 9222
        const resp = await axios.get("http://127.0.0.1:19222/json/version", { timeout: 1000 })
        const data = resp.data || {}
        // Optionally rewrite hostname/port via query params (?host=x&port=y)
        const host = (req.query.host as string) || undefined
        const port = (req.query.port as string) || undefined
        if (data.webSocketDebuggerUrl && (host || port)) {
            try {
                const u = new URL(data.webSocketDebuggerUrl)
                if (host) u.hostname = host
                if (port) u.port = port
                data.webSocketDebuggerUrl = u.toString()
            } catch {}
        }
        res.status(200).json(data)
    } catch (e) {
        res.status(503).json({ code: "DEVTOOLS_UNAVAILABLE", message: "DevTools version not available" })
    }
}


