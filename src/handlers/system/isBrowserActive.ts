import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { exec } from 'child_process';

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

function getActiveWindowClass(): Promise<string> {
    return new Promise((resolve, reject) => {
        // First get active window ID, then get its class via xprop
        exec(`xdotool getactivewindow`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error getting active window: ${stderr}`);
                return;
            }
            const windowId = stdout.trim();
            
            // Use xprop to get _OB_APP_CLASS (Openbox app class - reliable)
            exec(`xprop -id ${windowId} _OB_APP_CLASS`, (error2, stdout2, stderr2) => {
                if (error2) {
                    reject(`Error getting window class: ${stderr2}`);
                    return;
                }
                // Parse: _OB_APP_CLASS(UTF8_STRING) = "Brave-browser"
                const match = stdout2.match(/"([^"]+)"/);
                resolve(match ? match[1].toLowerCase() : '');
            });
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
        try {
            // Check if active window is browser by class (more reliable than name)
            const activeClass = await getActiveWindowClass();
            const isBrowserActive = activeClass.includes('brave-browser') || 
                                    activeClass.includes('chrome') || 
                                    activeClass.includes('chromium');
            
            // Also get current window info for debugging
            const currentWindow = await getCurrentWindowID();
            const currentWindowName = await getWindowName(currentWindow);

            next(
                await buildResponse(200, {
                    isBrowserActive: isBrowserActive,
                    currentWindowClass: activeClass,
                    currentWindowName: currentWindowName
                })
            )
        } catch (error) {
            // xdotool can fail if no window is found or display issues
            next(
                await buildResponse(200, {
                    isBrowserActive: false,
                    currentWindowClass: null,
                    currentWindowName: null,
                    error: String(error)
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