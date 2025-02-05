import * as dotenv from "dotenv"
import * as expressEnvVars from "./variables/express"
import * as nodeEnvVars from "./variables/node"
import * as podEnvVars from "./variables/pod"
import * as smgrEnvVars from "./variables/smgr"
import * as configEnvVars from "./variables/config"
import * as coreEnvVars from "./variables/core"

export function loadEnv(mode:"dev"|"staging"|"prod"="prod", overridePath?: string){
    // By default load .env file (PROD)
    let envFilePath = "./.env" 
    if (mode === "dev") {
        envFilePath = "./.env.dev"
    } else if (mode === "staging") {
        envFilePath = "./.env.staging"  
    }
    
    if(overridePath) envFilePath = overridePath
    dotenv.config({path: envFilePath})
}

export function setDefaults(
    args: {[string: string]: string|undefined}, 
    overrideExisting: boolean = false
){
    for (const key in args) {
        if(args[key] === undefined) continue
        if (!process.env[key] || overrideExisting) {
            process.env[key] = args[key]
        }
    }
}

export const configVars = configEnvVars
export const expressVars = expressEnvVars
export const nodeVars = nodeEnvVars
export const podVars = podEnvVars
export const SMGRVars = smgrEnvVars
export const coreVars = coreEnvVars