import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import { z } from "zod";

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({
    sessionId: z.string().optional()
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function exportData(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const sessionId = req.query.sessionId || dataCollector.getSessionId();
    
    if (!sessionId) {
        next(await buildResponse(400, { error: "No active session" }));
        return;
    }
    
    try {
        const data = dataCollector.getRecordedData();
        
        if (!data) {
            next(await buildResponse(404, { error: "No data found" }));
            return;
        }
        
        next(await buildResponse(200, data));
    } catch (error) {
        LOGGER.error("Failed to export recording data", { error });
        next(await buildResponse(500, { error: "Failed to export data" }));
    }
}

