import { SMGR_API } from "../../apis"
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache"
import { configVars, nodeVars, expressVars, podVars } from "../../base/env"
import { sleep } from "../../base/utility/helpers"
import { LOGGER } from "../../base/logger"

export default async function init(id: string) : Promise<boolean> {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    if(!memory) {
        return false
    }

    let isSuccess: boolean = false

    // Report for Duty
    // 1- Delete if there is an existing ID
    if(memory.browserID !== ""){ 
        isSuccess = await SMGR_API.deleteNode(memory.browserID, true, "SELF_CLEANUP")
        if (!isSuccess) {
            return false
        }

        await sleep(configVars.getDelayTime())
    }

    // 2- Update ID
    memory.browserID = id

    // 3- Update Cache
    CACHE.set<NodeMemory>(NodeCacheKeys.MEMORY, memory)
    LOGGER.info(
        "Node Initialized",
        {
            startTime: new Date().toISOString(),
            browserID: memory.browserID
        }
    )

    // 4- Update Node state
    isSuccess = await SMGR_API.setNodeState(memory.browserID, {
        ip: podVars.getPodIP(),
        name: podVars.getPodName(),
        browserPort: nodeVars.getNodeBrowserPort(),
        appPort: expressVars.getExpressPort(),
        vncPort: nodeVars.getNodeVNCPort(),
        isAvailable: true,
    })
    if (!isSuccess) {
        return false
    }

    // 5 - Set status to green
    isSuccess = await SMGR_API.setNodeLabel(memory.browserID, {
        name: podVars.getPodName(),
        namespace: podVars.getNameSpace(),
        labelName: "status",
        labelValue: "green"
    })
    if (!isSuccess) {
        return false
    }

    return true
}
