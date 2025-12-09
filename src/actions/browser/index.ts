import { createFingerprintingProtection, FingerprintingProtection } from "./fingerprinting"
import { LOGGER } from "../../base/logger"
import { configVars } from "../../base/env"
import { sleep } from "../../base/utility/helpers"
import { freeNode } from "../"
import { spawn } from "child_process"
import crypto from "crypto"
import path from "path"
import axios, { isAxiosError } from "axios"
import { execSync } from "child_process"
import UserAgent from "user-agents"
import * as fs from 'fs'
import { getDriver, IBrowser, IPage, LaunchOptions as DriverLaunchOptions, Cookie } from "./drivers"
import { insertNetworkRequest, updateNetworkResponse, parseCookieHeader, parseSetCookieHeaders } from "../../db/modules/dataCollection"
import BetterSqlite3 from "better-sqlite3"

export type BrowserStorageData = Record<string, object>

export type BrowserData = {
    url: string
    title: string
    cookies: Cookie[]
    localStorage: BrowserStorageData
    sessionStorage: BrowserStorageData
}

function getIndexFromUUID(uuid: string, arrayLength: number): number {
    const hash = crypto.createHash('sha256')
    hash.update(uuid);
    const hashValue = hash.digest('hex')
    const numericHashValue = parseInt(hashValue, 16)
    return numericHashValue % arrayLength
}


export type SuccessBrowserLaunchResponse = {
    uuid       : string
    fullWsPath : string
    version    : string
    userAgent  : string
    instance   : IBrowser
    pids       : number[]
}

let browser: IBrowser | null = null

// Network recording state
let networkRecordingDb: BetterSqlite3.Database | null = null;
let networkRecordingSessionId: string | null = null;

// ==================== Network Interception ====================

interface NetworkRequestData {
    requestId: string;
    request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        postData?: string;
    };
    type?: string;
}

interface NetworkResponseData {
    requestId: string;
    response: {
        status: number;
        headers: Record<string, string>;
        timing?: Record<string, number>;
    };
}

interface NetworkFailedData {
    requestId: string;
    errorText: string;
}

interface CDPSessionLike {
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    on: (event: string, callback: (params: unknown) => void) => void;
}

export async function enableNetworkRecording(dbPath: string, sessionId: string): Promise<void> {
    try {
        networkRecordingDb = new BetterSqlite3(dbPath);
        networkRecordingSessionId = sessionId;
        LOGGER.info('Network recording enabled', { dbPath, sessionId });
        
        // Attach network listeners to ALL existing pages
        if (browser) {
            const pages = await browser.pages();
            for (const page of pages) {
                try {
                    await attachNetworkListeners(page);
                    LOGGER.info('Network listeners attached to existing page', { url: page.url() });
                } catch (error) {
                    LOGGER.warn('Failed to attach network listeners to existing page', { error });
                }
            }
        }
    } catch (error) {
        LOGGER.error('Failed to enable network recording', { error });
    }
}

export function disableNetworkRecording(): void {
    if (networkRecordingDb) {
        networkRecordingDb.close();
        networkRecordingDb = null;
    }
    networkRecordingSessionId = null;
    LOGGER.info('Network recording disabled');
}

async function attachNetworkListeners(page: IPage): Promise<void> {
    if (!networkRecordingDb || !networkRecordingSessionId) {
        return;
    }
    
    const db = networkRecordingDb;
    const sessionId = networkRecordingSessionId;
    
    // Track requests by URL for matching with responses
    const pendingRequests = new Map<string, { requestId: string; timestamp: number }>();
    
    try {
        // Use page-level events - works for BOTH Puppeteer AND Playwright!
        
        // Request event - fired when request is issued
        page.on('request', (request: unknown) => {
            const req = request as {
                url: () => string;
                method: () => string;
                headers: () => Record<string, string>;
                postData: () => string | undefined;
                resourceType: () => string;
            };
            
            const timestamp = Date.now();
            const url = req.url();
            const method = req.method();
            const headers = req.headers() || {};
            const requestId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Extract cookies sent with this request
            const cookiesSent = parseCookieHeader(headers['cookie'] || headers['Cookie'], url);
            
            LOGGER.info('Network request captured', { url, method, cookieCount: cookiesSent.length });
            
            // Store for matching with response
            pendingRequests.set(url, { requestId, timestamp });
            
            try {
                insertNetworkRequest(db, {
                    sessionId,
                    timestamp,
                    requestId,
                    url,
                    method,
                    requestHeaders: JSON.stringify(headers),
                    requestBody: req.postData?.() || null,
                    responseStatus: null,
                    responseHeaders: null,
                    responseBody: null,
                    resourceType: req.resourceType?.() || 'Other',
                    timing: null,
                    cookiesSent: cookiesSent.length > 0 ? JSON.stringify(cookiesSent) : null,
                    cookiesSet: null
                });
            } catch (error) {
                LOGGER.error('Failed to insert network request', { error, url });
            }
        });
        
        // Response event - fired when response is received
        page.on('response', async (response: unknown) => {
            const res = response as {
                url: () => string;
                status: () => number;
                headers: () => Record<string, string>;
                text: () => Promise<string>;
            };
            
            const url = res.url();
            const status = res.status();
            const headers = res.headers() || {};
            const pending = pendingRequests.get(url);
            
            // Extract cookies set by this response
            const cookiesSet = parseSetCookieHeaders(headers, url);
            
            LOGGER.info('Network response captured', { url, status, cookiesSet: cookiesSet.length });
            
            if (pending) {
                try {
                    let responseBody: string | null = null;
                    try {
                        // Try to get response body (may fail for some resources)
                        responseBody = await res.text();
                        if (responseBody && responseBody.length > 100000) {
                            responseBody = responseBody.substring(0, 100000) + '...[truncated]';
                        }
                    } catch {
                        // Body not available (normal for redirects, images, etc.)
                    }
                    
                    updateNetworkResponse(
                        db,
                        sessionId,
                        pending.requestId,
                        status,
                        JSON.stringify(headers),
                        responseBody,
                        null,
                        cookiesSet.length > 0 ? JSON.stringify(cookiesSet) : null
                    );
                } catch (error) {
                    LOGGER.error('Failed to update network response', { error, url });
                }
                
                pendingRequests.delete(url);
            }
        });
        
        // Request failed event
        page.on('requestfailed', (request: unknown) => {
            const req = request as {
                url: () => string;
                failure: () => { errorText: string } | null;
            };
            
            const url = req.url();
            const pending = pendingRequests.get(url);
            
            if (pending) {
                const failure = req.failure?.();
                
                try {
                    updateNetworkResponse(
                        db,
                        sessionId,
                        pending.requestId,
                        0,
                        JSON.stringify({ error: failure?.errorText || 'Request failed' }),
                        null,
                        null
                    );
                } catch {
                    // Silently ignore
                }
                
                pendingRequests.delete(url);
            }
        });
        
        LOGGER.info('Network listeners attached to page', { url: page.url() });
    } catch (error) {
        LOGGER.error('Failed to attach network listeners', { error });
    }
}

export async function closeBrowser() : Promise<void> {
    await freeNode()
    if (browser) {
        await browser.close()
        browser = null
    } 
}

export async function runOnBootScript(): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const bootScript = spawn(
            "sh", [
                "/home/onBoot.sh"
            ], {
                env: {
                    ...process.env,
                    DISPLAY: ':1',
                    PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                }
            }
        )
        const pids: number[] = []

        bootScript.stdout.on('data', (data) => {
            // pid pattern [PID]-324
            const match = data.toString().match(/\[PID\]-(.*)/)
            if (match) {
                pids.push(parseInt(match[1], 10))
            }
            console.log(`boot.sh stdout: ${data}`)
        })

        bootScript.stderr.on('data', (data) => {
            console.error(`boot.sh stderr: ${data}`)
        })

        bootScript.on('error', (error) => {
            reject(error);
        })

        bootScript.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`onBoot.sh exited with code ${code}`));
            } else {
                resolve(pids)
            }
        })
    })
}

async function runOnPreBrowserRunScript(
    isLegacyVNC:boolean,
    enableVNC:boolean,
    secureVNC:boolean,
    isVNCViewOnly:boolean,
    resolution: string,
    depth: number,
    dpi: number,
    language: string,
    timezone: string,
    locale: string,
    numberOfCameras: number,
    numberOfMicrophones: number,
    numberOfSpeakers: number,
    proxy ?: {
        url: string
        username: string
        password: string
    },
): Promise<number[]> {
    //WINDOW
    const windowVars : Record<string, string> = {}
    windowVars["XVFB_RESOLUTION"] = resolution
    windowVars["XVFB_DEPTH"] = depth.toString()
    windowVars["XVFB_DPI"] = dpi.toString()
    windowVars["LANGUAGE"] = language
    windowVars["TIMEZONE"] = timezone
    windowVars["NUM_CAMERAS"] = numberOfCameras.toString()
    windowVars["NUM_MICROPHONES"] = numberOfMicrophones.toString()
    windowVars["NUM_SPEAKERS"] = numberOfSpeakers.toString()
    windowVars["LOCALE"] = locale

    // VNC vars
    const vncVars : Record<string, string> = {}
    if(enableVNC){
        vncVars["VNC_SERVER_ENABLED"] = "TRUE"
        if (isLegacyVNC && secureVNC && process.env.API_KEY) {
            vncVars["VNC_SERVER_PASSWORD"] = process.env.API_KEY
        }
        if(isLegacyVNC && isVNCViewOnly){
            vncVars["VNC_VIEW_ONLY"] = "TRUE"
        }
        if(process.env.VNC_NO_SSL === "true"){
            vncVars["VNC_NO_SSL"] = "true"
        }

        if(!isLegacyVNC && process.env.API_KEY){
            vncVars["VNC_SERVER_PASSWORD"] = process.env.API_KEY
        }
    }

    if(isLegacyVNC){
        vncVars["NEW_WEBSOCKIFY_ENABLED"] = "false"
    } else {
        vncVars["NEW_WEBSOCKIFY_ENABLED"] = "true"
    }

    // PROXY vars
    const proxyVars : Record<string, string> = {}
    if(proxy){
        proxyVars["PROXY_URL"] = proxy.url
        proxyVars["PROXY_USERNAME"] = proxy.username
        proxyVars["PROXY_PASSWORD"] = proxy.password
    }

    return new Promise((resolve, reject) => {
        const bootScript = spawn(
            "sh", [
                "/home/onPreBrowserRun.sh"
            ], {
            env: {
                ...windowVars,
                ...vncVars,
                ...proxyVars,
            }
        })
        const pids: number[] = []

        bootScript.stdout.on('data', (data) => {
            // pid pattern [PID]-324
            const match = data.toString().match(/\[PID\]-(.*)/)
            if (match) {
                pids.push(parseInt(match[1], 10))
            }
            console.log(`onPreBrowserRun.sh stdout: ${data}`)
        })

        bootScript.stderr.on('data', (data) => {
            console.error(`onPreBrowserRun.sh stderr: ${data}`)
        })

        bootScript.on('error', (error) => {
            reject(error);
        })

        bootScript.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`onPreBrowserRun.sh exited with code ${code}`));
            } else {
                resolve(pids)
            }
        })
    })
}

function runListener(targetPort: number = 9222) : Promise<number> {
    return new Promise((resolve, reject) => {
        const browserPort = process.env.NODE_BROWSER_PORT || "19222"
        LOGGER.info(
            `[INFO] Setting up port forwarding from ${browserPort} to localhost:${targetPort}...`,
        )
        
        const httpTunnelPath = process.env.STUNNEL_HTTP === "true" ? true : false
        let pid : number | undefined = undefined
        if (httpTunnelPath){
            LOGGER.info(
                "[INFO] running using socat",
            )

            const socatProcess = spawn('socat', [`TCP4-LISTEN:${browserPort},fork,reuseaddr`, `TCP4:localhost:${targetPort}`], {
                detached: true,
                stdio: 'ignore'
            })
            socatProcess.unref()
            pid=socatProcess.pid
            
        } else {
            LOGGER.info(
                "[INFO] running using stunnel",
            )

            const stunnelConfPath = path.join(process.cwd(), "configs", `stunnel.conf`)
            const stunnelProcess = spawn("stunnel", [stunnelConfPath])
            stunnelProcess.unref()
            pid=stunnelProcess.pid
        }

        if (pid) {
            LOGGER.info(
                `[INFO] Port forwarding setup complete. PID: ${pid}`,
            )
            resolve(pid); // Resolve the promise with the PID
        } else {
            reject(new Error('Failed to start socat process'));
        }
    })
}

export type SupportedResolution = "1280x1024" | "1920x1080" | "1366x768" | "1536x864" | "1280x720" | "1440x900" | "1280x2400"

export interface BrowserConfig {
    window ?: {
        browser ?: "chrome"
        screen ?:{
            resolution ?: SupportedResolution
            depth ?: "24" | "30" | "32"
            dpi ?: "96" | "120" | "144" | "192"
        }
    }
    vnc ?: {
        mode ?: "ro" | "rw"
        isPasswordProtected ?: boolean
        isEnabled ?: boolean
        version ?: "legacy" | "new"
    }
    proxy ?: {
        url : string
        username : string
        password : string
        validate ?: boolean
    }
    driver ?: "puppeteer" | "playwright" | "selenium"
    language ?: string
    timezone ?: string
    platform ?: string
    extensions : string[]
    locale ?: string
    numberOfCameras ?: number
    numberOfMicrophones ?: number
    numberOfSpeakers ?: number
    overrideUserAgent ?: string
    fingerprinting ?: {
        enabled ?: boolean
        hardwareConcurrency ?: number
        deviceMemory ?: number
        maxTouchPoints ?: number
    }
    recordData ?: boolean // When true, browser uses port 9223 so CDP proxy can intercept on 9222
}

interface proxyInfo {
    ip: string
    hostname: string
    city: string
    region: string
    country: string
    loc: string
    org: string
    postal: string
    timezone: string
    readme: string
}

export async function launchBrowser(
    sessionID: string,
    config: BrowserConfig,
    fingerprintingProtectionInstance?: FingerprintingProtection | null
) : Promise<SuccessBrowserLaunchResponse|null> {    
    const IS_LOCAL = false // process.env.IS_LOCAL === "true"
    // Deconstruct object into its default values

    // PROXY
    const PROXY_URL = config.proxy?.url || ""
    const PROXY_USERNAME = config.proxy?.username || ""
    const PROXY_PASSWORD = config.proxy?.password || ""
    const PROXY_VALIDATE = config.proxy?.validate || false

    // VNC
    const VNC_MODE = config.vnc?.mode || "rw"
    const VNC_IS_PASSWORD_PROTECTED = config.vnc?.isPasswordProtected || false
    const VNC_IS_ENABLED = config.vnc?.isEnabled || true
    const VNC_VERSION = config.vnc?.version || "legacy"
    
    // Window
    const WINDOW_BROWSER = config.window?.browser || "chrome"
    const WINDOW_SCREEN_RESOLUTION = config.window?.screen?.resolution || "1280x1024"
    const WINDOW_SCREEN_DEPTH = config.window?.screen?.depth || 24
    const WINDOW_SCREEN_DPI = config.window?.screen?.dpi || 96


    // Driver
    const DRIVER = config.driver || "puppeteer"
    const PLATFORM = config.platform || "win32"
    const EXTENSIONS = config.extensions || []
    const LOCALE = config.locale || "en-US"
    const NUMBER_OF_CAMERAS = config.numberOfCameras || 1
    const NUMBER_OF_MICROPHONES = config.numberOfMicrophones || 1
    const NUMBER_OF_SPEAKERS = config.numberOfSpeakers || 1
    const LANGUAGE = config.language || "en-US"
    const TIMEZONE = config.timezone || "America/New_York"
    const OVERRIDE_USER_AGENT = config.overrideUserAgent || ""
    
    // Recording - when enabled, browser uses 9223 so CDP proxy can intercept on 9222
    const RECORD_DATA = config.recordData || false
    const BROWSER_DEBUG_PORT = RECORD_DATA ? 9223 : 9222

    try {
        // STEP 1: Validate Proxy
        let spkiFingerprint = ""
        let isProxyValidated = false
        let proxyEstablished = false
        if(config.proxy) {
            const httpsProxyUrl = `https://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_URL}`
            try {
                const deconstructedUrl : string[] = config.proxy.url.split(":")
                const response = await axios.get<proxyInfo>('http://ip-api.com/json', {
                    proxy: {
                        host: deconstructedUrl[0],
                        port: Number(deconstructedUrl[1]),
                        auth: {
                            username: config.proxy.username,
                            password: config.proxy.password
                        }
                    }
                })

                if (response.status === 200) { 
                    LOGGER.info(
                        "Successfully validated IP address from proxy",
                        {
                            httpsProxyUrl,
                            ...response.data
                        }
                    )

                    isProxyValidated = true
                }
            } catch(error:unknown){
                if (isAxiosError(error)) {
                    LOGGER.error(
                        "Failed to validate IP address from proxy",
                        {
                            message: error.message,
                            response: error.response?.data
                        }
                    )
                } else {
                    LOGGER.error(
                        "Failed to validate IP address from proxy",
                        {
                            message: error instanceof Error ? error.message : "Unknown Error"
                        }
                    )
                }
            }
        }

        // Validation Result 
        if (config.proxy && PROXY_VALIDATE && !isProxyValidated) {
            return Promise.reject({
                code: "PROXY_VALIDATION_FAILED",
                message: "Failed to validate IP address from proxy"
            })
        }

        // STEP 2: Run boot script
        let pids : number[] = []
        if(!IS_LOCAL){
            try {
                pids = await runOnPreBrowserRunScript(
                    VNC_VERSION === "legacy",
                    VNC_IS_ENABLED,
                    VNC_IS_PASSWORD_PROTECTED,
                    VNC_MODE === "ro",
                    WINDOW_SCREEN_RESOLUTION,
                    Number(WINDOW_SCREEN_DEPTH),
                    Number(WINDOW_SCREEN_DPI),
                    LANGUAGE,
                    TIMEZONE,
                    LOCALE,
                    NUMBER_OF_CAMERAS,
                    NUMBER_OF_MICROPHONES,
                    NUMBER_OF_SPEAKERS,
                    config.proxy && isProxyValidated ? config.proxy : undefined
                )
            } catch (error:unknown) {
                if (error instanceof Error) {
                    LOGGER.error(
                        "Failed to run boot script",
                        {
                            message: error.message,
                            stack: error.stack
                        }
                    )
                }

                return Promise.reject({
                    code: "BOOT_SCRIPT_FAILED",
                    message: "Failed to run boot script"
                })
            }

            // STEP 3: Generate SPKI Fingerprint
            if(isProxyValidated){
                try{
                    const command = "openssl x509 -noout -in /home/mitmproxy/mitmproxy-ca-cert.pem -pubkey | openssl rsa -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64"
                    spkiFingerprint = execSync(command).toString().trim()
                    proxyEstablished = true
                    LOGGER.info("Successfully generated SPKI fingerprint", { spkiFingerprint })
                } catch(e){
                    LOGGER.error("Failed to generate SPKI fingerprint")
                    // Validation Result 
                    if (config.proxy && PROXY_VALIDATE && !proxyEstablished) {
                        return Promise.reject({
                            code: "PROXY_VALIDATION_FAILED",
                            message: "Failed to validate IP address from proxy"
                        })
                    }
                }
            }
        }

        // Generate UserAgent using the library like before
        const userAgent = OVERRIDE_USER_AGENT || new UserAgent({
            deviceCategory: 'desktop',
            platform: 'Win32'
        }).toString();
        
        const extensionArgs : string[] = []
        if(!IS_LOCAL){
            const baseExtensions : string[]= [
                //"uBlockOrigin",
                "webrtc",
                //"mhtml"
            ]
            const userExtensions : string[] = [
                // "saveToGoogleDrive",
                // "honey",  => opens a tab
                // "grammarly", => opens a tab
                // "googleTranslate",
                //"colorblindly",
            ]

            const extensionsDir = '/home/user/extensions'
            const extensionDirs = fs.readdirSync(extensionsDir).filter(file => {
                const dirPath = path.join(extensionsDir, file)
                const manifestPath = path.join(dirPath, 'manifest.json')
                return baseExtensions.concat(userExtensions).includes(file) && fs.statSync(dirPath).isDirectory() && fs.existsSync(manifestPath)
            })

            const extensionPaths = extensionDirs.map(dir => path.join(extensionsDir, dir))
            const disableExtensionsExceptArgs = `--disable-extensions-except=${extensionPaths.join(',')}`
            const loadExtensionArgs = extensionPaths.map(dir => `--load-extension=${dir}`)
            extensionArgs.push(disableExtensionsExceptArgs)
            extensionArgs.push(...loadExtensionArgs)
        }

        // Browser to use
        let appName = "google-chrome"
        
        // Get the appropriate driver
        const driver = getDriver(DRIVER as 'puppeteer' | 'playwright');

        // https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md#--enable-automation
        const opts: DriverLaunchOptions = {
            executablePath: IS_LOCAL ? undefined : `/usr/bin/${appName}`,
            //userDataDir: IS_LOCAL ? undefined : '/home/user/temp',
            headless: false,
            env: IS_LOCAL ? undefined : {
                DISPLAY: ":1",
                LANG: LOCALE,
                LC_ALL: LOCALE,
                LANGUAGE: LANGUAGE,
                TZ: TIMEZONE,
            },
            pipe: false,
            args: [
                "--url about:blank",
                `--user-agent=${userAgent}`,

                // Notifications
                "--disable-geolocation",
                "--disable-notifications",
                '--use-fake-ui-for-media-stream',
                "--suppress-message-center-popups",

                // Misc
                "--log-level=3",
                "--start-maximized",
                "--safebrowsing-disable-auto-update",
                "--metrics-recording-only",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-ipc-flooding-protection",
                "--use-mock-keychain",
                "--password-store=basic",
                "--force-color-profile=srgb",

                // Nos
                "--no-first-run",
                "--no-default-browser-check",
                "--no-experiments",
                "--no-user-gesture-required",

                // Disable
                // "--disable-gpu",
                "--disable-infobars",
                "--disable-sync",
                "--disable-default-apps",
                "--disable-datasaver-prompt",
                "--disable-hang-monitor",
                "--disable-background-downloads",
                "--disable-threaded-animation",
                "--disable-threaded-scrolling",
                "--disable-prompt-on-repost",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--disable-component-update",
                "--disable-breakpad",
                "--disable-checker-imaging",
                "--disable-image-animation-resync",
                "--disable-new-content-rendering-timeout",
                "--disable-dev-shm-usage",
                "--disable-client-side-phishing-detection",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=PasswordManager,AutofillAssistant,DoNotTrack,IsolateOrigins,SameSiteByDefaultCookies,LazyFrameLoading,VizDisplayCompositor",
                "--disable-canvas-aa", // Disable canvas anti-aliasing for consistency
                "--disable-2d-canvas-clip-aa", // Disable 2D canvas clip anti-aliasing
                "--disable-gl-drawing-for-tests", // Disable GL drawing for tests
                //"--disable-site-isolation-trials",
                // "--disable-web-security",
                "--disable-component-update",
                
                // DevTools - when recording, use 9223 so CDP proxy intercepts on 9222
                `--remote-debugging-port=${BROWSER_DEBUG_PORT}`,
                "--remote-debugging-address=0.0.0.0"
            ]
                .concat(IS_LOCAL ? [] : [
                    "--no-sandbox",
                    "--user-data-dir=/home/user/temp",
                    //"--remote-debugging-pipe"
                ])
                .concat(config.proxy && proxyEstablished ? [   
                    "--proxy-server=http://localhost:8081",
                    `--ignore-certificate-errors-spki-list=${spkiFingerprint}`,
                    "--ssl-key-log-file=/home/mitmproxy/mitmproxy-ca-cert.pem"
                ] : [])
                .concat(extensionArgs),
            defaultViewport: {
                width: Number(WINDOW_SCREEN_RESOLUTION.split("x")[0]),
                height: Number(WINDOW_SCREEN_RESOLUTION.split("x")[1])
            },
            ignoreDefaultArgs: [
                "--enable-automation",
                "--enable-blink-features=IdleDetection"
            ],
        }

        LOGGER.info(
            "Launching browser",
            {
                IS_LOCAL,
                driver: driver.name,
                opts
            }
        )

        try{
            browser = await driver.launch(opts)
        }
        catch(error:unknown){
            if(error instanceof Error){
                LOGGER.critical(
                    "Error launching browser", 
                    {  
                        message: error.message,
                        stack: error.stack
                    }
                )
            }
        }

        if(!browser){
            return Promise.reject({
                code: "BROWSER_CONNECTION_FAILED",
                message: "Failed to Launch Browser"
            })
        }

        // Registered Browser Events
        browser.on("disconnected", async () => {
            browser = null
            // Close the browser instance
            await closeBrowser()
            // await gracefulShutdown("exit", null, true)
        })

        // Use the passed fingerprinting protection instance (which has IP-adjusted values)
        // or create a new one if none was passed
        let fingerprintingProtection = fingerprintingProtectionInstance;
        
        // If we have a fingerprinting protection instance, update it with the actual UserAgent
        if (fingerprintingProtection) {
            // Create a new instance with the actual UserAgent for consistency
            fingerprintingProtection = new FingerprintingProtection(
                fingerprintingProtection.getConfig(), // Access the config via getter
                undefined, // No request criteria needed
                userAgent // Pass the actual UserAgent
            );
        } else if (config.fingerprinting?.enabled !== false) {
            // Create new fingerprinting protection with actual UserAgent
            fingerprintingProtection = createFingerprintingProtection(
                userAgent,
                PLATFORM,
                LANGUAGE,
                TIMEZONE,
                config.fingerprinting ? {
                    hardwareConcurrency: config.fingerprinting.hardwareConcurrency,
                    deviceMemory: config.fingerprinting.deviceMemory,
                    maxTouchPoints: config.fingerprinting.maxTouchPoints
                } : undefined
            );
        } else {
            fingerprintingProtection = null;
        }

        // Shared page setup function - used by both Puppeteer and Playwright
        const setupNewPage = async (page: IPage): Promise<void> => {
            // Wait for page to initialize
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Log page URL
            try {
                LOGGER.info('Setting up new page', { url: page.url() });
            } catch {
                LOGGER.info('Setting up new page', { url: 'unable to get URL' });
            }
            
            // Apply fingerprinting protection
            if (fingerprintingProtection) {
                try {
                    await fingerprintingProtection.applyProtections(page);
                } catch (error) {
                    LOGGER.error("Failed to apply fingerprinting protections", { error });
                }
            }
            
            // Set timezone
            try {
                await page.emulateTimezone(TIMEZONE);
            } catch (error: unknown) {
                const err = error as { name?: string; message?: string };
                const isTargetClosed = err?.name === 'TargetCloseError' || 
                    err?.message?.includes('Session closed') ||
                    err?.message?.includes('Target closed');
                if (!isTargetClosed) {
                    LOGGER.warn("Failed to set timezone", { error: err?.message || error });
                }
            }
            
            // Set download behavior via CDP
            try {
                const client = await page.createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: "/home/user/downloads"
                });
            } catch (error: unknown) {
                const err = error as { name?: string; message?: string };
                const isTargetClosed = err?.name === 'TargetCloseError' || 
                    err?.message?.includes('Session closed') ||
                    err?.message?.includes('Target closed');
                if (!isTargetClosed) {
                    LOGGER.warn("Failed to set download behavior", { error: err?.message || error });
                }
            }
            
            // Attach network listeners for data collection
            if (networkRecordingDb && networkRecordingSessionId) {
                try {
                    await attachNetworkListeners(page);
                } catch (error) {
                    LOGGER.error("Failed to attach network listeners", { error });
                }
            }
        };

        // Listen for new pages - works for both Puppeteer and Playwright
        if (browser) {
            if (DRIVER === 'puppeteer') {
                // Puppeteer uses targetcreated on the underlying browser
                const puppeteerBrowser = (browser as unknown as { browser?: { on: (event: string, handler: (target: unknown) => void) => void } }).browser;
                if (puppeteerBrowser?.on) {
                    puppeteerBrowser.on('targetcreated', async (target: unknown) => {
                        try {
                            const typedTarget = target as { 
                                type: () => string; 
                                page: () => Promise<unknown>;
                                url: () => string;
                            };
                            
                            LOGGER.info('Target created', { type: typedTarget.type(), url: typedTarget.url?.() || 'N/A' });
                            
                            if (typedTarget.type() === 'page') {
                                const rawPage = await typedTarget.page();
                                if (rawPage && browser) {
                                    await setupNewPage(rawPage as IPage);
                                }
                            }
                        } catch (error) {
                            const err = error as { name?: string; message?: string };
                            const isExpectedError = err?.message?.includes('main frame') || 
                                err?.message?.includes('Session closed') ||
                                err?.message?.includes('Target closed');
                            if (!isExpectedError) {
                                LOGGER.warn("Error in targetcreated handler", { error: err?.message || error });
                            }
                        }
                    });
                }
            } else {
                // Playwright uses 'page' event directly on browser
                browser.on('page', async (page: unknown) => {
                    try {
                        LOGGER.info('New page created', { url: (page as IPage).url?.() || 'N/A' });
                        await setupNewPage(page as IPage);
                    } catch (error) {
                        LOGGER.warn("Error in page handler", { error });
                    }
                });
            }
        }

        // Browser fails to launch
        if(!browser.connected){
            await browser.close()

            return Promise.reject({
                code: "BROWSER_CONNECTION_FAILED",
                message: "Failed to establish connection to browser"
            })
        }

        // Testing Connection
        // Verify connection to browser works
        const maxAttempts = 10
        let browserUUID = ""
        let connectionVerified = false
        let attempt = 0

        while (attempt<maxAttempts) {
            try {
                const wsEndpoint = browser.wsEndpoint();
                if (!wsEndpoint) {
                    throw new Error("Browser does not expose WebSocket endpoint");
                }

                let connection = await driver.connect({ 
                    browserWSEndpoint: wsEndpoint
                })
                const connectionWsEndpoint = connection.wsEndpoint()

                const pages = await connection.pages()
                if(pages.length!==0){
                    const newPage = await connection.newPage()
                    await pages[0].close()

                    // Apply fingerprinting protection to initial page
                    if (fingerprintingProtection) {
                        try {
                            await fingerprintingProtection.applyProtections(newPage);
                        } catch (error) {
                            LOGGER.error("Failed to apply fingerprinting protections to initial page", { error });
                        }
                    }

                    // Set Viewport
                    await newPage.setViewport({
                        width: Number(WINDOW_SCREEN_RESOLUTION.split("x")[0]),
                        height: Number(WINDOW_SCREEN_RESOLUTION.split("x")[1])
                    })

                    // Set timezone consistently
                    try {
                        await newPage.emulateTimezone(TIMEZONE);
                    } catch (error: any) {
                        // Silently ignore timezone errors if page/target is closed
                        const isTargetClosed = error?.name === 'TargetCloseError' || 
                            error?.message?.includes('Session closed') ||
                            error?.message?.includes('Target closed');
                        if (!isTargetClosed) {
                            LOGGER.warn("Failed to set timezone on new page", { error: error?.message || error });
                        }
                    }
                }

                if (connection.disconnect) {
                    await connection.disconnect();
                }
                LOGGER.info(
                    `Connected successfully to browser after ${attempt} attempts`,
                )

                // wsEndpoint will be in format:
                // ws://{host}:{port}/devtools/browser/{browser-uuid}
                const finalWsEndpoint = connectionWsEndpoint || wsEndpoint;
                const matchRes = finalWsEndpoint.match(/\/([a-f0-9-]+)$/)
                if(!matchRes && DRIVER !== 'playwright') {
                    throw new Error("Failed to extract browser UUID from wsEndpoint")
                }

                browserUUID = matchRes ? matchRes[1] : `playwright-${Date.now().toString(36)}`
                connectionVerified = true
                if(!IS_LOCAL) {
                    // Forward to 9222 - if recording, CDP proxy will be on 9222 forwarding to browser on 9223
                    pids.push(await runListener(9222))
                }
                break
            } catch (error:unknown) {
                if(attempt == maxAttempts-1){
                    if(error instanceof Error){
                        LOGGER.warn(
                            "Failed to establish connection to browser",
                            {
                                message: error.message,
                                stack: error.stack
                            }
                        )
                    }
                }
            }

            await sleep(configVars.getDelayTime())
            attempt++
        }

        // Failed to verify connection
        if (!connectionVerified) {
            await browser.close()

            return Promise.reject({
                code: "BROWSER_CONNECTION_FAILED",
                message: "Failed to establish connection to browser"
            })
        }
    
        return {
            version: browser.version ? await browser.version() : 'unknown',
            userAgent: browser.userAgent ? await browser.userAgent() : userAgent,
            fullWsPath: browser.wsEndpoint(),
            uuid: browserUUID,
            instance: browser,
            pids: pids
        }
      } catch(error:unknown){
        if(error instanceof Error){
            LOGGER.critical(
                "Error launching browser", 
                {  
                    message: error.message,
                    stack: error.stack
                }
            )
        }
        
        return null
    }
}

export async function extractData() : Promise<BrowserData[]> {
    const data : BrowserData[] = []

    if(!browser){
        return []
    }

    const pages = await browser.pages()
    for(const page of pages) {
        try {
            const pageUrl = page.url()
            
            // Skip pages that don't allow storage access
            if (pageUrl.startsWith('about:') || 
                pageUrl.startsWith('chrome://') || 
                pageUrl.startsWith('chrome-extension://') ||
                pageUrl.startsWith('data:') ||
                pageUrl === '') {
                LOGGER.info('Skipping restricted page for data extraction', { url: pageUrl });
                continue;
            }

            // Get Cookies (usually safe)
            let serializedCookies: Cookie[] = [];
            try {
                const cookies = await page.cookies()
                serializedCookies = cookies.map(cookie => ({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    expires: cookie.expires,
                    httpOnly: cookie.httpOnly,
                    secure: cookie.secure,
                    sameSite: cookie.sameSite
                }));
            } catch (error) {
                LOGGER.warn('Failed to get cookies from page', { url: pageUrl, error });
            }

            // Get Local Storage (can fail on restricted origins)
            let localStorage: BrowserStorageData = {};
            try {
                localStorage = await page.evaluate(() => {
                    const items: Record<string, unknown> = {};
                    for (let i = 0; i < window.localStorage.length; i++) {
                        const key = window.localStorage.key(i);
                        if (key) {
                            try {
                                items[key] = JSON.parse(window.localStorage.getItem(key) || '');
                            } catch {
                                items[key] = window.localStorage.getItem(key);
                            }
                        }
                    }
                    return items;
                });
            } catch (error) {
                LOGGER.warn('Failed to get localStorage from page', { url: pageUrl });
            }

            // Get Session Storage (can fail on restricted origins)
            let sessionStorage: BrowserStorageData = {};
            try {
                sessionStorage = await page.evaluate(() => {
                    const items: Record<string, unknown> = {};
                    for (let i = 0; i < window.sessionStorage.length; i++) {
                        const key = window.sessionStorage.key(i);
                        if (key) {
                            try {
                                items[key] = JSON.parse(window.sessionStorage.getItem(key) || '');
                            } catch {
                                items[key] = window.sessionStorage.getItem(key);
                            }
                        }
                    }
                    return items;
                });
            } catch (error) {
                LOGGER.warn('Failed to get sessionStorage from page', { url: pageUrl });
            }

            let title = '';
            try {
                title = await page.title();
            } catch {
                // Ignore title errors
            }

            data.push({
                url: pageUrl,
                title,
                cookies: serializedCookies,
                localStorage,
                sessionStorage
            });
        } catch (error) {
            LOGGER.warn('Failed to extract data from page', { error });
        }
    }

    return data
}

export async function setData(
    cookies: Cookie[],
    localStorage: BrowserStorageData,
    sessionStorage: BrowserStorageData,
) : Promise<void> {
    if(!browser){
        return
    }
    
    // Get Pages
    const pages = await browser.pages()

    if(pages.length === 0) {
        return
    }

    // Find first page that allows storage access (skip restricted pages)
    let targetPage = null;
    for (const page of pages) {
        const url = page.url();
        if (!url.startsWith('about:') && 
            !url.startsWith('chrome://') && 
            !url.startsWith('chrome-extension://') &&
            !url.startsWith('data:') &&
            url !== '') {
            targetPage = page;
            break;
        }
    }

    if (!targetPage) {
        LOGGER.warn('No suitable page found for setting data');
        return;
    }

    // Set Cookies
    try {
        if (cookies.length > 0) {
            await targetPage.setCookie(...cookies);
        }
    } catch (error) {
        LOGGER.warn('Failed to set cookies', { error });
    }

    // Set Local Storage
    try {
        await targetPage.evaluate((data: BrowserStorageData) => {
            for (const [key, value] of Object.entries(data)) {
                window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        }, localStorage);
    } catch (error) {
        LOGGER.warn('Failed to set localStorage', { error });
    }

    // Set Session Storage
    try {
        await targetPage.evaluate((data: BrowserStorageData) => {
            for (const [key, value] of Object.entries(data)) {
                window.sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        }, sessionStorage);
    } catch (error) {
        LOGGER.warn('Failed to set sessionStorage', { error });
    }
}

export async function freeBrowser(): Promise<boolean> {
    try {
        // Close Browser
        await closeBrowser()
        return true
    } catch(error:unknown) {
        if(error instanceof Error){
            LOGGER.critical(
                "Error closing browser instance", 
                { 
                    message: error.message,
                    stack: error.stack
                }
            )
        }

        return false
    }
}
