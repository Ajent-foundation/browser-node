import puppeteer, { Browser } from "puppeteer"
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
import { CookieParam } from "puppeteer"
import * as fs from 'fs'

export type BrowserStorageData = Record<string, object>

export type BrowserData = {
    url: string
    title: string
    cookies: CookieParam[]
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
    instance   : Browser
    pids       : number[]
}

let browser: Browser | null = null

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
            ]
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
    enableVNC:boolean,
    secureVNC:boolean,
    isVNCViewOnly:boolean,
    resolution: string,
    depth: number,
    dpi: number,
    proxy ?: {
        url: string
        username: string
        password: string
    }
): Promise<number[]> {
    //WINDOW
    const windowVars : Record<string, string> = {}
    windowVars["XVFB_RESOLUTION"] = resolution
    windowVars["XVFB_DEPTH"] = depth.toString()
    windowVars["XVFB_DPI"] = dpi.toString()
    
    // VNC vars
    const vncVars : Record<string, string> = {}
    if(enableVNC){
        vncVars["VNC_SERVER_ENABLED"] = "TRUE"
        if (secureVNC && process.env.API_KEY) {
            vncVars["VNC_SERVER_PASSWORD"] = process.env.API_KEY
        }
        if(isVNCViewOnly){
            vncVars["VNC_VIEW_ONLY"] = "TRUE"
        }
        if(process.env.VNC_NO_SSL === "true"){
            vncVars["VNC_NO_SSL"] = "true"
        }
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

function runListener() : Promise<number> {
    return new Promise((resolve, reject) => {
        LOGGER.info(
            "[INFO] Setting up port forwarding from 19222 to localhost:9222...",
        )
        
        const httpTunnelPath = process.env.STUNNEL_HTTP === "true" ? true : false
        let pid : number | undefined = undefined
        if (httpTunnelPath){
            LOGGER.info(
                "[INFO] running using socat",
            )

            const socatProcess = spawn('socat', ['TCP4-LISTEN:19222,fork,reuseaddr', 'TCP4:localhost:9222'], {
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
        browser ?: "chrome" | "edge" | "opera" | "brave"
        screen ?:{
            resolution ?: SupportedResolution
            depth ?: 24 | 30 | 32
            dpi ?: 96 | 120 | 144 | 192
        }
    }
    vnc ?: {
        mode ?: "ro" | "rw"
        isPasswordProtected ?: boolean
        isEnabled ?: boolean
    }
    proxy ?: {
        url : string
        username : string
        password : string
        validate ?: boolean
    }
    //userAgent?: string
    //cookies?: { [name: string]: string }
    //extensions?: string[]
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
    config: BrowserConfig
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

    // Window
    const WINDOW_BROWSER = config.window?.browser || "chrome"
    const WINDOW_SCREEN_RESOLUTION = config.window?.screen?.resolution || "1280x1024"
    const WINDOW_SCREEN_DEPTH = config.window?.screen?.depth || 24
    const WINDOW_SCREEN_DPI = config.window?.screen?.dpi || 96

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
                    VNC_IS_ENABLED,
                    VNC_IS_PASSWORD_PROTECTED,
                    VNC_MODE === "ro",
                    WINDOW_SCREEN_RESOLUTION,
                    WINDOW_SCREEN_DEPTH,
                    WINDOW_SCREEN_DPI,
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

        // NOTE - IT crashes if wrong filter is used
        const userAgent = new UserAgent({
            // appName: "Netscape",
            // Linux || Win32 || MacIntel
            platform: "Win32",
            // Google Chrome=>"Google Inc." Safari=>"Apple Computer, Inc." Firefox, EDGE=>"",
            // vendor: "Google Inc.",
            //userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            //screenWidth: Number(WINDOW_SCREEN_RESOLUTION.split("x")[0]),
            //screenHeight: Number(WINDOW_SCREEN_RESOLUTION.split("x")[1]),
            // connection: {
            //     // wifi || ethernet || cellular
            //     type: 'wifi',
            // }
        })
        userAgent.random()
        // Browser Launch Configuration 
        // Extensions [ ]
        // useData
        // stealth
        // iframe.contentWindow
        // navigator.hardwareConcurrency
        // navigator.languages
        // navigator.permissions
        // navigator.vendor
        // navigator.webdriver
        // user-agent-override
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
        // if(WINDOW_BROWSER === "edge"){
        //     appName = "microsoft-edge"
        // } else if(WINDOW_BROWSER === "brave"){
        //     appName = "brave-browser"
        // } else if (WINDOW_BROWSER === "opera"){
        //     appName = "opera"
        // } else {
        //     appName = "google-chrome"
        // }
        const opts = {
            executablePath: IS_LOCAL ? undefined : `/usr/bin/${appName}`,
            //userDataDir: IS_LOCAL ? undefined : '/home/user/temp',
            headless: false,
            env: IS_LOCAL ? undefined : {
                DISPLAY: ":1",
            },
            pipe: false,
            args: [
                "--url about:blank",
                `--user-agent=${userAgent.toString()}`,

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
                "disable-infobars",
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
                //"--disable-blink-features=AutomationControlled",
                "--disable-features=PasswordManager,AutofillAssistant,DoNotTrack,IsolateOrigins,SameSiteByDefaultCookies,LazyFrameLoading",
                //"--disable-site-isolation-trials",
                // "--disable-web-security",
                "--disable-component-update",

                // Add these logging-related flags at the start to suppress warnings
                "--disable-logging",
                "--silent",
                "--log-level=3", // Most aggressive log suppression
                "--v=0",

                // Enable
                "--enable-features=NetworkService,NetworkServiceInProcess",
                
                // DevTools
                "--remote-debugging-port=9222",
                "--remote-debugging-address=0.0.0.0"
            ]
                .concat(IS_LOCAL ? [] : [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--no-zygote",
                    "--user-data-dir=/home/user/temp",
                    //"--remote-debugging-pipe"
                ])
                .concat(config.proxy && proxyEstablished ? [   
                    "--proxy-server=http://localhost:8081",
                    `--ignore-certificate-errors-spki-list=${spkiFingerprint}`,
                    "--ssl-key-log-file=/home/mitmproxy/mitmproxy-ca-cert.pem"
                ] : [])
                .concat(extensionArgs),
                //ignoreDefaultArgs: ['--enable-automation'],
                ignoreDefaultArgs: true
        }

        LOGGER.info(
            "Launching browser",
            {
                IS_LOCAL,
                opts
            }
        )

        try{
            browser = await puppeteer.launch(opts)
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

        // Listen for new targets (pages)
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const page = await target.asPage();
                if (page) {
                    const client = await page.createCDPSession()
                    await client.send('Page.setDownloadBehavior', {
                        behavior: 'allow',
                        downloadPath: "/home/user/downloads"
                    });
                }
            }
        });

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
                let connection = await puppeteer.connect({ 
                    browserWSEndpoint:browser.wsEndpoint() 
                })
                const wsEndpoint = connection.wsEndpoint()

                const pages = await connection.pages()
                if(pages.length!==0){
                    await connection.newPage()
                    await pages[0].close()
                }

                connection.disconnect()

                LOGGER.info(
                    `Connected successfully to browser after ${attempt} attempts`,
                )

                // wsEndpoint will be in format:
                // ws://{host}:{port}/devtools/browser/{browser-uuid}
                const matchRes = wsEndpoint.match(/\/([a-f0-9-]+)$/)
                if(!matchRes) {
                    throw new Error("Failed to extract browser UUID from wsEndpoint")
                }

                browserUUID = matchRes[1]
                connectionVerified = true
                if(!IS_LOCAL) {
                    pids.push(await runListener())
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
            version: await browser.version(),
            userAgent: await browser.userAgent(),
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
        // Get Cookies
        const cookies = await page.cookies()

        // serialize cookies
        const serializedCookies : CookieParam[] = cookies.map(cookie => {
            return {
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                expires: cookie.expires,
                httpOnly: cookie.httpOnly,
                secure: cookie.secure,
                sameSite: cookie.sameSite
            }
        })  

        // Get Local Storage
        const localStorage: BrowserStorageData = await page.evaluate(() => {
            return localStorage
        })

        // Get Session Storage
        const sessionStorage: BrowserStorageData = await page.evaluate(() => {
            return sessionStorage
        })

        data.push({
            url: page.url(),
            title: await page.title(),
            cookies: serializedCookies,
            localStorage,
            sessionStorage
        })
    }

    return data
}

export async function setData(
    cookies: CookieParam[],
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

    // Only apply to the first page
    const page = pages[0]

    // Set Cookies
    await page.setCookie(...cookies)

    // Set Local Storage
    await page.evaluate((localStorage: BrowserStorageData) => {
        localStorage = localStorage
    }, localStorage)

    // Set Session Storage
    await page.evaluate((sessionStorage: BrowserStorageData) => {
        sessionStorage = sessionStorage
    }, sessionStorage)
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
