import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({
    sessionId: z.string().optional()
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function summary(
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
        const dbPath = dataCollector.getDbPath();
        const db = new BetterSqlite3(dbPath, { readonly: true });
        
        const result = {
            sessionId,
            systemActionsCount: 0,
            networkRequestsCount: 0,
            cdpEventsCount: 0,
            vncFramesCount: 0
        };
        
        try {
            const actionsResult = db.prepare(
                "SELECT COUNT(*) as count FROM system_actions WHERE sessionId = ?"
            ).get(sessionId) as { count: number };
            result.systemActionsCount = actionsResult?.count || 0;
        } catch { /* table might not exist */ }
        
        try {
            const networkResult = db.prepare(
                "SELECT COUNT(*) as count FROM network_requests WHERE sessionId = ?"
            ).get(sessionId) as { count: number };
            result.networkRequestsCount = networkResult?.count || 0;
        } catch { /* table might not exist */ }
        
        try {
            const cdpResult = db.prepare(
                "SELECT COUNT(*) as count FROM cdp_events WHERE sessionId = ?"
            ).get(sessionId) as { count: number };
            result.cdpEventsCount = cdpResult?.count || 0;
        } catch { /* table might not exist */ }
        
        try {
            const vncResult = db.prepare(
                "SELECT COUNT(*) as count FROM vnc_frames WHERE sessionId = ?"
            ).get(sessionId) as { count: number };
            result.vncFramesCount = vncResult?.count || 0;
        } catch { /* table might not exist */ }
        
        db.close();
        
        next(await buildResponse(200, { summary: result }));
    } catch (error) {
        LOGGER.error("Failed to get recording summary", { error });
        next(await buildResponse(500, { error: "Failed to get summary" }));
    }
}

