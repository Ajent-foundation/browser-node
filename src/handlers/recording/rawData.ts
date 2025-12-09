import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

export const RequestParamsSchema = z.object({
    type: z.string()
});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({
    sessionId: z.string().optional()
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

const TABLE_MAP: Record<string, string> = {
    systemActions: "system_actions",
    networkRequests: "network_requests",
    cdpEvents: "cdp_events",
    vncFrames: "vnc_frames",
    sessions: "sessions"
};

export async function rawData(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const dataType = req.params.type;
    const sessionId = req.query.sessionId || dataCollector.getSessionId();
    
    const tableName = TABLE_MAP[dataType];
    if (!tableName) {
        next(await buildResponse(400, { error: "Invalid data type" }));
        return;
    }
    
    try {
        const dbPath = dataCollector.getDbPath();
        const db = new BetterSqlite3(dbPath, { readonly: true });
        
        let query = `SELECT * FROM ${tableName}`;
        const params: string[] = [];
        
        if (sessionId && tableName !== "sessions") {
            query += " WHERE sessionId = ?";
            params.push(sessionId);
        }
        
        query += " ORDER BY id DESC LIMIT 500";
        
        const data = db.prepare(query).all(...params);
        db.close();
        
        // For VNC frames, don't include the raw data (too large)
        if (dataType === "vncFrames") {
            const processed = (data as any[]).map(frame => ({
                ...frame,
                data: `[${(frame.data as Buffer)?.length || 0} bytes]`
            }));
            next(await buildResponse(200, { data: processed }));
        } else {
            next(await buildResponse(200, { data }));
        }
    } catch (error) {
        LOGGER.error("Failed to get raw data", { error, dataType });
        next(await buildResponse(500, { error: "Failed to get raw data" }));
    }
}

