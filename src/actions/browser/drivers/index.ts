/**
 * Driver factory and exports
 */

import { IDriver } from './interfaces';
import { PuppeteerDriver } from './puppeteer';
import { PlaywrightDriver } from './playwright';

export * from './interfaces';
export * from './types';
export { PuppeteerDriver } from './puppeteer';
export { PlaywrightDriver } from './playwright';

/**
 * Get driver instance by name
 */
export function getDriver(driverName: 'puppeteer' | 'playwright'): IDriver {
	switch (driverName) {
		case 'puppeteer':
			return new PuppeteerDriver();
		case 'playwright':
			return new PlaywrightDriver();
		default:
			throw new Error(`Unknown driver: ${driverName}`);
	}
}

/**
 * Get default driver (Puppeteer)
 */
export function getDefaultDriver(): IDriver {
	return new PuppeteerDriver();
}

