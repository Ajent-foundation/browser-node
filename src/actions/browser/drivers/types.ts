/**
 * Shared types for browser drivers
 */

export interface Cookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None' | string;
	url?: string;
}

export interface Viewport {
	width: number;
	height: number;
}

export interface LaunchOptions {
	executablePath?: string;
	headless?: boolean;
	args?: string[];
	env?: Record<string, string>;
	pipe?: boolean;
	defaultViewport?: Viewport;
	ignoreDefaultArgs?: string[];
}

export interface ConnectOptions {
	browserWSEndpoint?: string;
}

