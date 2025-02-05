import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

function getWindowID(name: string): Promise<number> {
    return new Promise((resolve, reject) => {
        exec(`xdotool search --name "${name}"`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr}`);
                return;
            }
            const windowID = stdout.trim();
            resolve(Number(windowID));
        });
    });
}

function getCurrentWindowID(): Promise<number> {
    return new Promise((resolve, reject) => {
        exec(`xdotool getactivewindow`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr}`);
                return;
            }
            const windowID = parseInt(stdout.trim());
            resolve(Number(windowID));
        });
    });
}

function getWindowName(id: number): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`xdotool getwindowname ${id}`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr}`);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

export async function isBrowserActive(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
	if(!memory) {
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
        // get Chrome Window ID
        // xdotool search --name "Google Chrome" 
        const chrome = await getWindowID("Google Chrome")
        const currentWindow = await getCurrentWindowID()

        next(
            await buildResponse(200, {
                isBrowserActive: chrome === currentWindow,
                currentWindowName: await getWindowName(currentWindow)
            })
        )
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}