/**
 * Driver abstraction interfaces
 */

import { Cookie, LaunchOptions, ConnectOptions, Viewport } from './types';

export interface ICDPSession {
	send(method: string, params?: any): Promise<any>;
	on(event: string, handler: Function): void;
	off(event: string, handler: Function): void;
	detach(): Promise<void>;
}

export interface IPage {
	url(): string;
	title(): Promise<string>;
	cookies(): Promise<Cookie[]>;
	setCookie(...cookies: Cookie[]): Promise<void>;
	evaluate<T>(fn: Function | string, ...args: any[]): Promise<T>;
	evaluateOnNewDocument(fn: Function | string, ...args: any[]): Promise<void>;
	setViewport(viewport: Viewport): Promise<void>;
	emulateTimezone(timezone: string): Promise<void>;
	createCDPSession(): Promise<ICDPSession>;
	close(): Promise<void>;
	goto(url: string, options?: any): Promise<void>;
	// Event handlers (works for both Puppeteer and Playwright)
	on(event: 'request', handler: (request: unknown) => void): void;
	on(event: 'response', handler: (response: unknown) => void): void;
	on(event: 'requestfailed', handler: (request: unknown) => void): void;
	on(event: string, handler: (...args: unknown[]) => void): void;
	off?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface IBrowser {
	pages(): Promise<IPage[]>;
	newPage(): Promise<IPage>;
	close(): Promise<void>;
	wsEndpoint(): string;
	on(event: string, handler: Function): void;
	off(event: string, handler: Function): void;
	connected: boolean;
	disconnect?(): Promise<void>;
	version?(): Promise<string>;
	userAgent?(): Promise<string>;
}

export interface IDriver {
	launch(options: LaunchOptions): Promise<IBrowser>;
	connect(options: ConnectOptions): Promise<IBrowser>;
	name: string;
}

