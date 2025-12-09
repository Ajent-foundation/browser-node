import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import { z } from "zod";

export const RequestParamsSchema = z.object({
    sessionId: z.string()
});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function clearSession(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const sessionId = req.params.sessionId;
    
    if (!sessionId) {
        next(await buildResponse(400, { error: "Session ID required" }));
        return;
    }
    
    try {
        dataCollector.clearSessionData(sessionId);
        next(await buildResponse(200, { message: `Session ${sessionId} data cleared` }));
    } catch (error) {
        LOGGER.error("Failed to clear session data", { error, sessionId });
        next(await buildResponse(500, { error: "Failed to clear data" }));
    }
}

