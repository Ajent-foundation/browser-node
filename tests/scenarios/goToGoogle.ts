import type { Browser as PuppeteerBrowser, Page as PuppeteerPage } from "puppeteer-core"
import type { Browser as PlaywrightBrowser, Page as PlaywrightPage } from "playwright"
import type { Scenario } from "./types"

export const goToGoogle: Scenario = {
    name: 'goToGoogle',
    description: 'Navigate to Google and print the page title',
    
    async puppeteer(browser: PuppeteerBrowser, page: PuppeteerPage): Promise<void> {
        await page.goto("https://www.google.com")
        console.log("[INFO] [Puppeteer] Page title:", await page.title())
    },
    
    async playwright(browser: PlaywrightBrowser, page: PlaywrightPage): Promise<void> {
        await page.goto("https://www.google.com")
        console.log("[INFO] [Playwright] Page title:", await page.title())
    }
}
