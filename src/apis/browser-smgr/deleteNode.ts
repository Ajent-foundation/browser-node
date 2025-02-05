import axios, {AxiosError} from "axios"
import { SMGRVars, configVars } from "../../base/env"
import { sleep } from "../../base/utility/helpers"
import { LOGGER } from "../../base/logger"
import { TEvent, EVENT_NAME } from "../../events"
import { makeSessionData, temp, deleteSessionData } from "../../handlers/session/download"
import fs from "fs"

// Returns true if successful
export async function deleteNode(
    id: string,
    isError: boolean,
    Message: string,
    allowRetry : boolean = false
) : Promise<boolean> {
    if(!SMGRVars.getReportState()) {
        let sessionData: string = ""
        // Get SessionData
        try {
            await makeSessionData()
            // Above creates a file ${temp}.tar.gz
            // we need to convert it to base64
            sessionData = fs.readFileSync(`${temp}.tar.gz`, "base64")

            // Delete the file
            deleteSessionData()
        } catch (error) {
            LOGGER.error("Failed to make session data", {
                error: error instanceof Error ? error.message : "Unknown error",
                trace: error instanceof Error ? error.stack : "Unknown stack",
                file: "deleteNode.ts",
            })
        }

        const event: TEvent = {
            name: "node:deleted",
            data:  { id, isError, message: Message, sessionData }
        }
        // Emit node deletion event even when reporting is disabled
        global.io.emit(EVENT_NAME, event);
        return true
    }

    for (let i = 0; i < configVars.getTryLimit(); i++) {
        try {
            const res = await axios.delete<{num:number}>(
                `${SMGRVars.getStateMGRUrl()}/node/${id}/remove?isError=${isError ? "true" : "false"}&message=${Message}`,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            )

            // Break if success 
            if (res.status === 200 ) {
                LOGGER.warn(
                    "Node Deleted",
                    {
                        file:"deleteNode.ts",
                        browserID: id,
                        attempt: i,
                    }
                )

                return true
            }
        }
        catch (error:unknown) {
            // Only log last error before breaking
            if(i == configVars.getTryLimit()-1 || !allowRetry) {
                if (error instanceof AxiosError) {
                    LOGGER.error("Failed with SMGR", {
                        type: "deleteNode",
                        err: error.message,
                        trace: error.stack,
                        response: error.response?.data
                    })
                }
            }

            // Sleep for a bit before retrying
            await sleep(configVars.getTryDelayTime())
            if (!allowRetry) break
        }
    }

    return false
}