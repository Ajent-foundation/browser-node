import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { init } from "../../db"
import { getFileByID } from "../../db/modules/files"
import { exec } from 'child_process';
import { z } from "zod"

export const RequestParamsSchema = z.object({});

export const RequestBodySchema = z.object({
    fileName: z.string().min(1)
});

export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

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

function typeText(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(`xdotool type ${text}`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr}`);
                return;
            }
            resolve();
        });
    });
}

function clickEnter(): Promise<void> {
    return new Promise((resolve, reject) => {
        exec(`xdotool key Return`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error: ${stderr}`);
                return;
            }
            resolve();
        });
    });
}

export async function selectFileFromDialog(
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
        const db = init()   
        const file = await getFileByID(db, req.body.fileName)
        if(!file) {
            next(
                await buildResponse(400, {
                    code: "FILE_NOT_FOUND",
                    message: "File not found"
                })
            )
            return
        }

        const windowID = await getCurrentWindowID()
        const windowName = await getWindowName(windowID)
        if (windowName.includes("Open") || windowName.includes("Save As") || windowName.includes("Choose File")) {
            await typeText(file.path)  

            // wait 3 seconds
            await new Promise(resolve => setTimeout(resolve, 500))
            await clickEnter()

            next(
                await buildResponse(200, {})
            )
        } else {
            next(
                await buildResponse(400, {
                    code: "DIALOG_NOT_FOUND",
                    message: "Dialog not found"
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