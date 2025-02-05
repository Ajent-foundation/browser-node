import { Browser } from "puppeteer"
import NodeCache from "node-cache"

export enum NodeCacheKeys {
    MEMORY = "MEMORY"
}

export type NodeMemory = {
    isRunning : boolean
    browserID : string
    instance  : Browser | null
    startedAt : number | null
    leaseTime : number | null
    pids      : number[]
}

export const CACHE = new NodeCache({
    stdTTL:0, 
    checkperiod:60000, 
    useClones:true
})