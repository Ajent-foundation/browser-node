import { LogLevel } from "../../constant/logger"
import { ICoreTransporter } from "./core"

export class JSONTransporter implements ICoreTransporter {
    formatAndLog(
        level: LogLevel,
        message: string, 
        args: { [key:string]: any},
        style?: any[],  
    ): void {

        let jsonToLog : Record<string, object|string> = {
            level: level,
            ...args
        }

        if(message) {
            jsonToLog["message"] = message
        }

        // Append the rest of the args
        for (let i = 0; i < args.length; i++) {
            jsonToLog[`${args[i]}`] = args[i]
        }

        console.log(JSON.stringify(jsonToLog))
    }
}
