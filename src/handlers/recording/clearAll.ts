import { NextFunction, Request, Response } from "express";
import { buildResponse } from "../../base/utility/express";
import { dataCollector } from "../../services/dataCollector";
import { LOGGER } from "../../base/logger";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function clearAll(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    try {
        const dbPath = dataCollector.getDbPath();
        const db = new BetterSqlite3(dbPath);
        
        db.exec("DELETE FROM system_actions");
        db.exec("DELETE FROM network_requests");
        db.exec("DELETE FROM cdp_events");
        db.exec("DELETE FROM vnc_frames");
        db.exec("DELETE FROM sessions");
        
        db.close();
        
        next(await buildResponse(200, { message: "All recording data cleared" }));
    } catch (error) {
        LOGGER.error("Failed to clear all data", { error });
        next(await buildResponse(500, { error: "Failed to clear data" }));
    }
}

