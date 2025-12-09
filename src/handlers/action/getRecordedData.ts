import { Request, Response, NextFunction } from "express"
import { LOGGER } from "../../base/logger"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { buildResponse } from "../../base/utility/express"
import { dataCollector } from "../../services/dataCollector"

export type RequestParams = {}
export type RequestBody = {}
export type RequestQuery = {}

/**
 * Handler to retrieve the recorded session data without stopping the recording.
 * Useful for getting real-time data during the session.
 */
export async function getRecordedData(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
    if (!memory) {
        next(
            await buildResponse(400, {
                code: "MEMORY_NOT_FOUND",
                message: "Cache memory not found"
            })
        )
        return
    }

    if (!memory.recordData) {
        next(
            await buildResponse(400, {
                code: "RECORDING_NOT_ENABLED",
                message: "Data recording was not enabled for this session"
            })
        )
        return
    }

    if (!dataCollector.isActive()) {
        next(
            await buildResponse(400, {
                code: "NO_ACTIVE_RECORDING",
                message: "No active recording session"
            })
        )
        return
    }

    try {
        const data = dataCollector.getRecordedData()
        
        if (!data) {
            next(
                await buildResponse(404, {
                    code: "NO_DATA_FOUND",
                    message: "No recorded data found"
                })
            )
            return
        }

        LOGGER.info(
            "Retrieved recorded data",
            {
                sessionId: memory.sessionId,
                summary: data.summary
            }
        )

        next(
            await buildResponse(200, {
                sessionId: memory.sessionId,
                data
            })
        )
    } catch (error) {
        LOGGER.error(
            "Failed to retrieve recorded data",
            { error }
        )
        
        next(
            await buildResponse(500, {
                code: "RETRIEVAL_ERROR",
                message: error instanceof Error ? error.message : "Failed to retrieve recorded data"
            })
        )
    }
}

