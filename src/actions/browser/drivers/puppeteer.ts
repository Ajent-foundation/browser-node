/**
 * Puppeteer driver implementation
 */

import puppeteer, { Browser as PuppeteerBrowser, Page as PuppeteerPage, LaunchOptions as PuppeteerLaunchOptions, CookieData } from 'puppeteer';
import { IDriver, IBrowser, IPage, ICDPSession } from './interfaces';
import { LaunchOptions, ConnectOptions, Cookie, Viewport } from './types';

class PuppeteerPageWrapper implements IPage {
	constructor(private page: PuppeteerPage) {}

	url(): string {
		return this.page.url();
	}

	async title(): Promise<string> {
		return await this.page.title();
	}

	async cookies(): Promise<Cookie[]> {
		// Use BrowserContext.cookies() instead of deprecated page.cookies()
		const browserContext = this.page.browserContext();
		// BrowserContext.cookies() returns all cookies for the context (no URL parameter)
		const cookies = await browserContext.cookies();
		// Filter cookies for the current page URL if needed
		const pageUrl = this.page.url();
		return cookies
			.filter(cookie => {
				// If cookie has a domain, check if it matches the page URL
				if (cookie.domain && pageUrl) {
					try {
						const url = new URL(pageUrl);
						return url.hostname.includes(cookie.domain.replace(/^\./, ''));
					} catch {
						return true; // If URL parsing fails, include the cookie
					}
				}
				return true;
			})
			.map(cookie => ({
				name: cookie.name,
				value: cookie.value,
				domain: cookie.domain,
				path: cookie.path,
				expires: cookie.expires,
				httpOnly: cookie.httpOnly,
				secure: cookie.secure,
				sameSite: cookie.sameSite as string
			}));
	}

	async setCookie(...cookies: Cookie[]): Promise<void> {
		// Use BrowserContext.setCookie() instead of deprecated page.setCookie()
		const browserContext = this.page.browserContext();
		// BrowserContext.setCookie() expects CookieData[] which requires domain and url
		const cookieData = cookies.map(cookie => {
			// CookieData requires domain and url, so we need to ensure they're set
			const pageUrl = this.page.url();
			let domain = cookie.domain;
			let url = cookie.url;
			
			if (!url && pageUrl) {
				url = pageUrl;
			}
			if (!domain && url) {
				try {
					const urlObj = new URL(url);
					domain = urlObj.hostname;
				} catch {
					// If URL parsing fails, use the domain from cookie if available
					domain = cookie.domain || '';
				}
			}
			
			return {
				name: cookie.name,
				value: cookie.value,
				domain: domain || '',
				path: cookie.path || '/',
				expires: cookie.expires,
				httpOnly: cookie.httpOnly || false,
				secure: cookie.secure || false,
				sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
				url: url || ''
			};
		});
		await browserContext.setCookie(...cookieData);
	}

	async evaluate<T>(fn: Function | string, ...args: any[]): Promise<T> {
		return await this.page.evaluate(fn as any, ...args);
	}

	async evaluateOnNewDocument(fn: Function | string, ...args: any[]): Promise<void> {
		await this.page.evaluateOnNewDocument(fn as any, ...args);
	}

	async setViewport(viewport: Viewport): Promise<void> {
		await this.page.setViewport(viewport);
	}

	async emulateTimezone(timezone: string): Promise<void> {
		try {
			// Check if page is still open before attempting timezone emulation
			if (this.page.isClosed()) {
				return;
			}
			await this.page.emulateTimezone(timezone);
		} catch (error: any) {
			// Ignore errors if page is closed or target is closed
			if (error?.name === 'TargetCloseError' || error?.message?.includes('Session closed') || this.page.isClosed()) {
				return;
			}
			throw error;
		}
	}

	async createCDPSession(): Promise<ICDPSession> {
		const session = await this.page.createCDPSession();
		return {
			send: (method: string, params?: any) => session.send(method as any, params),
			on: (event: string, handler: Function) => session.on(event as any, handler as any),
			off: (event: string, handler: Function) => session.off(event as any, handler as any),
			detach: () => session.detach()
		};
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

class PuppeteerBrowserWrapper implements IBrowser {
	constructor(private browser: PuppeteerBrowser) {}

	async pages(): Promise<IPage[]> {
		const pages = await this.browser.pages();
		return pages.map(page => new PuppeteerPageWrapper(page));
	}

	async newPage(): Promise<IPage> {
		const page = await this.browser.newPage();
		return new PuppeteerPageWrapper(page);
	}

	async close(): Promise<void> {
		await this.browser.close();
	}

	wsEndpoint(): string {
		return this.browser.wsEndpoint();
	}

	on(event: string, handler: Function): void {
		this.browser.on(event as any, handler as any);
	}

	off(event: string, handler: Function): void {
		this.browser.off(event as any, handler as any);
	}

	get connected(): boolean {
		return this.browser.connected;
	}

	async version(): Promise<string> {
		return await this.browser.version();
	}

	async userAgent(): Promise<string> {
		return await this.browser.userAgent();
	}
}

export class PuppeteerDriver implements IDriver {
	name = 'puppeteer';

	async launch(options: LaunchOptions): Promise<IBrowser> {
		const puppeteerOptions: PuppeteerLaunchOptions = {
			executablePath: options.executablePath,
			headless: options.headless,
			args: options.args,
			env: options.env,
			pipe: options.pipe,
			defaultViewport: options.defaultViewport ? {
				width: options.defaultViewport.width,
				height: options.defaultViewport.height
			} : undefined,
			ignoreDefaultArgs: options.ignoreDefaultArgs
		};

		const browser = await puppeteer.launch(puppeteerOptions);
		return new PuppeteerBrowserWrapper(browser);
	}

	async connect(options: ConnectOptions): Promise<IBrowser> {
		if (!options.browserWSEndpoint) {
			throw new Error('browserWSEndpoint is required for Puppeteer connect');
		}

		const browser = await puppeteer.connect({
			browserWSEndpoint: options.browserWSEndpoint
		});
		return new PuppeteerBrowserWrapper(browser);
	}
}

