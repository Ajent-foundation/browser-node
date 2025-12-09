import { Request, Response, NextFunction } from "express"
import { buildResponse } from "../../base/utility/express"
import { NodeMemory, CACHE, NodeCacheKeys } from "../../base/cache"
import { gracefulShutdown } from "../../actions"
import { LOGGER } from "../../base/logger"
import { execFile } from 'child_process';
import { dataCollector } from "../../services/dataCollector";

export type RequestParams = {}

export type RequestBody = {
    key?: string
    text?: string
    modifiers?: Array<'ctrl' | 'alt' | 'shift' | 'super'>
    type?: 'keydown' | 'keyup' | 'type'
    delayMin?: number  // Minimum delay in milliseconds between characters
    delayMax?: number  // Maximum delay in milliseconds between characters
}

export type RequestQuery = {}

// Add validation helpers
const VALID_KEYS = new Set([
    'Return', 'Enter', 'space', 'BackSpace', 'Tab', 'Escape', 'Esc',
    'Up', 'Down', 'Left', 'Right',
    'Home', 'End', 'Page_Up', 'Page_Down',
    'Insert', 'Delete',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
]);
const VALID_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'super']);

function validateInput(key?: string, text?: string, modifiers?: string[]) {
    // Allow text input without strict validation (xdotool can handle most characters)
    if (key && !VALID_KEYS.has(key)) {
        // Allow any key that xdotool might support - just warn but don't fail
        LOGGER.warn(
            `Key "${key}" not in standard set, but will attempt to send`,
            { key }
        );
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
        const { key, text, modifiers = [], type = 'type', delayMin = 0, delayMax = 0 } = req.body
        
        try {
            validateInput(key, text, modifiers);
            
            // Record keyboard action if data collection is enabled
            if (memory.recordData && dataCollector.isActive()) {
                dataCollector.recordKeyboard({ key, text, modifiers, type });
            }
            
            if (text) {
                // If delay range is specified, type with randomized delays
                if (delayMin > 0 || delayMax > 0) {
                    const minDelay = Math.max(0, delayMin);
                    const maxDelay = Math.max(minDelay, delayMax);
                    
                    // Type each character with random delay
                    for (let i = 0; i < text.length; i++) {
                        const char = text[i];
                        await new Promise((resolve, reject) => {
                            execFile('xdotool', ['type', '--', char], (error) => {
                                if (error) reject(error);
                                resolve(true);
                            });
                        });
                        
                        // Add random delay between characters (except for last character)
                        if (i < text.length - 1) {
                            const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                } else {
                    // Type normally without delays
                    await new Promise((resolve, reject) => {
                        execFile('xdotool', ['type', text], (error) => {
                            if (error) reject(error);
                            resolve(true);
                        });
                    });
                }
            } else if (key) {
                if (type === 'keydown' || type === 'keyup') {
                    // For keydown/keyup, we need to handle modifiers separately
                    if (modifiers.length > 0) {
                        // First, press all modifiers
                        for (const mod of modifiers) {
                            await new Promise((resolve, reject) => {
                                execFile('xdotool', [type === 'keydown' ? 'keydown' : 'keyup', mod], (error) => {
                                    if (error) reject(error);
                                    resolve(true);
                                });
                            });
                        }
                        // Then press/release the key
                        await new Promise((resolve, reject) => {
                            execFile('xdotool', [type === 'keydown' ? 'keydown' : 'keyup', key], (error) => {
                                if (error) reject(error);
                                resolve(true);
                            });
                        });
                        // If keyup, release modifiers in reverse order
                        if (type === 'keyup') {
                            for (let i = modifiers.length - 1; i >= 0; i--) {
                                await new Promise((resolve, reject) => {
                                    execFile('xdotool', ['keyup', modifiers[i]], (error) => {
                                        if (error) reject(error);
                                        resolve(true);
                                    });
                                });
                            }
                        }
                    } else {
                        // No modifiers, just press/release the key
                        await new Promise((resolve, reject) => {
                            execFile('xdotool', [type === 'keydown' ? 'keydown' : 'keyup', key], (error) => {
                                if (error) reject(error);
                                resolve(true);
                            });
                        });
                    }
                } else {
                    // type mode - send key combination
                    const args: string[] = [];
                    if (modifiers.length > 0) {
                        args.push('key', `${modifiers.join('+')}+${key}`);
                    } else {
                        args.push('key', key);
                    }
                    await new Promise((resolve, reject) => {
                        execFile('xdotool', args, (error) => {
                            if (error) reject(error);
                            resolve(true);
                        });
                    });
                }
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