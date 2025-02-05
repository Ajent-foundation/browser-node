import { SMGR_API } from "../../apis/"
import { podVars } from "../../base/env"
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache"

export default async function freeNode(): Promise<boolean> {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    if(!memory) {
        return false
    }

    // Delete Node
    const isSuccess = await SMGR_API.deleteNode(memory.browserID, false, "", true)
    if(!isSuccess) {
        return false
    } else {
        // Move to red
        const isSuccess = SMGR_API.setNodeLabel(memory.browserID, {
            name: podVars.getPodName(),
            namespace: podVars.getNameSpace(),
            labelName: 'status',
            labelValue: 'red'
        })

        if(!isSuccess) {
            return false
        }

        for (const pid of memory.pids) {
            try {
                console.log(`Killing process ${pid}`)
                process.kill(pid)//'SIGKILL'
            } catch (error:unknown) {
                continue
            }
        }

        // Updated memory
        // memory.browserID = ""
        memory.isRunning = false
        memory.instance = null
        memory.startedAt = null 
        memory.leaseTime = null
        memory.pids = []
        CACHE.set(NodeCacheKeys.MEMORY, memory) 
    }

    return true
}
