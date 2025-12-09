import puppeteer from 'puppeteer-core'
import { chromium } from 'playwright'
import * as scenarios from "./scenarios"
import type { Scenario } from "./scenarios"

// Configuration - always localhost direct connect
const CONFIG = {
    host: 'localhost',
    cdpPort: 10222,        // CDP port (mapped from container's 19222)
    apiPort: 7070,         // API port (mapped from container's 8080)
}

// Driver types
type Driver = 'puppeteer' | 'playwright'

// Available scenarios (each must implement both puppeteer and playwright)
const SCENARIOS: Record<string, Scenario> = {
    goToGoogle: scenarios.goToGoogle,
}

async function getBrowserUUID(): Promise<string | null> {
    try {
        // Get UUID from CDP /json/version endpoint
        const response = await fetch(`http://${CONFIG.host}:${CONFIG.cdpPort}/json/version`)
        const data = await response.json()
        if (data.webSocketDebuggerUrl) {
            // Extract UUID from: ws://localhost:10222/devtools/browser/{uuid}
            const match = data.webSocketDebuggerUrl.match(/\/devtools\/browser\/([a-f0-9-]+)/)
            if (match) {
                return match[1]
            }
        }
        return null
    } catch (error) {
        console.error('[ERROR] Failed to get browser UUID:', error)
        return null
    }
}

async function runWithPuppeteer(wsEndpoint: string, scenario: Scenario): Promise<void> {
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint })
    const page = await browser.newPage()
    
    try {
        await scenario.puppeteer(browser, page)
        console.log('[INFO] Scenario completed. Current URL:', page.url())
    } finally {
        browser.disconnect()
    }
}

async function runWithPlaywright(wsEndpoint: string, scenario: Scenario): Promise<void> {
    const browser = await chromium.connectOverCDP(wsEndpoint)
    const context = browser.contexts()[0] || await browser.newContext()
    const page = context.pages()[0] || await context.newPage()
    
    try {
        await scenario.playwright(browser, page)
        console.log('[INFO] Scenario completed. Current URL:', page.url())
    } finally {
        await browser.close()
    }
}

async function main(driver: Driver = 'puppeteer', scenarioName?: string, browserUUID?: string) {
    // Default scenario
    const scenarioKey = scenarioName || 'goToGoogle'
    
    // Check if scenario exists
    const scenario = SCENARIOS[scenarioKey]
    if (!scenario) {
        console.error(`[ERROR] Unknown scenario: ${scenarioKey}`)
        console.log('[INFO] Available scenarios:', Object.keys(SCENARIOS).join(', '))
        return
    }

    // Get browser UUID if not provided
    let uuid: string | undefined = browserUUID
    if (!uuid) {
        console.log('[INFO] No UUID provided, fetching from API...')
        const fetchedUUID = await getBrowserUUID()
        if (!fetchedUUID) {
            console.error('[ERROR] Could not get browser UUID. Make sure browser is launched.')
            console.log('[TIP] Launch browser first via: POST http://localhost:7070/action/launch')
            return
        }
        uuid = fetchedUUID
    }

    const wsEndpoint = `ws://${CONFIG.host}:${CONFIG.cdpPort}/devtools/browser/${uuid}`
    
    try {
        console.log(`[INFO] Driver: ${driver}`)
        console.log(`[INFO] Scenario: ${scenario.name} - ${scenario.description}`)
        console.log('[INFO] Connecting to:', wsEndpoint)
        
        if (driver === 'puppeteer') {
            await runWithPuppeteer(wsEndpoint, scenario)
        } else {
            await runWithPlaywright(wsEndpoint, scenario)
        }
        
        console.log('[INFO] Disconnected from browser')
    } catch (error) {
        console.error('[ERROR] Test failed:', error)
    }
}

// Parse args: npm run test -- [driver] [scenario] [uuid]
// driver: puppeteer | playwright (default: puppeteer)
const driverArg = process.argv[2] as Driver | undefined
const scenarioArg = process.argv[3]
const uuidArg = process.argv[4]

// Validate driver
const validDrivers: Driver[] = ['puppeteer', 'playwright']
const driver: Driver = driverArg && validDrivers.includes(driverArg) ? driverArg : 'puppeteer'

main(driver, scenarioArg, uuidArg)
