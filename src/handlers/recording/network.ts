import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({
    sessionId: z.string().optional(),
    url: z.string().optional(),
    method: z.string().optional(),
    limit: z.string().optional()
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function network(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const sessionId = req.query.sessionId || dataCollector.getSessionId();
    const urlFilter = req.query.url;
    const methodFilter = req.query.method;
    const limit = parseInt(req.query.limit || "50");
    
    if (!sessionId) {
        next(await buildResponse(400, { error: "No active session" }));
        return;
    }
    
    try {
        const dbPath = dataCollector.getDbPath();
        const db = new BetterSqlite3(dbPath, { readonly: true });
        
        let query = "SELECT * FROM network_requests WHERE sessionId = ?";
        const params: (string | number)[] = [sessionId];
        
        if (urlFilter) {
            query += " AND url LIKE ?";
            params.push(`%${urlFilter}%`);
        }
        
        if (methodFilter) {
            query += " AND method = ?";
            params.push(methodFilter);
        }
        
        query += " ORDER BY timestamp DESC LIMIT ?";
        params.push(limit);
        
        const result = db.prepare(query).all(...params);
        db.close();
        
        next(await buildResponse(200, { requests: result }));
    } catch (error) {
        LOGGER.error("Failed to get network requests", { error });
        next(await buildResponse(500, { error: "Failed to get network requests" }));
    }
}

