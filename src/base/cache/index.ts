import { IBrowser } from "../../actions/browser/drivers"
import NodeCache from "node-cache"

export enum NodeCacheKeys {
    MEMORY = "MEMORY"
}

export type NodeMemory = {
    isRunning : boolean
    browserID : string
    instance  : IBrowser | null
    startedAt : number | null
    leaseTime : number | null
    pids      : number[]
    // Data collection flags
    recordData : boolean
    sessionId  : string | null
    vncVersion : "legacy" | "new"
}

export const CACHE = new NodeCache({
    stdTTL:0, 
    checkperiod:60000, 
    useClones:true
})