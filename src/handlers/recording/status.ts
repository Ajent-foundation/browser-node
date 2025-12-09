import { NextFunction, Request, Response } from "express";
import { NodeMemory, NodeCacheKeys, CACHE } from "../../base/cache";
import { buildResponse } from "../../base/utility/express";
import { z } from "zod";

export const RequestParamsSchema = z.object({});
export const RequestBodySchema = z.object({});
export const RequestQuerySchema = z.object({});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type RequestQuery = z.infer<typeof RequestQuerySchema>;

export async function status(
    req: Request<RequestParams, {}, RequestBody, RequestQuery>,
    res: Response,
    next: NextFunction
) {
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY);
    
    next(
        await buildResponse(200, {
            isRecording: memory?.recordData || false,
            sessionId: memory?.sessionId || null,
            browserID: memory?.browserID || null,
            isRunning: memory?.isRunning || false,
            startedAt: memory?.startedAt || null
        })
    );
}

