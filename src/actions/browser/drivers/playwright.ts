/**
 * Playwright driver implementation
 */

import { chromium, Browser as PlaywrightBrowser, BrowserContext, Page as PlaywrightPage, CDPSession } from 'playwright';
import { IDriver, IBrowser, IPage, ICDPSession } from './interfaces';
import { LaunchOptions, ConnectOptions, Cookie, Viewport } from './types';
import http from 'http';

// Helper to fetch wsEndpoint from browser's debug port
async function fetchWsEndpoint(port: string, maxRetries = 10): Promise<string> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const data = await new Promise<string>((resolve, reject) => {
				const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
					let body = '';
					res.on('data', chunk => body += chunk);
					res.on('end', () => resolve(body));
				});
				req.on('error', reject);
				req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
			});
			const json = JSON.parse(data);
			if (json.webSocketDebuggerUrl) {
				return json.webSocketDebuggerUrl;
			}
		} catch {
			// Retry
		}
		await new Promise(r => setTimeout(r, 500));
	}
	return '';
}

class PlaywrightCDPSessionWrapper implements ICDPSession {
	constructor(private session: CDPSession) {}

	async send(method: string, params?: any): Promise<any> {
		return await this.session.send(method as any, params);
	}

	on(event: string, handler: Function): void {
		this.session.on(event as any, handler as any);
	}

	off(event: string, handler: Function): void {
		this.session.off(event as any, handler as any);
	}

	async detach(): Promise<void> {
		await this.session.detach();
	}
}

class PlaywrightPageWrapper implements IPage {
	private context: BrowserContext;

	constructor(private page: PlaywrightPage, context: BrowserContext) {
		this.context = context;
	}

	url(): string {
		return this.page.url();
	}

	async title(): Promise<string> {
		return await this.page.title();
	}

	async cookies(): Promise<Cookie[]> {
		const cookies = await this.context.cookies();
		return cookies.map(cookie => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			expires: cookie.expires,
			httpOnly: cookie.httpOnly || false,
			secure: cookie.secure || false,
			sameSite: cookie.sameSite as string || 'Lax'
		}));
	}

	async setCookie(...cookies: Cookie[]): Promise<void> {
		const playwrightCookies = cookies.map(cookie => ({
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			expires: cookie.expires,
			httpOnly: cookie.httpOnly || false,
			secure: cookie.secure || false,
			sameSite: (cookie.sameSite as 'Strict' | 'Lax' | 'None') || 'Lax',
			url: cookie.url
		}));
		await this.context.addCookies(playwrightCookies);
	}

	async evaluate<T>(fn: Function | string, ...args: any[]): Promise<T> {
		if (typeof fn === 'string') {
			return await this.page.evaluate(fn, ...args);
		}
		return await this.page.evaluate(fn as any, ...args);
	}

	async evaluateOnNewDocument(fn: Function | string, ...args: any[]): Promise<void> {
		// Playwright uses addInitScript instead of evaluateOnNewDocument
		if (typeof fn === 'string') {
			await this.context.addInitScript(fn, ...args);
		} else {
			await this.context.addInitScript(fn as any, ...args);
		}
	}

	async setViewport(viewport: Viewport): Promise<void> {
		await this.page.setViewportSize({
			width: viewport.width,
			height: viewport.height
		});
	}

	async emulateTimezone(timezone: string): Promise<void> {
		// Playwright supports timezone via page.emulateTimezone (Chromium only)
		// Note: Ideally set via context options, but this works for existing pages
		try {
			const cdp = await this.page.context().newCDPSession(this.page);
			await cdp.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
		} catch {
			// Fallback: inject timezone override
			await this.context.addInitScript((tz: string) => {
				const getOffset = (tz: string) => {
					try {
						const now = new Date();
						const utc = new Date(now.toLocaleString("en-US", {timeZone: "UTC"}));
						const target = new Date(now.toLocaleString("en-US", {timeZone: tz}));
						return Math.round((utc.getTime() - target.getTime()) / 60000);
					} catch { return 0; }
				};
				const offset = getOffset(tz);
				Date.prototype.getTimezoneOffset = () => offset;
			}, timezone);
		}
	}

	async createCDPSession(): Promise<ICDPSession> {
		// Playwright CDP access is different
		const browser = this.context.browser();
		if (!browser) {
			throw new Error('Browser context not available for CDP session');
		}

		// Get the CDP session from the page
		const cdpSession = await this.page.context().newCDPSession(this.page);
		return new PlaywrightCDPSessionWrapper(cdpSession);
	}

	async close(): Promise<void> {
		await this.page.close();
	}

	async goto(url: string, options?: any): Promise<void> {
		await this.page.goto(url, options);
	}

	on(event: string, handler: (...args: unknown[]) => void): void {
		this.page.on(event as any, handler as any);
	}

	off(event: string, handler: (...args: unknown[]) => void): void {
		this.page.off(event as any, handler as any);
	}
}

class PlaywrightBrowserWrapper implements IBrowser {
	private _context: BrowserContext | null = null;
	private _browser: PlaywrightBrowser | null = null;
	private _isPersistent: boolean = false;
	private _wsEndpoint: string = '';

	constructor(browser: PlaywrightBrowser | null, context?: BrowserContext, wsEndpoint?: string) {
		this._browser = browser;
		this._context = context || null;
		this._isPersistent = !browser && !!context; // Persistent context has no separate browser
		this._wsEndpoint = wsEndpoint || '';
	}

	get context(): BrowserContext | null {
		return this._context;
	}

	set context(ctx: BrowserContext | null) {
		this._context = ctx;
	}

	async pages(): Promise<IPage[]> {
		if (this._context) {
			const pages = this._context.pages();
			return pages.map(page => new PlaywrightPageWrapper(page, this._context!));
		}

		if (this._browser) {
			const contexts = this._browser.contexts();
			if (contexts.length === 0) {
				return [];
			}
			this._context = contexts[0];
			const pages = this._context.pages();
			return pages.map(page => new PlaywrightPageWrapper(page, this._context!));
		}

		return [];
	}

	async newPage(): Promise<IPage> {
		if (!this._context) {
			if (this._browser) {
				this._context = await this._browser.newContext();
			} else {
				throw new Error('No browser or context available');
			}
		}

		const page = await this._context.newPage();
		return new PlaywrightPageWrapper(page, this._context);
	}

	async close(): Promise<void> {
		if (this._isPersistent && this._context) {
			// For persistent context, closing context closes browser
			await this._context.close();
		} else {
			if (this._context) {
				await this._context.close();
			}
			if (this._browser) {
				await this._browser.close();
			}
		}
	}

	wsEndpoint(): string {
		if (this._wsEndpoint) {
			return this._wsEndpoint;
		}
		
		// Try to get from browser internals
		if (this._browser) {
			const browser = this._browser as any;
			if (browser._connection && browser._connection._url) {
				return browser._connection._url;
			}
		}
		
		// For persistent context, try to get from context
		if (this._context) {
			const ctx = this._context as any;
			if (ctx._browser?._connection?._url) {
				return ctx._browser._connection._url;
			}
		}
		
		// Return empty - caller should handle
		return '';
	}

	on(event: string, handler: Function): void {
		if (event === 'targetcreated') {
			// Playwright uses 'page' event on context for new pages
			if (this._context) {
				this._context.on('page', handler as any);
			}
		} else if (event === 'disconnected') {
			if (this._browser) {
				this._browser.on('disconnected', handler as any);
			}
		}
	}

	off(event: string, handler: Function): void {
		if (event === 'targetcreated') {
			if (this._context) {
				this._context.off('page', handler as any);
			}
		} else if (event === 'disconnected') {
			if (this._browser) {
				this._browser.off('disconnected', handler as any);
			}
		}
	}

	get connected(): boolean {
		if (this._browser) {
			return this._browser.isConnected();
		}
		// For persistent context, check if context is valid
		if (this._context) {
			try {
				// If we can get pages, we're connected
				this._context.pages();
				return true;
			} catch {
				return false;
			}
		}
		return false;
	}

	async version(): Promise<string> {
		// Playwright doesn't expose version directly, get it from a page
		if (this._context && this._context.pages().length > 0) {
			const page = this._context.pages()[0];
			const ua = await page.evaluate(() => navigator.userAgent);
			// Extract version from user agent
			const match = ua.match(/Chrome\/([\d.]+)/);
			return match ? match[1] : 'unknown';
		}
		return 'unknown';
	}

	async userAgent(): Promise<string> {
		// Get user agent from a page
		if (this._context && this._context.pages().length > 0) {
			const page = this._context.pages()[0];
			return await page.evaluate(() => navigator.userAgent);
		}
		// Create a temporary page to get user agent
		if (this._context) {
			const page = await this._context.newPage();
			const ua = await page.evaluate(() => navigator.userAgent);
			await page.close();
			return ua;
		}
		return '';
	}
}

export class PlaywrightDriver implements IDriver {
	name = 'playwright';

	async launch(options: LaunchOptions): Promise<IBrowser> {
		// Extract userDataDir from args (Playwright handles it differently)
		let userDataDir: string | undefined;
		let filteredArgs = options.args || [];
		
		// Extract remote debugging port for wsEndpoint
		let debugPort = '';
		const portArg = filteredArgs?.find(arg => arg.startsWith('--remote-debugging-port='));
		if (portArg) {
			debugPort = portArg.split('=')[1];
		}
		
		const userDataDirArg = filteredArgs?.find(arg => arg.startsWith('--user-data-dir='));
		if (userDataDirArg) {
			userDataDir = userDataDirArg.split('=')[1];
			filteredArgs = filteredArgs.filter(arg => !arg.startsWith('--user-data-dir='));
		}

		const launchOptions: any = {
			headless: options.headless,
			args: filteredArgs,
			env: options.env,
			executablePath: options.executablePath,
			viewport: options.defaultViewport ? {
				width: options.defaultViewport.width,
				height: options.defaultViewport.height
			} : undefined
		};

		let context: BrowserContext;
		let browser: PlaywrightBrowser | null = null;

		if (userDataDir) {
			// Use launchPersistentContext for user data directory
			context = await chromium.launchPersistentContext(userDataDir, launchOptions);
		} else {
			// Regular launch
			browser = await chromium.launch(launchOptions);
			context = await browser.newContext({
				viewport: launchOptions.viewport
			});
		}

		// Fetch proper wsEndpoint from browser's debug port (includes /devtools/browser/{uuid})
		let wsEndpoint = '';
		if (debugPort) {
			wsEndpoint = await fetchWsEndpoint(debugPort);
		}

		return new PlaywrightBrowserWrapper(browser, context, wsEndpoint);
	}

	async connect(options: ConnectOptions): Promise<IBrowser> {
		if (!options.browserWSEndpoint) {
			throw new Error('browserWSEndpoint is required for Playwright connect');
		}

		// Playwright uses connectOverCDP for connecting to existing browser
		const browser = await chromium.connectOverCDP(options.browserWSEndpoint);
		
		// Get or create context
		const contexts = browser.contexts();
		const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
		
		return new PlaywrightBrowserWrapper(browser, context, options.browserWSEndpoint);
	}
}

