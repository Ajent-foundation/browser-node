import express, { Express } from "express"
import { loadEnv, setDefaults, expressVars, podVars, nodeVars } from "./base/env"
import { getArgs } from "./base/args"
import { NodeMemory, NodeCacheKeys, CACHE } from "./base/cache"
import { LOGGER, FG_COLOR, BG_COLOR, TEXT_STYLE } from "./base/logger"
import { NOT_FOUND, } from "./middlewares/generics"
import { preRequest, postRequest, respond } from "./middlewares/logging"
import * as action from "./actions"
import { execSync } from 'child_process'
import { randomBytes } from 'crypto'
import multer from "multer"
import { runOnBootScript } from "./actions/browser"
import { Server } from 'socket.io'
import http from 'http'
import { EVENT_NAME, TEvent } from "./events"
import { v4 } from "uuid"

// Make IO accessible globally
declare global {
    var io: Server;
}

export const upload = multer({ dest: 'uploads/' });

// Entry Point
(async () => {
    process.env.DISPLAY = ':1'
    LOGGER.custom(
        "Dapi: browser-node-ts", 
        [
            BG_COLOR.Bright.Black, 
            FG_COLOR.Bright.Blue, 
            TEXT_STYLE.Bold
        ]
    )
    LOGGER.custom( "\n" + "\udb81\uddc9".repeat(50))

    // Get Args
    const args = getArgs<{
        debug: boolean,
        staging: boolean,
        noStateManger: boolean,
        local: boolean
    }>()

    // Init Env Vars & set Defaults
    LOGGER.custom("2- Initializing Environment Variables...")
    loadEnv(
        args.debug ? "dev" : args.staging ? "staging" : "prod"
    )
    setDefaults({
        // Core
        SERVICE_NAME: "baas-node-ts",
        DEPLOYMENT: args.debug ? "Dev" : args.staging ? "Staging" : "Prod",

        // Express
        // Listening port for Express
        EXPRESS_PORT: "8080",

        // Browser-State-Manager
        // A service that manages the state of browsers
        // Only used if REPORT_STATE is set to true
        IS_LOCAL: args.local ? "true" : "false",
        REPORT_STATE: args.noStateManger ? "false" : "true",
        STATE_MGR_URL: "http://localhost:8090",
        
        // Config
        DELAY_TIME: "5000",    // General delay time (ms)
        TRY_LIMIT: "10",      // Number of retries
        TRY_DELAY: "500",    // Delay between retries (ms)

        // Node 
        // NODE_IP: "127.0.0.1",

        // NOTE - DON'T CHANGE THESE
        NODE_BROWSER_PORT: "19222",
        NODE_VNC_PORT: "15900",

        // Pod
        // POD_NAMESPACE: "default",
        // POD_NAME: "",
    })

    // Generate SSL certificates & Generate apiKey 
    try {
        if(!args.debug) {
            // TODO - reexamine self-signed certificates
            // 1- websockify : required for upgrading VNC ws to wss
            execSync(
                `openssl req -new -x509 -days 365 -nodes -out /home/user/app/websockify/cert.pem -keyout /home/user/app/websockify/key.pem -subj "/C=US/ST=California/L=San Francisco/O=Dapi Inc/OU=VNC/CN=tasknet.co"`
            )
            // 2- tunneling : required for upgrading remote-debugger ws to wss
            execSync(
                `openssl req -new -x509 -days 365 -nodes -out /home/user/app/cert.pem -keyout /home/user/app/key.pem -subj "/C=US/ST=California/L=San Francisco/O=Dapi Inc/OU=WS/CN=tasknet.co"`
            )
            // 3- proxy : required for mitmproxy
            execSync(
                `openssl genrsa -out /home/mitmproxy/mitmproxy-ca-cert.key 2048 && openssl req -new -x509 -key /home/mitmproxy/mitmproxy-ca-cert.key -out /home/mitmproxy/mitmproxy-ca-cert.crt -subj "/C=US/ST=California/L=San Francisco/O=Dapi Inc/OU=PROXY/CN=tasknet.co" && cat /home/mitmproxy/mitmproxy-ca-cert.key /home/mitmproxy/mitmproxy-ca-cert.crt > /home/mitmproxy/mitmproxy-ca-cert.pem`
            )

            // 4- apiKey
            const apiKey = randomBytes(20).toString('hex')
            process.env.API_KEY = apiKey
            // LOGGER.debug("API Key Generated", { apiKey })
        }
    } catch (error:unknown) {
        if (error instanceof Error) {
            LOGGER.critical(
                "Unhandled Exception with SSL Certificates", 
                {
                    message: error.message,
                    stack: error.stack
                }
            )
        }

        await action.gracefulShutdown("uncaughtException", null, true)
    }
    
    // Run Boot Script
    if(!args.local){
        try {
            await runOnBootScript()
        } catch (error:unknown) {
            if (error instanceof Error) {
                LOGGER.critical(
                    "Unhandled Exception with onBootScript", 
                    {
                        message: error.message,
                        stack: error.stack
                    }
                )
            }

            await action.gracefulShutdown("uncaughtException", null, true)
        }
    }

    // Init MEMORY
    LOGGER.custom("3- Initializing NodeMemory Cache...")
    CACHE.set<NodeMemory>(NodeCacheKeys.MEMORY, {
        isRunning: false,
        browserID: "",
        instance: null,
        startedAt: null,
        leaseTime: null,
        pids: []
    })

    // Init Express
    LOGGER.custom("4- Initializing Express...\n")
    const EXPRESS_APP: Express = express()
    const HTTP_SERVER = http.createServer(EXPRESS_APP)
    const IO = new Server(HTTP_SERVER, {
        transports: ["polling" , "websocket"],
        cors: {
            origin: "*"
        }
    })

    // Make IO globally available
    global.io = IO;

    const id = `browser:${v4()}`
    const initEvents: TEvent[] = [
        {
            name: "node:setState",
            data:  { id, ...{
                ip: podVars.getPodIP(),
                name: podVars.getPodName(),
                browserPort: nodeVars.getNodeBrowserPort(),
                appPort: expressVars.getExpressPort(),
                vncPort: nodeVars.getNodeVNCPort(),
            } }
        },
        {
            name: "node:setLabel",
            data:  { id, ...{
                name: podVars.getPodName(),
                namespace: podVars.getNameSpace(),
                labelName: "status",
                labelValue: "green"
            } }
        }
    ]

    // Socket.IO Connection Handler
    IO.on('connection', (socket) => {
        LOGGER.info('New socket connection', { socketId: socket.id })

        // Emit Init events
        initEvents.forEach((event)=>{
            socket.emit(EVENT_NAME, event);
        })

        socket.on('disconnect', () => {
            LOGGER.info('Socket disconnected', { socketId: socket.id })
        })
    })

    // Express-Plugins 
    // express.json : parses incoming requests with JSON payloads
    EXPRESS_APP.use(express.json())

    // Express-Routes
    // Default Route : for health checks
    EXPRESS_APP.use(
        "/", 
        require("./routes/default"),
        respond
    )
    // Mgr Route : for managing browsers
    EXPRESS_APP.use(
        "/action", 
        preRequest,
        require("./routes/action"),
        postRequest    
    )
    EXPRESS_APP.use(
        "/files", 
        preRequest,
        require("./routes/files"),
        postRequest    
    )
    EXPRESS_APP.use(
        "/system", 
        preRequest,
        require("./routes/system"),
        postRequest    
    )
    EXPRESS_APP.use(
        "/session", 
        preRequest,
        require("./routes/session"),
        postRequest    
    )
    EXPRESS_APP.use(
        "*",
        NOT_FOUND
    )

    // Server setup
    const SERVER = HTTP_SERVER.listen(
        expressVars.getExpressPort(), 
        async() => {
            LOGGER.custom( "\n" + "\udb81\uddc9".repeat(50) + "\n")
            LOGGER.custom(`\tBrowser Node is Running on: ${process.env.EXPRESS_PORT} `, [
                FG_COLOR.Bright.Green, 
                TEXT_STYLE.Bold, 
                TEXT_STYLE.Underline
            ])
            LOGGER.custom("\n" + "\udb81\uddc9".repeat(50) + "\n")
            LOGGER.info(
                "Server is Running",
                {
                    port: expressVars.getExpressPort(),
                    serviceName: process.env.SERVICE_NAME,
                    deployment: process.env.DEPLOYMENT,
                }
            )

            // Init with Browser-State-Manager
            const isSuccess = await action.init(id)
            if(!isSuccess) {
                // Quit if init fails
                // Init reports to state manager
                await action.gracefulShutdown("exit", SERVER, true)
            }

            LOGGER.warn("browser-node-ts should run inside a docker container. Otherwise, configure .puppeteerrc.json")
            if(args.noStateManger){
                LOGGER.warn("browser-state-manager is disabled")
            }
        }
    )

    // ShutdownHandlers
    // ctrl + c triggers  SIGINT & SIGTERM
    // K8s scheduler sends SIGTERM when killing a Pod
    process.on("SIGINT", async () => await action.gracefulShutdown("SIGINT", SERVER, false))
    process.on("SIGTERM", async () => await action.gracefulShutdown("SIGTERM", SERVER, false))
    process.on("uncaughtException", async(error) => {
        LOGGER.critical(
            "Unhandled Exception", 
            {
                message: error.message,
                stack: error.stack
            }
        )

        await action.gracefulShutdown("uncaughtException", SERVER, true, "UNHANDLED_EXCEPTION")
    })
})()