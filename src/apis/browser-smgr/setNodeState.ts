import axios, {AxiosError} from "axios"
import { SMGRVars, configVars } from "../../base/env"
import { sleep } from "../../base/utility/helpers"
import { LOGGER } from "../../base/logger"
import { TEvent, EVENT_NAME } from "../../events"

export async function setNodeState(
    id: string,
    payload: {
        ip          : string,
        name        : string,
        browserPort : number,
        appPort     : number,
        vncPort     : number,
        isAvailable : boolean,
    },
    allowRetry : boolean = false
) : Promise<boolean> {
    if(!SMGRVars.getReportState()) {
        const event: TEvent = {
            name: "node:setState",
            data:  { id, ...payload }
        }
        // Emit node deletion event even when reporting is disabled
        global.io.emit(EVENT_NAME, event);
        return true
    }
    
    for (let i = 0; i < configVars.getTryLimit(); i++) {
        try {
            const res = await axios.post(
                `${SMGRVars.getStateMGRUrl()}/node/${id}/setState`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            )

            // Break if success 
            if (res.status === 200 ) {
                LOGGER.info(
                    "Node State changed",
                    {
                        file:"setNodeState.ts",
                        browserID: id,
                        attempt: i,
                        ...payload
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
                        type: "setNodeState",
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