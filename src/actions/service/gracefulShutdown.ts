import { Server } from "http"
import { LOGGER } from "../../base/logger"
import { NodeCacheKeys, CACHE, NodeMemory } from "../../base/cache"
import { SMGR_API } from "../../apis"

export default async function gracefulShutdown(
    signal:string, 
    server: Server | null, 
    withError:boolean=false,
    errMessage: string= "UNKNOWN_ERROR"
): Promise<void> {
    //  Report to State Manager
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    if(!memory) {
        process.exit(1)
	}

    LOGGER.warn(
        `${signal} Shutting signal invoked, service shutting down gracefully...`,
        {
            browserID: memory.browserID,
            withError: withError
        }
    )    

    // Delete Node
    const isSuccess = await SMGR_API.deleteNode(memory.browserID, withError, errMessage, true)
    if (!isSuccess) {
        LOGGER.error(
            "Failed to delete node before shutdown",
            { 
                browserID: memory.browserID 
            }
        )
    } 
    
    if(server){
        // Stop accepting connections
        server.close()
    } 

    process.exit(withError ? 1 : 0)
}