import { Logger, TransporterType } from "./core/logger"
import { LogLevelConfig } from "./constant/logger"
export { LogLevel } from "./constant/logger"
export { FG_COLOR, BG_COLOR, TEXT_STYLE } from "./constant/transporter/console" 

// Init Logger
export const LOGGER = new Logger({
    level: LogLevelConfig.ALL,
    transporters: [
        TransporterType.CONSOLE,
        TransporterType.JSON
    ]
})