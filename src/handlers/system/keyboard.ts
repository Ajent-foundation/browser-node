import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { execFile } from 'child_process';

export type RequestParams = {}

export type RequestBody = {
    key?: string
    text?: string
    modifiers?: Array<'ctrl' | 'alt' | 'shift' | 'super'>
    type?: 'keydown' | 'keyup' | 'type'
}

export type RequestQuery = {}

// Add validation helpers
const VALID_KEYS = new Set(['Return', 'space', 'BackSpace', 'Tab', /* add other valid keys */]);
const VALID_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'super']);

function validateInput(key?: string, text?: string, modifiers?: string[]) {
    if (text && !/^[a-zA-Z0-9\s.,!?-]*$/.test(text)) {
        throw new Error('Invalid text input');
    }
    if (key && !VALID_KEYS.has(key)) {
        throw new Error('Invalid key');
    }
    if (modifiers?.some(mod => !VALID_MODIFIERS.has(mod))) {
        throw new Error('Invalid modifier');
    }
}

export async function keyboard(
	req:Request<RequestParams, {}, RequestBody, RequestQuery>, 
	res:Response, 
	next:NextFunction
){
    const memory = CACHE.get<NodeMemory>(NodeCacheKeys.MEMORY)
	if(!memory) {
		next(
			await buildResponse(400, {
				code: "MEMORY_NOT_FOUND",
				message: "Cache memory not found"
			})
		)

		setImmediate(async () => {
			await gracefulShutdown("exit", null, true)
		})
		return
	}

    if (memory.isRunning) {
        const { key, text, modifiers = [], type = 'type' } = req.body
        
        try {
            validateInput(key, text, modifiers);
            
            if (text) {
                await new Promise((resolve, reject) => {
                    execFile('xdotool', ['type', text], (error) => {
                        if (error) reject(error);
                        resolve(true);
                    });
                });
            } else if (key) {
                const args: string[] = [];
                
                if (modifiers.length > 0) {
                    if (type === 'type') {
                        args.push('key', `${modifiers.join('+')}+${key}`);
                    } else {
                        args.push(type === 'keydown' ? 'keydown' : 'keyup', ...modifiers, key);
                    }
                } else {
                    if (type === 'type') {
                        args.push('key', key);
                    } else {
                        args.push(type === 'keydown' ? 'keydown' : 'keyup', key);
                    }
                }

                await new Promise((resolve, reject) => {
                    execFile('xdotool', args, (error) => {
                        if (error) reject(error);
                        resolve(true);
                    });
                });
            }
            
            next(
                await buildResponse(200, {})
            )
        } catch (error) {
            next(
                await buildResponse(400, {
                    code: "INVALID_INPUT",
                    message: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined
                })
            );
            return;
        }
    } else {
        next(
            await buildResponse(400, {
                code: "BROWSER_NOT_RUNNING",
                message: "Browser is not running"
            })
        )
    }
}