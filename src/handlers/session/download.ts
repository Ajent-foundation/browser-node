import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { create }  from "tar"
import fs from "fs"

export const temp = "/home/user/session"
const userDir = "/home/user/temp"
const googleData = "/Default"


export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

export async function downloadSession(
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
        // copy Local Storage, Session Storage, and Cookies from google chrome
        // Compress into a file and send it to the client

        try {
            await makeSessionData()
            
            // STEP-6: Send the compressed file to the client
            res.download(`${temp}.tar.gz`, "session.tar.gz", async (error) => {
                if(error) {
                    LOGGER.error(
                        `Failed to download session`,
                        {
                            error: error,
                            stack: error.stack
                        }
                    )
                    
                    next(
                        await buildResponse(400, {
                            code: "DOWNLOAD_FAILED",
                            message: "Failed to download the file"
                        })
                    )
                    return
                }

                // STEP-7: Delete the compressed file
                deleteSessionData()
            })
        } catch (error:unknown) {
            if (error instanceof Error) {
                LOGGER.error(
                    `Failed to download session`,
                    {
                        message: error.message,
                        stack: error.stack
                    }
                )
            }

            next(
                await buildResponse(400, {
                    code: "DOWNLOAD_FAILED",
                    message: "Failed to download session"
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

export async function makeSessionData(){
    // STEP-1: Delete everything inside the temp folder
    // fs.rmdirSync(temp, { recursive: true })

    // Create session folders
    fs.mkdirSync(`${temp}/localStorage`, { recursive: true })
    fs.mkdirSync(`${temp}/localStorage/leveldb`, { recursive: true })
    fs.mkdirSync(`${temp}/sessionStorage`, { recursive: true })
    
    LOGGER.info(
        `Created session folders`,
    )

    // STEP-2: Copying Local Storage
    const localStorageFiles = fs.readdirSync(`${userDir}${googleData}/Local Storage/leveldb`)

    // Remove the following (LOCK, LOG, LOG.old)
    localStorageFiles.forEach(file => {
        if(file !== "LOCK" && file !== "LOG" && file !== "LOG.old") {
            fs.copyFileSync(`${userDir}${googleData}/Local Storage/leveldb/${file}`, `${temp}/localStorage/leveldb/${file}`)
        }
    })

    LOGGER.info(
        `Copied Local Storage`,
    )

    // STEP-3: Copying Session Storage
    const sessionStorageFiles = fs.readdirSync(`${userDir}${googleData}/Session Storage`)

    // Remove the following (LOCK, LOG, LOG.old)
    sessionStorageFiles.forEach(file => {
        if(file !== "LOCK" && file !== "LOG" && file !== "LOG.old") {
            fs.copyFileSync(`${userDir}${googleData}/Session Storage/${file}`, `${temp}/sessionStorage/${file}`)
        }
    })

    LOGGER.info(
        `Copied Session Storage`,
    )

    // STEP-4: Copying Cookies
    const cookiesPath = `${userDir}${googleData}/Cookies`
    if (fs.existsSync(cookiesPath)) {
        fs.copyFileSync(cookiesPath, `${temp}/Cookies`)
        LOGGER.info(
            `Copied Cookies`,
        )
    }

    // STEP-5: Compress the folder
    await create(
        {
            file: `${temp}.tar.gz`,
            gzip: true,
        },
        [temp]
    )
}

export function deleteSessionData(){
    fs.unlinkSync(`${temp}.tar.gz`)
}