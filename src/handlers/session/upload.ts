import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { LOGGER } from "../../base/logger"
import { gracefulShutdown } from "../../actions"
import { upload } from "../../main"
import { extract } from "tar"
import fs from "fs"

const temp = "/home/user/session";
const userDir = "/home/user/temp";
const googleData = "/Default";

export type RequestParams = {}

export type RequestBody = {}

export type RequestQuery = {}

export async function uploadSession(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    upload.single('session')(req, res, async (error) => {
        if (error) {
            LOGGER.error(
                `Failed to upload session`,
                {
                    error: error,
                    stack: error.stack
                }
            );

            next(
                await buildResponse(400, {
                    code: "UPLOAD_FAILED",
                    message: "Failed to upload the file"
                })
            )
            return
        }

        try {
            if(!req.file){
                next(
                    await buildResponse(400, {
                        code: "UPLOAD_FAILED",
                        message: "No file uploaded"
                    })
                )
                return
            }

            // Extract the uploaded tar.gz file
            await extract({
                file: req.file.path,
                cwd: temp
            })

            if (!fs.existsSync(`${userDir}${googleData}`)) {
                fs.mkdirSync(`${userDir}${googleData}`)
            }

            // Copy the extracted files to the user directory (Only if they exists)

            if (fs.existsSync(`${temp}${temp}/localStorage/leveldb`)) {
                fs.readdirSync(`${temp}${temp}/localStorage/leveldb`).forEach(file => {
                    // if Local Storage does not exists, create it
                    if (!fs.existsSync(`${userDir}${googleData}/Local Storage`)) {
                        fs.mkdirSync(`${userDir}${googleData}/Local Storage`)
                    }

                    // if leveldb does not exists, create it
                    if (!fs.existsSync(`${userDir}${googleData}/Local Storage/leveldb`)) {
                        fs.mkdirSync(`${userDir}${googleData}/Local Storage/leveldb`)
                    }

                    fs.copyFileSync(`${temp}${temp}/localStorage/leveldb/${file}`, `${userDir}${googleData}/Local Storage/leveldb/${file}`)
                })
            }
            
            if (fs.existsSync(`${temp}${temp}/sessionStorage`)) {
                fs.readdirSync(`${temp}${temp}/sessionStorage`).forEach(file => {
                    // if Session Storage does not exists, create it
                    if (!fs.existsSync(`${userDir}${googleData}/Session Storage`)) {
                        fs.mkdirSync(`${userDir}${googleData}/Session Storage`)
                    }

                    fs.copyFileSync(`${temp}${temp}/sessionStorage/${file}`, `${userDir}${googleData}/Session Storage/${file}`);
                });
            }
            
            if (fs.existsSync(`${temp}${temp}/Cookies`)) {
                fs.copyFileSync(`${temp}${temp}/Cookies`, `${userDir}${googleData}/Cookies`)
            }

            // Delete the uploaded and extracted files
            fs.unlinkSync(req.file.path)
            fs.rmSync(temp, { recursive: true })
            fs.mkdirSync(temp)

            next(
                await buildResponse(200, {})
            )
        } catch (error: unknown) {
            if (error instanceof Error) {
                LOGGER.error(
                    `Failed to upload session`,
                    {
                        message: error.message,
                        stack: error.stack
                    }
                )
            }

            next(
                await buildResponse(400, {
                    code: "UPLOAD_FAILED",
                    message: "Failed to upload session"
                })
            )

            //setImmediate(async () => {
            //    await gracefulShutdown("exit", null, true)
            //})
        }
    })
}