import net from 'net';
import BetterSqlite3 from 'better-sqlite3';
import { program } from 'commander';
import pino, { Logger } from 'pino';

// ==================== Database ====================

function initDatabase(dbPath: string): BetterSqlite3.Database {
    const db = new BetterSqlite3(dbPath);
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS cdp_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            method TEXT NOT NULL,
            params TEXT,
            direction TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cdp_events_session ON cdp_events(sessionId);
        CREATE INDEX IF NOT EXISTS idx_cdp_events_timestamp ON cdp_events(timestamp);
    `);
    
    return db;
}

function insertCDPEvent(
    db: BetterSqlite3.Database,
    sessionId: string,
    method: string,
    params: string,
    direction: 'sent' | 'received'
): void {
    const stmt = db.prepare(`
        INSERT INTO cdp_events (sessionId, timestamp, method, params, direction)
        VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(sessionId, Date.now(), method, params, direction);
}

// ==================== CDP Proxy Interceptor ====================
// Sits between external clients and browser, records all CDP traffic

class CDPProxyInterceptor {
    private logger: Logger;
    private db: BetterSqlite3.Database;
    private sessionId: string;
    private listenPort: number;
    private targetPort: number;
    private server: net.Server | null = null;
    
    // Buffer for incomplete messages
    private clientBuffers: Map<net.Socket, string> = new Map();
    private browserBuffers: Map<net.Socket, string> = new Map();
    
    // Methods to filter out (too noisy)
    private noisyMethods: Set<string> = new Set([
        'Network.dataReceived',
        'Network.loadingFinished',
        'Page.lifecycleEvent',
        'Target.targetInfoChanged',
        'Debugger.scriptParsed',
        'Runtime.executionContextCreated',
        'Runtime.executionContextDestroyed'
    ]);
    
    constructor(listenPort: number, targetPort: number, dbPath: string, sessionId: string) {
        this.logger = pino({ name: 'cdp-proxy', level: 'info' });
        this.listenPort = listenPort;
        this.targetPort = targetPort;
        this.sessionId = sessionId;
        this.db = initDatabase(dbPath);
        
        this.logger.info({ listenPort, targetPort, dbPath, sessionId }, 'CDP_PROXY_INIT');
    }
    
    public start(): void {
        this.server = net.createServer((clientSocket) => {
            this.handleConnection(clientSocket);
        });
        
        this.server.listen(this.listenPort, () => {
            this.logger.info({ port: this.listenPort }, 'CDP_PROXY_LISTENING');
        });
        
        this.server.on('error', (error) => {
            this.logger.error({ error: error.message }, 'CDP_PROXY_SERVER_ERROR');
        });
    }
    
    public stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.db.close();
        this.logger.info('CDP_PROXY_STOPPED');
    }
    
    private handleConnection(clientSocket: net.Socket): void {
        const clientId = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        this.logger.info({ clientId }, 'CDP_CLIENT_CONNECTED');
        
        // Initialize buffers
        this.clientBuffers.set(clientSocket, '');
        
        // Connect to browser
        const browserSocket = net.createConnection(this.targetPort, 'localhost');
        this.browserBuffers.set(browserSocket, '');
        
        browserSocket.on('connect', () => {
            this.logger.info({ clientId }, 'CDP_BROWSER_CONNECTED');
        });
        
        // Client -> Browser (commands)
        clientSocket.on('data', (data: Buffer) => {
            // Forward to browser
            browserSocket.write(data);
            
            // Record the data
            this.processData(data, 'sent', clientSocket, this.clientBuffers);
        });
        
        // Browser -> Client (responses/events)
        browserSocket.on('data', (data: Buffer) => {
            // Forward to client
            clientSocket.write(data);
            
            // Record the data
            this.processData(data, 'received', browserSocket, this.browserBuffers);
        });
        
        // Handle disconnections
        clientSocket.on('close', () => {
            this.logger.info({ clientId }, 'CDP_CLIENT_DISCONNECTED');
            browserSocket.destroy();
            this.clientBuffers.delete(clientSocket);
        });
        
        browserSocket.on('close', () => {
            this.logger.info({ clientId }, 'CDP_BROWSER_DISCONNECTED');
            clientSocket.destroy();
            this.browserBuffers.delete(browserSocket);
        });
        
        // Handle errors
        clientSocket.on('error', (error) => {
            this.logger.error({ clientId, error: error.message }, 'CDP_CLIENT_ERROR');
            browserSocket.destroy();
        });
        
        browserSocket.on('error', (error) => {
            this.logger.error({ clientId, error: error.message }, 'CDP_BROWSER_ERROR');
            clientSocket.destroy();
        });
    }
    
    private processData(
        data: Buffer, 
        direction: 'sent' | 'received',
        socket: net.Socket,
        bufferMap: Map<net.Socket, string>
    ): void {
        // Get existing buffer and append new data
        let buffer = bufferMap.get(socket) || '';
        buffer += data.toString();
        
        // Try to parse complete JSON messages
        // CDP messages are newline-delimited JSON
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';
        bufferMap.set(socket, buffer);
        
        // Process complete lines
        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const message = JSON.parse(line) as { method?: string; id?: number; params?: unknown; result?: unknown; error?: unknown };
                this.recordMessage(message, direction);
            } catch {
                // Not valid JSON, might be WebSocket frame or other protocol data
                // Try to extract JSON from the line
                this.tryExtractJson(line, direction);
            }
        }
    }
    
    private tryExtractJson(data: string, direction: 'sent' | 'received'): void {
        // Look for JSON objects in the data (WebSocket frames contain JSON)
        const jsonMatches = data.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
        if (jsonMatches) {
            for (const match of jsonMatches) {
                try {
                    const message = JSON.parse(match) as { method?: string; id?: number; params?: unknown; result?: unknown; error?: unknown };
                    this.recordMessage(message, direction);
                } catch {
                    // Invalid JSON
                }
            }
        }
    }
    
    private recordMessage(
        message: { method?: string; id?: number; params?: unknown; result?: unknown; error?: unknown },
        direction: 'sent' | 'received'
    ): void {
        let method: string;
        let params: unknown;
        
        if (message.method) {
            // CDP methods: uppercase domain + dot (Page.navigate, Network.enable, etc)
            if (!/^[A-Z][a-zA-Z]*\./.test(message.method)) {
                return;
            }
            method = message.method;
            params = message.params || {};
        } else {
            // Skip responses - only record actual CDP events
            return;
        }
        
        // Filter noisy methods
        if (this.noisyMethods.has(method)) {
            return;
        }
        
        try {
            insertCDPEvent(
                this.db,
                this.sessionId,
                method,
                JSON.stringify(params),
                direction
            );
        } catch {
            // Silently ignore db errors
        }
    }
}

// ==================== CLI ====================

interface AppOptions {
    listen: string;
    target: string;
    db: string;
    session: string;
}

program
    .requiredOption('--listen <port>', 'Port to listen on (clients connect here)')
    .requiredOption('--target <port>', 'Browser debug port to forward to')
    .requiredOption('--db <path>', 'SQLite database path')
    .requiredOption('--session <id>', 'Session ID for recording')
    .parse();

const options = program.opts<AppOptions>();

const proxy = new CDPProxyInterceptor(
    parseInt(options.listen, 10),
    parseInt(options.target, 10),
    options.db,
    options.session
);

// Handle shutdown signals
process.on('SIGINT', () => {
    proxy.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    proxy.stop();
    process.exit(0);
});

// Start proxy
proxy.start();
