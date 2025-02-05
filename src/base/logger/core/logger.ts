import { LogLevel, LogLevelConfig } from "../constant/logger"
import { ICoreTransporter } from "./transporter/core"
import { ConsoleTransporter, ConsoleStyle } from "./transporter/console"
import { JSONTransporter } from "./transporter/json"
import { coreVars } from "../../env"

export enum TransporterType {
    CONSOLE,
    JSON
}

export interface ILogConfig {
    level: LogLevelConfig | LogLevel
    transporters: TransporterType[]
}

export class Logger {
    // Internal properties
    private _Level: LogLevelConfig | LogLevel
    private _Transporters: ICoreTransporter[]

    constructor(config: ILogConfig) {
        this._Level = config.level

        this._Transporters = []
        this._registerTransporter(config.transporters)
    }

    _registerTransporter(transporters: TransporterType[]) {
        // make sure list of unique transporters
        transporters = [...new Set(transporters)]

        this._Transporters = []
        for (let transporter of transporters) {
            if (transporter === TransporterType.CONSOLE) {
                this._Transporters.push(new ConsoleTransporter())
            } else if (transporter === TransporterType.JSON) {
                this._Transporters.push(new JSONTransporter())
            }
        }
    }

    custom(message:string, style?:ConsoleStyle[]){
        let level = LogLevel.CUSTOM

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO ||
            this._Level === LogLevel.WARN || 
            this._Level === LogLevel.ERROR ||
            this._Level === LogLevel.CRITICAL ||
            this._Level === LogLevel.CUSTOM
        ) {
            if(!style) style = []
            this._log(level, message, style, {}, true)
        }
    }

    info(message:string, args?:{[key:string]:any}){
        let level = LogLevel.INFO

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO
        ) this._log(level, message, [], args ? args : {})
    }

    warn(message:string, args?:{[key:string]:any}){
        let level = LogLevel.WARN

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO ||
            this._Level === LogLevel.WARN 
        )
        this._log(level, message, [], args ? args : {})
    }

    error(message:string, args?:{[key:string]:any}){
        let level = LogLevel.ERROR

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO ||
            this._Level === LogLevel.WARN || 
            this._Level === LogLevel.ERROR            
        )  this._log(level, message, [], args ? args : {})
    }

    debug(message:string, args?:{[key:string]:any}){
        let level = LogLevel.DEBUG

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO ||
            this._Level === LogLevel.WARN || 
            this._Level === LogLevel.ERROR
        ) this._log(level, message, [], args ? args : {})
    }

    critical(message:string, args?:{[key:string]:any}){
        let level = LogLevel.CRITICAL

        if (
            this._Level === LogLevelConfig.ALL ||
            this._Level === LogLevel.DEBUG ||
            this._Level === LogLevel.INFO ||
            this._Level === LogLevel.WARN || 
            this._Level === LogLevel.ERROR ||
            this._Level === LogLevel.CRITICAL
        ) this._log(level, message, [], args ? args : {})
    }

    // Log to all transporters
    async _log(
        level:LogLevel, 
        message:string, 
        style:any[], 
        args:{[key:string]:any}, 
        ignore=false
    ) : Promise<void> {
        for(let transporter of this._Transporters){
            // Console transporter is only used in development
            if (coreVars.getDeployment() === "Dev" && !(transporter instanceof ConsoleTransporter)){
                continue
            } else if (transporter instanceof ConsoleTransporter && coreVars.getDeployment() !== "Dev") {
                continue
            } 
            
            if(!(transporter instanceof ConsoleTransporter)) {
                if (ignore) continue
            }

            // log to all registered transporters
            transporter.formatAndLog(
                level, 
                message, 
                args,
                transporter instanceof ConsoleTransporter ? 
                    style 
                    : 
                    undefined,
            )
        }
    }
}