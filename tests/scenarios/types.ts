import type { Browser as PuppeteerBrowser, Page as PuppeteerPage } from "puppeteer-core"
import type { Browser as PlaywrightBrowser, Page as PlaywrightPage } from "playwright"

export interface Scenario {
    name: string
    description: string
    puppeteer: (browser: PuppeteerBrowser, page: PuppeteerPage) => Promise<void>
    playwright: (browser: PlaywrightBrowser, page: PlaywrightPage) => Promise<void>
}

