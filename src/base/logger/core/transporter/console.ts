import { LogLevel } from "../../constant/logger"
import { TEXT_STYLE, BG_COLOR, FG_COLOR } from "../../constant/transporter/console"
import { ICoreTransporter } from "./core"

export type ConsoleStyle = TEXT_STYLE | 
    typeof BG_COLOR.Bright | typeof BG_COLOR.Normal | 
    typeof FG_COLOR.Bright | typeof FG_COLOR.Normal

export class ConsoleTransporter implements ICoreTransporter {
    formatAndLog(
        level: LogLevel, 
        message: string, 
        args : { [key:string]: any},
        style?: ConsoleStyle[], 
    ): void {

        let fullMessage : string
        let prefix: string = ""
        let metadata = this._getMetadataString(args)
        let metadataString: string = metadata[0]

        if(level === LogLevel.DEBUG) {
            let levelName = LogLevel.DEBUG.toString()
            prefix += this._stylize(
                `[${levelName}]${metadataString}`, 
                [FG_COLOR.Bright.Green, TEXT_STYLE.Bold]
            )
        }
        else if(level === LogLevel.INFO) {
            let levelName = LogLevel.INFO.toString()
            prefix += this._stylize(
                `[${levelName}]${metadataString}`, 
                [FG_COLOR.Bright.Blue, TEXT_STYLE.Bold]
            )
        }
        else if(level === LogLevel.WARN) {
            let levelName = LogLevel.WARN.toString()
            prefix += this._stylize(
                `[${levelName}]${metadataString}`, 
                [FG_COLOR.Bright.Yellow, TEXT_STYLE.Bold]
            )
        }
        else if(level === LogLevel.ERROR) {
            let levelName = LogLevel.ERROR.toString()
            prefix += this._stylize(
                `[${levelName}]${metadataString}`,  
                [FG_COLOR.Bright.Red, TEXT_STYLE.Bold]
            )
        }
        else if(level === LogLevel.CRITICAL) {
            let levelName = LogLevel.CRITICAL.toString()
            prefix += this._stylize(
                `[${levelName}]${metadataString}`, 
                [FG_COLOR.Bright.Red, TEXT_STYLE.Bold]
            )
        }
        else if(level === LogLevel.CUSTOM) {
            fullMessage = (
                this._stylize(
                    message, 
                    style ?
                        style :
                        [FG_COLOR.Normal.White]
                )
            )

            console.log(`${fullMessage}`)
            return
        }

        console.log(`${prefix} : ${message}`)

        // Log Objects
        for (let i = 0; i < metadata[1].length; i++) {
            console.dir(metadata[1][i])
        }
    }

    private _getMetadataString(metadata:{[key: string] : string}) : [string, any[]] {
        let metadataString = ""
        let objects : unknown[] = []

        for (let key in metadata) {
            if (metadata.hasOwnProperty(key)) {
                // check if metadata[key] is object
                if(typeof metadata[key] === "object") {
                    objects.push(metadata[key])
                    continue
                }
                metadataString += " " + `[${key}:${metadata[key]}]`
            }
        }

        return [metadataString, objects]
    }

    private _stylize(message: string, codes: ConsoleStyle[] = []) : string {
        return `\x1b[${this._buildSequence(codes)}m${message}\x1b[${this._buildSequence([TEXT_STYLE.Reset])}m`
    }

    private _buildSequence(codes: ConsoleStyle[]) : string {
        return codes.join(";")
    }
}