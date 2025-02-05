import { LogLevel } from "../../constant/logger"
import { ConsoleStyle } from "./console"

export type Style = ConsoleStyle

export interface ICoreTransporter {
    formatAndLog : (
        level: LogLevel, 
        message: string, 
        args : { [key:string]: any},
        style?: Style[],
    ) => void
}