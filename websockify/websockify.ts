import { WebSocket, WebSocketServer } from 'ws';  
import net from 'net';
import http from 'http';
import https from 'https';
import { parse as parseUrl } from 'url';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { program } from 'commander';

// NOTE - currently it only support 1 connection (No concurrency allowed)

// Configuration interface for the VNC websocket proxy server
interface ServerConfig {
    sourceHost: string;    // Host to listen for incoming connections
    sourcePort: number;    // Port to listen for incoming connections
    targetHost: string;    // VNC server host to connect to
    targetPort: number;    // VNC server port to connect to
    webDir?: string;       // Optional directory for serving web files
    cert?: string;         // Optional SSL certificate path
    key?: string;         // Optional SSL key path
    recordDir?: string;   // Optional directory for recording sessions
}

/**
 * VNCWebsockify class - Main class that handles WebSocket to TCP proxy functionality
 * for VNC connections, including optional web serving and session recording
 */
class VNCWebsockify {
    private webServer: http.Server | https.Server;
    private wsServer: WebSocketServer;
    private config: ServerConfig;

    /**
     * Creates a new VNC websocket proxy instance
     * @param config Server configuration options
     */
    constructor(config: ServerConfig) {
        this.config = config;
        this.webServer = this.createWebServer();
        this.wsServer = new WebSocketServer({ server: this.webServer });
        this.initialize();
    }

    /**
     * Creates either an HTTP or HTTPS server based on SSL certificate availability
     */
    private createWebServer(): http.Server | https.Server {
        if (this.config.cert) {
            const cert = fs.readFileSync(this.config.cert);
            const key = fs.readFileSync(this.config.key || this.config.cert);
            return https.createServer(
                { cert, key },
                this.handleHttpRequest.bind(this)
            );
        }
        return http.createServer(this.handleHttpRequest.bind(this));
    }

    /**
     * Sets up WebSocket server and starts listening for connections
     */
    private initialize(): void {
        this.wsServer.on('connection', this.handleNewClient.bind(this));
        this.webServer.listen(this.config.sourcePort, () => {
            console.log('WebSocket settings: ');
            console.log(`    - proxying from ${this.config.sourceHost}:${this.config.sourcePort} to ${this.config.targetHost}:${this.config.targetPort}`);
            if (this.config.webDir) {
                console.log(`    - Web server active. Serving: ${this.config.webDir}`);
            }
            console.log(`    - Running in ${this.config.cert ? 'encrypted HTTPS (wss://)' : 'unencrypted HTTP (ws://)'} mode`);
        });
    }

    /**
     * Handles new WebSocket client connections
     * Sets up proxy connection to target VNC server and initializes recording if enabled
     */
    private handleNewClient(client: WebSocket, req: http.IncomingMessage): void {
        const clientAddr = (client as any)._socket.remoteAddress;
        const startTime = Date.now();
        const log = (msg: string) => console.log(` ${clientAddr}: ${msg}`);

        log('WebSocket connection');

        let recordStream: fs.WriteStream | null = null;
        if (this.config.recordDir) {
            const filename = path.join(this.config.recordDir, new Date().toISOString().replace(/:/g, '_'));
            recordStream = fs.createWriteStream(filename);
            recordStream.write('var VNC_frame_data = [\n');
        }

        const target = this.createTargetConnection(client, log, recordStream, startTime);
        this.setupClientHandlers(client, target, log, recordStream, startTime);
    }

    /**
     * Creates and sets up the TCP connection to the target VNC server
     * Handles data flow from target to WebSocket client
     */
    private createTargetConnection(
        client: WebSocket,
        log: (msg: string) => void,
        recordStream: fs.WriteStream | null,
        startTime: number
    ): net.Socket {
        const target = net.createConnection(this.config.targetPort, this.config.targetHost, () => {
            log('connected to target');
        });

        target.on('data', (data: Buffer) => {
            if (recordStream) {
            const tdelta = Math.floor(Date.now() - startTime);
            recordStream.write(`'{${tdelta}{${this.decodeBuffer(data)}',\n`);
            }

            try {
            client.send(data);
            } catch (e) {
            log('Client closed, cleaning up target');
            target.end();
            }
        });

        this.setupTargetHandlers(target, client, log, recordStream);
        return target;
    }

    /**
     * Sets up event handlers for the WebSocket client
     * Handles message flow from client to target and cleanup on disconnection
     */
    private setupClientHandlers(
        client: WebSocket,
        target: net.Socket,
        log: (msg: string) => void,
        recordStream: fs.WriteStream | null,
        startTime: number
    ): void {
        client.on('message', (msg: Buffer) => {
            if (recordStream) {
            const rdelta = Math.floor(Date.now() - startTime);
            recordStream.write(`'{${rdelta}{${this.decodeBuffer(msg)}',\n`);
            }
            target.write(msg);
        });

        client.on('close', (code: number, reason: string) => {
            log(`WebSocket client disconnected: ${code} [${reason}]`);
            target.end();
        });

        client.on('error', (error: Error) => {
            log(`WebSocket client error: ${error.message}`);
            target.end();
        });
    }

    /**
     * Sets up event handlers for the target TCP connection
     * Handles disconnection and error scenarios
     */
    private setupTargetHandlers(
        target: net.Socket,
        client: WebSocket,
        log: (msg: string) => void,
        recordStream: fs.WriteStream | null
    ): void {
        target.on('end', () => {
            log('target disconnected');
            client.close();
            if (recordStream) {
            recordStream.end('\'EOF\'];\n');
            }
        });

        target.on('error', () => {
            log('target connection error');
            target.end();
            client.close();
            if (recordStream) {
            recordStream.end('\'EOF\'];\n');
            }
        });
    }

    /**
     * Converts binary buffer to a string representation
     * Used for recording session data
     */
    private decodeBuffer(buf: Buffer): string {
        return buf.reduce((acc: string, byte: number) => {
            if ((byte >= 48 && byte <= 90) || byte === 95 || (byte >= 97 && byte <= 122)) {
            return acc + String.fromCharCode(byte);
            }
            const hex = byte.toString(16);
            return acc + `\\x${hex.padStart(2, '0')}`;
        }, '');
    }

    /**
     * Handles incoming HTTP requests when web serving is enabled
     * Serves static files from the configured web directory
     */
    private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (!this.config.webDir) {
            this.httpError(res, 403, '403 Permission Denied');
            return;
        }

        const uri = parseUrl(req.url || '').pathname || '';
        const filename = path.join(this.config.webDir, uri);

        fs.exists(filename, (exists) => {
        if (!exists) {
            this.httpError(res, 404, '404 Not Found');
            return;
        }

        this.serveFile(filename, res);
        });
    }

    /**
     * Serves a static file with appropriate content type
     */
    private serveFile(filename: string, res: http.ServerResponse): void {
        const stats = fs.statSync(filename);
        const finalPath = stats.isDirectory() ? path.join(filename, 'index.html') : filename;

        fs.readFile(finalPath, 'binary', (err, file) => {
            if (err) {
                this.httpError(res, 500, err.message);
                return;
            }

            const contentType = mime.contentType(path.extname(finalPath));
            const headers: http.OutgoingHttpHeaders = {};
            if (contentType) {
            headers['Content-Type'] = contentType;
            }

            res.writeHead(200, headers);
            res.write(file, 'binary');
            res.end();
        });
    }

    /**
     * Sends HTTP error responses with appropriate status codes
     */
    private httpError(res: http.ServerResponse, code: number, msg: string): void {
        res.writeHead(code, { 'Content-Type': 'text/plain' });
        res.write(msg + '\n');
        res.end();
    }
}

// CLI command configuration and argument parsing
program
    .argument('<source>', 'Source address:port')
    .argument('<target>', 'Target address:port')
    .option('--web <dir>', 'Web directory to serve')
    .option('--cert <file>', 'SSL certificate file')
    .option('--key <file>', 'SSL key file')
    .option('--record <dir>', 'Directory to record sessions')
    .parse();

const options = program.opts();
const [source, target] = program.args;

/**
 * Helper function to parse endpoint strings in format "host:port" or "port"
 * Returns tuple of [host, port]
 */
const parseEndpoint = (endpoint: string): [string, number] => {
    const parts = endpoint.split(':');
    if (parts.length === 1) {
        return ['', parseInt(parts[0], 10)];
    }
    return [parts[0], parseInt(parts[1], 10)];
};

// Main execution block - Parse arguments and start the proxy server
try {
    const [sourceHost, sourcePort] = parseEndpoint(source);
    const [targetHost, targetPort] = parseEndpoint(target);

    if (!targetHost || isNaN(sourcePort) || isNaN(targetPort)) {
        throw new Error('Invalid source or target format');
    }

    new VNCWebsockify({
        sourceHost,
        sourcePort,
        targetHost,
        targetPort,
        webDir: options.web,
        cert: options.cert,
        key: options.key,
        recordDir: options.record
    });
} catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    console.error('Usage: websockify [--web dir] [--cert file] [--key file] [--record dir] source_addr:source_port target_addr:target_port');
    process.exit(1);
}