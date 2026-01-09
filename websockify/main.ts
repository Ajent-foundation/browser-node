import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import { parse as parseUrl } from 'url';
import { program } from 'commander';
import crypto from 'crypto';
import net from 'net';
import pino, { Logger } from 'pino';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

interface ClientInfo {
    id: string;
    apiKey: string;
    socket: WebSocket;
    isReadOnly: boolean;
    hasControl: boolean;
    protocolVersion: string | null;
    securityType: number | null;
    authenticated: boolean;
}

interface VNCStatus {
    isConnected: boolean;
    lastConnectionAttempt: Date | null;
    error: string | null;
}

// VNC Recording Types
interface VNCRecordedEvent {
    timestamp: number;
    type: 'frame' | 'input' | 'meta';
    data: Buffer | VNCInputEvent | VNCMetaEvent;
    // Frame-specific fields for video reconstruction
    width?: number;
    height?: number;
    encoding?: string;
}

interface VNCInputEvent {
    messageType: number;
    x?: number;
    y?: number;
    buttonMask?: number;
    key?: number;
    downFlag?: boolean;
}

interface VNCMetaEvent {
    event: string;
    width?: number;
    height?: number;
    pixelFormat?: any;
}

// VNC Pixel Format type
interface VNCPixelFormat {
    bitsPerPixel: number;
    depth: number;
    bigEndianFlag: number;
    trueColorFlag: number;
    redMax: number;
    greenMax: number;
    blueMax: number;
    redShift: number;
    greenShift: number;
    blueShift: number;
}

/**
 * Simple FBS Recorder - receives VNC data from VNCManager and writes to FBS file
 * No separate connection - just records what the proxy already receives
 */
class FBSRecorder {
    private _logger: Logger;
    private _recordingPath: string;
    private _sessionId: string | null = null;
    private _writer: fs.WriteStream | null = null;
    private _buffer: Buffer = Buffer.alloc(0);
    private _startTime: number = 0;
    private _headerWritten: boolean = false;
    private _maxWriteSize: number = 65535;
    private _frameCount: number = 0;
    private _bytesWritten: number = 0;
    private _isRecording: boolean = false;
    private _width: number = 0;
    private _height: number = 0;
    private _lastError: string | null = null;
    
    constructor(recordingPath: string = '/home/user/recordings') {
        this._recordingPath = recordingPath;
        
        if (!fs.existsSync(recordingPath)) {
            fs.mkdirSync(recordingPath, { recursive: true });
        }
        
        const logPath = path.join(recordingPath, 'vnc-recorder.log');
        const logStream = fs.createWriteStream(logPath, { flags: 'w' });
        this._logger = pino({ name: 'fbs-recorder', level: 'debug' }, logStream);
        this._logger.info({}, 'FBS Recorder initialized');
    }
    
    /**
     * Start recording with known dimensions
     */
    startRecording(sessionId: string, width: number, height: number): boolean {
        if (this._isRecording) {
            this._logger.warn({}, 'Already recording');
            return false;
        }
        
        this._sessionId = sessionId;
        this._width = width;
        this._height = height;
        this._startTime = Date.now();
        this._headerWritten = false;
        this._buffer = Buffer.alloc(0);
        this._frameCount = 0;
        this._bytesWritten = 0;
        this._lastError = null;
        
        const filePath = path.join(this._recordingPath, `${sessionId}.fbs`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        this._writer = fs.createWriteStream(filePath, { flags: 'w' });
        this._isRecording = true;
        
        // Write FBS header immediately
        this._writeHeader();
        
        this._logger.info({ sessionId, width, height }, 'Recording started');
        return true;
    }
    
    /**
     * Write FBS file header
     */
    private _writeHeader(): void {
        if (!this._writer || this._headerWritten) return;
        
        this._headerWritten = true;
        
        // FBS file header
        this._writer.write('FBS 001.000\n');
        
        // First block: RFB init sequence
        // RFB 3.3 version + security type + ServerInit
        const initData: Buffer[] = [];
        
        // Version
        initData.push(Buffer.from('RFB 003.003\n'));
        
        // Security type (None = 1)
        const sec = Buffer.alloc(4);
        sec.writeInt32BE(1, 0);
        initData.push(sec);
        
        // ServerInit: width, height, pixel format, name
        const fb = Buffer.alloc(4);
        fb.writeUInt16BE(this._width, 0);
        fb.writeUInt16BE(this._height, 2);
        initData.push(fb);
        
        // Pixel format (32bpp BGRX)
        const pf = Buffer.alloc(16);
        pf.writeUInt8(32, 0);   // bpp
        pf.writeUInt8(24, 1);   // depth
        pf.writeUInt8(0, 2);    // big-endian
        pf.writeUInt8(1, 3);    // true-color
        pf.writeUInt16BE(255, 4);  // red-max
        pf.writeUInt16BE(255, 6);  // green-max
        pf.writeUInt16BE(255, 8);  // blue-max
        pf.writeUInt8(16, 10);  // red-shift
        pf.writeUInt8(8, 11);   // green-shift
        pf.writeUInt8(0, 12);   // blue-shift
        initData.push(pf);
        
        // Desktop name
        const name = 'VNC Recording';
        const nameLen = Buffer.alloc(4);
        nameLen.writeUInt32BE(name.length, 0);
        initData.push(nameLen);
        initData.push(Buffer.from(name));
        
        // Write as first FBS block with timestamp 0
        const block = Buffer.concat(initData);
        this._writeBlock(block, 0);
        
        this._logger.info({ width: this._width, height: this._height }, 'FBS header written');
    }
    
    /**
     * Record VNC server data (called by VNCManager when it receives data from VNC server)
     */
    recordData(data: Buffer): void {
        if (!this._isRecording || !this._writer) return;
        
        // Buffer data
        this._buffer = Buffer.concat([this._buffer, data]);
        
        // Count framebuffer updates
        if (data.length > 0 && data[0] === 0) {
            this._frameCount++;
        }
        
        // Flush if buffer is large enough
        if (this._buffer.length >= this._maxWriteSize) {
            this._flush();
        }
    }
    
    /**
     * Write block to FBS file: [length(4)][data padded to 4][timestamp(4)]
     */
    private _writeBlock(data: Buffer, timestamp: number): void {
        if (!this._writer) return;
        
        const len = data.length;
        const paddedLen = (len + 3) & ~3;
        const padding = paddedLen - len;
        
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(len, 0);
        this._writer.write(lenBuf);
        
        this._writer.write(data);
        
        if (padding > 0) {
            this._writer.write(Buffer.alloc(padding));
        }
        
        const tsBuf = Buffer.alloc(4);
        tsBuf.writeUInt32BE(timestamp, 0);
        this._writer.write(tsBuf);
        
        this._bytesWritten += 4 + paddedLen + 4;
    }
    
    /**
     * Flush buffer to disk
     */
    private _flush(): void {
        if (this._buffer.length === 0) return;
        
        const timestamp = Date.now() - this._startTime;
        this._writeBlock(this._buffer, timestamp);
        this._buffer = Buffer.alloc(0);
    }
    
    /**
     * Stop recording
     */
    stopRecording(): { sessionId: string; frameCount: number; bytesWritten: number; duration: number; path: string } | null {
        if (!this._isRecording || !this._sessionId) return null;
        
        this._flush();
        
        if (this._writer) {
            this._writer.end();
            this._writer = null;
        }
        
        const duration = Date.now() - this._startTime;
        const filePath = path.join(this._recordingPath, `${this._sessionId}.fbs`);
        
        const result = {
            sessionId: this._sessionId,
            frameCount: this._frameCount,
            bytesWritten: this._bytesWritten,
            duration,
            path: filePath
        };
        
        this._logger.info(result, 'Recording stopped');
        this._isRecording = false;
        return result;
    }
    
    /**
     * Create snapshot of current recording
     */
    createSnapshot(): string | null {
        if (!this._isRecording || !this._sessionId) return null;
        
        this._flush();
        
        const sourcePath = path.join(this._recordingPath, `${this._sessionId}.fbs`);
        const snapshotPath = path.join(this._recordingPath, `${this._sessionId}_snapshot_${Date.now()}.fbs`);
        
        try {
            fs.copyFileSync(sourcePath, snapshotPath);
            this._logger.info({ snapshotPath }, 'Snapshot created');
            return snapshotPath;
        } catch (err) {
            this._logger.error({ error: err }, 'Failed to create snapshot');
            return null;
        }
    }
    
    // Getters
    isRecording(): boolean { return this._isRecording; }
    getSessionId(): string | null { return this._sessionId; }
    
    getRecordingInfo(): {
        sessionId: string | null;
        frameCount: number;
        bytesWritten: number;
        width: number;
        height: number;
        isRecording: boolean;
        duration: number;
        lastError: string | null;
    } {
        return {
            sessionId: this._sessionId,
            frameCount: this._frameCount,
            bytesWritten: this._bytesWritten,
            width: this._width,
            height: this._height,
            isRecording: this._isRecording,
            duration: this._isRecording ? Date.now() - this._startTime : 0,
            lastError: this._lastError
        };
    }
    
    /**
     * List all FBS recordings
     */
    listRecordings(): { sessionId: string; filename: string; size: number; createdAt: Date }[] {
        try {
            return fs.readdirSync(this._recordingPath)
                .filter(f => f.endsWith('.fbs'))
                .map(f => {
                    const filePath = path.join(this._recordingPath, f);
                    const stats = fs.statSync(filePath);
                    return {
                        sessionId: f.replace('.fbs', ''),
                        filename: f,
                        size: stats.size,
                        createdAt: stats.birthtime
                    };
                });
        } catch {
            return [];
        }
    }
}

export class VNCManager {
    private _logger: Logger;

    // VNC Server Connection
    private _host: string;
    private _port: number;
    private _password?: string;
    private _maxConnections: number;

    // Express Server & Socket Server
    private _app: Application;
    private _httpServer: http.Server | https.Server;
    private _wsServer: WebSocketServer;

    // Simple TCP connection to VNC server
    private _vncSocket: net.Socket | null = null;
    private _vncStatus: VNCStatus = {
        isConnected: false,
        lastConnectionAttempt: null,
        error: null
    };
    
    // VNC protocol state
    private _vncConnected: boolean = false;
    private _vncServerInit: Buffer | null = null;
    private _realWidth: number = 0;
    private _realHeight: number = 0;
    private _realPixelFormat: {
        bitsPerPixel: number;
        depth: number;
        bigEndianFlag: number;
        trueColorFlag: number;
        redMax: number;
        greenMax: number;
        blueMax: number;
        redShift: number;
        greenShift: number;
        blueShift: number;
    } | null = null;

    // Store VNC handshake data for new clients
    private _vncHandshakeData: Buffer[] = [];
    private _isHandshakeComplete: boolean = false;

    // Clients, Controller, API KEYS
    private _registeredApiKeys: Set<string> = new Set();
    private _clients: Map<string, ClientInfo> = new Map();
    private _currentController: string | null = null;
    
    // Pre-configured client permissions (for clients not yet connected)
    private _clientPermissions: Map<string, { hasControl: boolean }> = new Map();
    
    // FBS Recorder - records VNC data to file
    private _recorder: FBSRecorder;
     
    // Track if we've sent encodings to VNC server
    private _encodingsSentToVnc: boolean = false;
    
    // Track last encoding log time (to avoid spam)
    private _lastEncodingLog: number = 0;

    constructor(
        vncHost: string, 
        vncPort: number,
        wsPort: number = 15900,
        vncPassword?: string, 
        maxConnections: number = 10,
        preRegisteredApiKey?: string
    ) {
        // Log to file with pino
        const logFile = '/home/user/logs/websockify.log';
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        this._logger = pino(
            { name: 'vnc-manager', level: 'info' },
            //pino.destination({ dest: logFile, sync: false })
        );
        
        // VNC Server
        this._host = vncHost;
        this._port = vncPort;
        this._password = vncPassword;
        this._maxConnections = maxConnections;
        
        // Pre-register API keys
        if (this._password) {
            this._registeredApiKeys.add(this._password);
        }
        
        if (preRegisteredApiKey) {
            this._registeredApiKeys.add(preRegisteredApiKey);
            this._logger.info({
                message: 'Pre-registered API key from CLI',
                apiKey: preRegisteredApiKey
            }, "API_KEY_PRE_REGISTERED");
        }
        
        // Initialize FBS recorder (receives data from this proxy)
        this._recorder = new FBSRecorder();

        // Express Server & Socket Server
        this._app = express();
        this._initExpress();
        this._httpServer = http.createServer(this._app);
        this._wsServer = new WebSocketServer({ server: this._httpServer });

        // Initialize connections
        this._connectToVNC();
        this._initializeWebSocket();
    }

    // Initialize the express server
    private _initExpress(): void {
        // CORS middleware
        this._app.use(cors());
        
        // Plugins
        this._app.use(express.json());

        // Server Status
        this._app.get('/', (req: Request, res: Response): void => {
            res.status(200).json({});
        });

        // Get VNC status
        this._app.get('/status', (req: Request, res: Response): void => {
            res.status(200).json({
                ...this._vncStatus,
                clientCount: this._clients.size,
                currentController: this._currentController,
                maxConnections: this._maxConnections
            });
        });

        // API KEYS
        // Register an API key
        this._app.post('/apiKeys/register', (req: Request, res: Response): void => {
            const { apiKey } = req.body;
            if (!apiKey) {
                res.status(400).json({ code: "API_KEY_REQUIRED", message: "API key is required" });
                return;
            }

            if (this._registeredApiKeys.has(apiKey)) {
                res.status(200).json({});
                return;
            }

            this._registeredApiKeys.add(apiKey);
            res.status(200).json({});
        });

        // Unregister an API key
        this._app.delete('/apiKeys/:apiKey', (req: Request<{ apiKey: string }>, res: Response): void => {
            const { apiKey } = req.params;
            if (this._registeredApiKeys.has(apiKey)) {
                this._registeredApiKeys.delete(apiKey);
                // Disconnect client if connected
                this._clients.forEach((client, clientId) => {
                    if (client.apiKey === apiKey) {
                        client.socket.close();
                        this._clients.delete(clientId);
                    }
                });
                res.status(200).json({});
            } else {
                res.status(404).json({ code: "API_KEY_NOT_FOUND", message: "API key not found" });
            }
        });

        // Get all clients (connected and pre-configured)
        this._app.get('/clients', (req: Request, res: Response): void => {
            const connectedClients = Array.from(this._clients.entries()).map(([clientId, client]) => ({
                clientId: client.id,
                hasControl: client.hasControl,
                isController: clientId === this._currentController,
                isConnected: true
            }));
            
            const preConfiguredClients = Array.from(this._clientPermissions.entries())
                .filter(([clientId]) => !this._clients.has(clientId))
                .map(([clientId, permissions]) => ({
                    clientId,
                    hasControl: permissions.hasControl,
                    isController: false,
                    isConnected: false
                }));
            
            const allClients = [...connectedClients, ...preConfiguredClients];
            res.status(200).json({ clients: allClients });
        });

        // Get pre-configured client permissions
        this._app.get('/clients/permissions', (req: Request, res: Response): void => {
            const permissions = Array.from(this._clientPermissions.entries()).map(([clientId, perms]) => ({
                clientId,
                hasControl: perms.hasControl
            }));
            res.status(200).json({ permissions });
        });

        // Recording API
        // Start VNC recording
        this._app.post('/recording/start', (req: Request, res: Response): void => {
            const { sessionId } = req.body;
            if (!sessionId) {
                res.status(400).json({ code: "SESSION_ID_REQUIRED", message: "Session ID is required" });
                return;
            }
            
            // Check if already recording
            if (this._recorder.isRecording()) {
                res.status(400).json({ code: "ALREADY_RECORDING", message: "Already recording" });
                return;
            }
            
            // Need VNC connection for dimensions
            if (!this._vncConnected || !this._realWidth || !this._realHeight) {
                res.status(400).json({ code: "VNC_NOT_READY", message: "VNC server not connected" });
                return;
            }
            
            // Start recording with current dimensions
            const success = this._recorder.startRecording(sessionId, this._realWidth, this._realHeight);
            if (success) {
                // Request full framebuffer to capture initial state
                this._requestFullFramebuffer();
                res.status(200).json({ 
                    message: "Recording started", 
                    sessionId,
                    width: this._realWidth,
                    height: this._realHeight
                });
            } else {
                res.status(500).json({ 
                    code: "RECORDING_FAILED", 
                    message: "Failed to start recording"
                });
            }
        });
        
        // Stop VNC recording
        this._app.post('/recording/stop', (req: Request, res: Response): void => {
            if (!this._recorder.isRecording()) {
                res.status(400).json({ code: "NOT_RECORDING", message: "No active recording" });
                return;
            }
            
            const result = this._recorder.stopRecording();
            res.status(200).json(result);
        });
        
        // Get recording status
        this._app.get('/recording/status', (req: Request, res: Response): void => {
            const info = this._recorder.getRecordingInfo();
            res.status(200).json({
                isRecording: info.isRecording,
                sessionId: info.sessionId,
                frameCount: info.frameCount,
                bytesWritten: info.bytesWritten,
                width: info.width,
                height: info.height,
                duration: info.duration,
                lastError: info.lastError
            });
        });
        
        // Create snapshot (save current recording without stopping)
        this._app.post('/recording/snapshot', (req: Request, res: Response): void => {
            if (!this._recorder.isRecording()) {
                res.status(400).json({ code: "NOT_RECORDING", message: "No active recording" });
                return;
            }
            
            const snapshotPath = this._recorder.createSnapshot();
            if (snapshotPath) {
                const info = this._recorder.getRecordingInfo();
                res.status(200).json({
                    message: "Snapshot created",
                    snapshotPath,
                    sessionId: info.sessionId,
                    frameCount: info.frameCount
                });
            } else {
                res.status(500).json({ error: "Failed to create snapshot" });
            }
        });
        
        // Get recording info (live status)
        this._app.get('/recording/live', (req: Request, res: Response): void => {
            const info = this._recorder.getRecordingInfo();
            res.status(200).json({
                isRecording: info.isRecording,
                sessionId: info.sessionId,
                frameCount: info.frameCount,
                bytesWritten: info.bytesWritten,
                width: info.width,
                height: info.height,
                duration: info.duration
            });
        });
        
        // List all recordings (FBS files)
        this._app.get('/recording/list', (req: Request, res: Response): void => {
            try {
                const recordings = this._recorder.listRecordings();
                res.status(200).json({ recordings });
            } catch (error) {
                this._logger.error({ error }, 'LIST_RECORDINGS_ERROR');
                res.status(500).json({ error: 'Failed to list recordings' });
            }
        });
        
        // Download recording file
        this._app.get('/recording/download/:sessionId', (req: Request, res: Response): void => {
            const sessionId = req.params.sessionId;
            const filePath = path.join('/home/user/recordings', `${sessionId}.fbs`);
            
            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: 'Recording not found' });
                return;
            }
            
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.fbs"`);
            fs.createReadStream(filePath).pipe(res);
        });
        
        // LEGACY: List all recordings (keeping for compatibility)
        this._app.get('/recording/list-legacy', (req: Request, res: Response): void => {
            try {
                const recordingsPath = '/home/user/recordings';
                if (!fs.existsSync(recordingsPath)) {
                    res.status(200).json({ recordings: [] });
                    return;
                }
                
                const files = fs.readdirSync(recordingsPath)
                    .filter(f => f.endsWith('.fbs') || f.endsWith('.vncrec'))
                    .map(f => {
                        const filePath = path.join(recordingsPath, f);
                        const stats = fs.statSync(filePath);
                        return {
                            sessionId: f.replace('.vncrec', ''),
                            filename: f,
                            size: stats.size,
                            createdAt: stats.birthtime,
                            modifiedAt: stats.mtime
                        };
                    });
                
                res.status(200).json({ recordings: files });
            } catch (error) {
                this._logger.error({ error }, 'LIST_RECORDINGS_ERROR');
                res.status(500).json({ error: 'Failed to list recordings' });
            }
        });
        
        // Get recording frames for a session (for playback)
        this._app.get('/recording/:sessionId/frames', (req: Request, res: Response): void => {
            try {
                const { sessionId } = req.params;
                const limit = parseInt(req.query.limit as string) || 100;
                const offset = parseInt(req.query.offset as string) || 0;
                
                const recordingPath = path.join('/home/user/recordings', `${sessionId}.vncrec`);
                
                if (!fs.existsSync(recordingPath)) {
                    res.status(404).json({ error: 'Recording not found' });
                    return;
                }
                
                const content = fs.readFileSync(recordingPath, 'utf8');
                const lines = content.trim().split('\n').filter(l => l);
                const totalFrames = lines.length;
                
                // Extract pixel format from session_start meta event
                let pixelFormat: VNCPixelFormat | null = null;
                let width = 0;
                let height = 0;
                for (const line of lines) {
                    try {
                        const event = JSON.parse(line);
                        if (event.type === 'meta' && event.data?.event === 'session_start') {
                            if (event.data.pixelFormat) pixelFormat = event.data.pixelFormat;
                            if (event.data.width) width = event.data.width;
                            if (event.data.height) height = event.data.height;
                            break;
                        }
                    } catch {
                        // Skip invalid lines
                    }
                }
                
                // Parse frames with pagination
                const frames = lines
                    .slice(offset, offset + limit)
                    .map((line, idx) => {
                        try {
                            const event = JSON.parse(line);
                            return {
                                index: offset + idx,
                                timestamp: event.timestamp,
                                type: event.type,
                                width: event.width,
                                height: event.height,
                                encoding: event.encoding,
                                // Include base64 data only for frames (already base64 in file)
                                data: event.type === 'frame' ? event.data : undefined
                            };
                        } catch {
                            return null;
                        }
                    })
                    .filter(f => f !== null);
                
                res.status(200).json({
                    sessionId,
                    totalFrames,
                    offset,
                    limit,
                    width,
                    height,
                    pixelFormat,
                    frames
                });
            } catch (error) {
                this._logger.error({ error }, 'GET_FRAMES_ERROR');
                res.status(500).json({ error: 'Failed to get recording frames' });
            }
        });
        
        // Get recording summary
        this._app.get('/recording/:sessionId/summary', (req: Request, res: Response): void => {
            try {
                const { sessionId } = req.params;
                const recordingPath = path.join('/home/user/recordings', `${sessionId}.vncrec`);
                
                if (!fs.existsSync(recordingPath)) {
                    res.status(404).json({ error: 'Recording not found' });
                    return;
                }
                
                const content = fs.readFileSync(recordingPath, 'utf8');
                const lines = content.trim().split('\n').filter(l => l);
                
                let frameCount = 0;
                let inputCount = 0;
                let metaCount = 0;
                let startTime: number | null = null;
                let endTime: number | null = null;
                let width = 0;
                let height = 0;
                let pixelFormat: VNCPixelFormat | null = null;
                
                lines.forEach(line => {
                    try {
                        const event = JSON.parse(line);
                        if (!startTime || event.timestamp < startTime) startTime = event.timestamp;
                        if (!endTime || event.timestamp > endTime) endTime = event.timestamp;
                        
                        if (event.type === 'frame') {
                            frameCount++;
                            if (event.width) width = event.width;
                            if (event.height) height = event.height;
                        } else if (event.type === 'input') {
                            inputCount++;
                        } else if (event.type === 'meta') {
                            metaCount++;
                            // Extract pixel format from session_start meta event
                            if (event.data && event.data.event === 'session_start' && event.data.pixelFormat) {
                                pixelFormat = event.data.pixelFormat;
                            }
                        }
                    } catch {
                        // Skip invalid lines
                    }
                });
                
                res.status(200).json({
                    sessionId,
                    totalEvents: lines.length,
                    frameCount,
                    inputCount,
                    metaCount,
                    startTime,
                    endTime,
                    duration: startTime && endTime ? endTime - startTime : 0,
                    width,
                    height,
                    pixelFormat
                });
            } catch (error) {
                this._logger.error({ error }, 'GET_SUMMARY_ERROR');
                res.status(500).json({ error: 'Failed to get recording summary' });
            }
        });

        // Control Api
        // Assign control to a client (works for connected and disconnected clients)
        this._app.post('/clients/:clientId/control', (req: Request, res: Response): void => {
            const { clientId } = req.params;
            
            // Find connected client by clientId
            const clientEntry = Array.from(this._clients.entries()).find(([_, client]) => client.id === clientId);
            
            if (clientEntry) {
                // Client is connected - assign control immediately
                this.assignControl(clientEntry[0]);
                res.status(200).json({ message: "Control assigned to connected client" });
            } else {
                // Client is not connected - store permission for when they connect
                this._clientPermissions.set(clientId, { hasControl: true });
                res.status(200).json({ message: "Control permission set for disconnected client" });
            }
        });

        // Release control from a client (works for connected and disconnected clients)
        this._app.delete('/clients/:clientId/control', (req: Request, res: Response): void => {
            const { clientId } = req.params;
            
            // Find connected client by clientId
            const clientEntry = Array.from(this._clients.entries()).find(([_, client]) => client.id === clientId);
            
            if (clientEntry) {
                // Client is connected - release control immediately
                this.releaseControl(clientEntry[0]);
                res.status(200).json({ message: "Control released from connected client" });
            } else if (this._clientPermissions.has(clientId)) {
                // Client is not connected but has pre-configured permissions - remove them
                this._clientPermissions.delete(clientId);
                res.status(200).json({ message: "Control permission removed for disconnected client" });
            } else {
                res.status(404).json({ code: "CLIENT_NOT_FOUND", message: "Client not found" });
            }
        });
    }

    // Connect to VNC (SERVER TO VNC-SERVER)
    private _connectToVNC(): void {
        // Connect to VNC server
        this._logger.info({
            host: this._host,
            port: this._port,
            password: this._password
        }, "CONNECTING_TO_VNC");
        
        this._vncSocket = net.createConnection(this._port, this._host);

        let vncHandshakeState = 0;
        this._vncSocket.on('connect', () => {
            this._logger.info({ message: 'Connected to VNC server' }, "VNC_CONNECTED");
            // Update connection status
            this._vncStatus.isConnected = true;
            this._vncStatus.error = null;
        });

        this._vncSocket.on('data', (data: Buffer) => {
            this._logger.info({
                message: 'Received VNC server data',
                handshakeState: vncHandshakeState,
                dataLength: data.length,
                dataHex: data.toString('hex').substring(0, 32)
            }, "VNC_SERVER_DATA");

            if (vncHandshakeState === 0) {
                // Server sends protocol version
                const serverVersion = data.toString().trim();
                this._logger.info({ serverVersion }, "VNC_SERVER_VERSION");
                
                if (serverVersion.startsWith("RFB 003.008") || serverVersion.startsWith("RFB 003.007")) {
                    // Respond with our client version
                    this._vncSocket!.write("RFB 003.008\n");
                    vncHandshakeState = 1;
                } else {
                    this._logger.error({ serverVersion }, "UNSUPPORTED_VNC_VERSION");
                    return;
                }
            } else if (vncHandshakeState === 1) {
                // Server sends security types
                const numSecurityTypes = data[0];
                const securityTypes = [];
                for (let i = 1; i <= numSecurityTypes; i++) {
                    securityTypes.push(data[i]);
                }
                this._logger.info({ securityTypes }, "VNC_SECURITY_TYPES");
                
                // Choose security type (1 = None, 2 = VNC Authentication)
                if (securityTypes.includes(1)) {
                    // Choose "None" security - preferred when available
                    this._vncSocket!.write(Buffer.from([1]));
                    vncHandshakeState = 2;
                    this._logger.info({}, "USING_NO_AUTHENTICATION");
                } else if (securityTypes.includes(2)) {
                    // Choose VNC authentication - only if password provided
                    if (!this._password) {
                        this._logger.error({ securityTypes }, "VNC_AUTH_REQUIRED_BUT_NO_PASSWORD");
                        return;
                    }
                    this._vncSocket!.write(Buffer.from([2]));
                    vncHandshakeState = 3; // Will handle challenge
                    this._logger.info({}, "USING_VNC_AUTHENTICATION");
                } else {
                    this._logger.error({ securityTypes }, "NO_SUPPORTED_SECURITY_TYPE");
                    return;
                }
            } else if (vncHandshakeState === 2) {
                // Security result for "None" auth
                const result = data.readUInt32BE(0);
                if (result === 0) {
                    this._logger.info({}, "VNC_AUTH_SUCCESS");
                    // Send client init (shared = 1)
                    this._vncSocket!.write(Buffer.from([1]));
                    vncHandshakeState = 4;
                } else {
                    this._logger.error({ result }, "VNC_AUTH_FAILED");
                    return;
                }
            } else if (vncHandshakeState === 3) {
                // Handle VNC authentication challenge
                if (data.length !== 16) {
                    this._logger.error({ challengeLength: data.length }, "INVALID_VNC_CHALLENGE_LENGTH");
                    return;
                }
                
                if (!this._password) {
                    this._logger.error({}, "VNC_PASSWORD_REQUIRED_BUT_NOT_PROVIDED");
                    return;
                }

                // Encrypt the challenge with the password using DES
                const response = this._encryptVNCChallenge(data, this._password);
                this._vncSocket!.write(response);
                vncHandshakeState = 2; // Wait for security result
                this._logger.info({}, "VNC_CHALLENGE_RESPONSE_SENT");
                return;
            } else if (vncHandshakeState === 4) {
                // Server initialization
                this._vncServerInit = data;
                
                // Parse the real server initialization
                this._realWidth = data.readUInt16BE(0);
                this._realHeight = data.readUInt16BE(2);
                
                // Extract pixel format (starts at byte 4)
                this._realPixelFormat = {
                    bitsPerPixel: data.readUInt8(4),
                    depth: data.readUInt8(5),
                    bigEndianFlag: data.readUInt8(6),
                    trueColorFlag: data.readUInt8(7),
                    redMax: data.readUInt16BE(8),
                    greenMax: data.readUInt16BE(10),
                    blueMax: data.readUInt16BE(12),
                    redShift: data.readUInt8(14),
                    greenShift: data.readUInt8(15),
                    blueShift: data.readUInt8(16)
                };
                
                // Extract server name
                const nameLength = data.readUInt32BE(20);
                const serverName = data.toString('utf8', 24, 24 + nameLength);
                
                this._vncConnected = true;
                vncHandshakeState = 5;
                this._logger.info({ 
                    message: 'VNC handshake complete - ready to proxy',
                    width: this._realWidth,
                    height: this._realHeight,
                    pixelFormat: this._realPixelFormat,
                    serverName: serverName
                }, "VNC_HANDSHAKE_COMPLETE");
                
                // Send our supported encodings to x11vnc to enable compression
                // Without this, x11vnc defaults to Raw encoding (very slow)
                this._sendEncodingsToVnc();
            } else {
                // Normal VNC protocol data - forward to all clients
                this._broadcastToClients(data);
                
                // Log encoding info for first few framebuffer updates (to verify compression)
                if (data.length > 0 && data[0] === 0) { // FramebufferUpdate message
                    const numRects = data.readUInt16BE(2);
                    if (numRects > 0 && data.length >= 16) {
                        // Parse first rectangle header (starts at byte 4)
                        // Format: x(2), y(2), width(2), height(2), encoding(4)
                        const encoding = data.readInt32BE(12);
                        const encodingName = this._getEncodingName(encoding);
                        
                        // Log periodically (not every frame)
                        if (!this._lastEncodingLog || Date.now() - this._lastEncodingLog > 5000) {
                            this._logger.info({
                                numRects,
                                encoding,
                                encodingName,
                                dataSize: data.length
                            }, "VNC_FRAME_ENCODING");
                            this._lastEncodingLog = Date.now();
                        }
                    }
                }
                
                // Record if active
                if (this._recorder.isRecording()) {
                    this._recorder.recordData(data);
                }
            }
        });

        this._vncSocket.on('error', (error: unknown) => {
            this._vncStatus.isConnected = false;
            this._vncStatus.error = error instanceof Error ? error.message : 'Unknown error';
            this._logger.error({
                message: this._vncStatus.error
            }, "VNC_ERROR");
        });
        
        this._vncSocket.on('close', () => {
            this._vncStatus.isConnected = false;
            this._vncStatus.error = 'Connection closed.';
            this._logger.error({
                message: this._vncStatus.error
            }, "VNC_CONNECTION_CLOSED");
            this._vncSocket = null;
            this._vncConnected = false;
            this._vncServerInit = null;
        });

        this._logger.info({
            message: 'Websocket server initialized'
        }, "WEBSOCKET_SERVER_INITIALIZED");
    }

    // Initialize the websocket server (CLIENT TO SERVER)
    private _initializeWebSocket(): void {
        this._wsServer.on('connection', (ws, req) => {
            this._logger.info({
                url: req.url,
                headers: req.headers
            }, "NEW_WEBSOCKET_CONNECTION");

            // Parse query params
            const url = parseUrl(req.url || '', true);
            let clientId = url.query.clientId;
            let apiKey = url.query.apiKey;

            // if client is is a string item array then convert it to a string
            if (Array.isArray(clientId)) {
                clientId = clientId[0];
            }

            // if api key is is a string item array then convert it to a string
            if (Array.isArray(apiKey)) {
                apiKey = apiKey[0];
            }

            // client must be a string if provided
            if (clientId && typeof clientId !== 'string') {
                ws.close(1007, `Invalid clientId: ${clientId} because it is of type ${typeof clientId} and not a string`);
                return;
            }

            // Anonymous client
            if (!clientId) {
                ws.close(1008, 'Client ID is required');
                return;
            }
            
            if (!apiKey || !this._registeredApiKeys.has(apiKey)) {
                ws.close(1008, 'Invalid or unregistered API key');
                return;
            }

            if (this._clients.size >= this._maxConnections) {
                ws.close(1013, `Maximum connections reached: ${this._clients.size} >= ${this._maxConnections}`);
                return;
            }

            // Check if this client has pre-configured permissions
            const preConfiguredPermissions = this._clientPermissions.get(clientId);
            const hasControl = preConfiguredPermissions?.hasControl || false;
            
            const clientInfo: ClientInfo = {
                id: clientId,
                apiKey: apiKey,
                socket: ws,
                isReadOnly: !hasControl,
                hasControl: hasControl,
                protocolVersion: null,
                securityType: null,
                authenticated: false
            };
            this._clients.set(clientId, clientInfo);
            
            // If this client has control permission, make them the controller
            if (hasControl) {
                // Release control from current controller first
                if (this._currentController && this._currentController !== clientId) {
                    this.releaseControl(this._currentController);
                }
                this._currentController = clientId;
                
                // Remove from pre-configured permissions since they're now connected
                this._clientPermissions.delete(clientId);
            }
            this._logger.info({
                clientId: clientId,
                apiKey: apiKey,
                isReadOnly: clientInfo.isReadOnly,
                hasControl: clientInfo.hasControl,
                protocolVersion: clientInfo.protocolVersion,
                securityType: clientInfo.securityType,
                authenticated: clientInfo.authenticated
            }, "CLIENT_CONNECTED");

            // Send protocol version immediately
            this._logger.info({
                message: 'Sending protocol version to client',
                protocolVersion: 'RFB 003.008'
            }, "SENDING_PROTOCOL_VERSION");
            ws.send(Buffer.from('RFB 003.008\n'));

            // Add a timeout to detect if client doesn't respond
            const handshakeTimeout = setTimeout(() => {
                if (!clientInfo.authenticated) {
                    this._logger.error({
                        message: 'Client handshake timeout - no response from client',
                        clientId: clientId,
                        handshakeState: handshakeState
                    }, "CLIENT_HANDSHAKE_TIMEOUT");
                }
            }, 10000); // 10 second timeout

            // Debug: Log raw WebSocket events
            ws.on('message', (data, isBinary) => {
                let buffer: Buffer;
                if (Buffer.isBuffer(data)) {
                    buffer = data;
                } else if (data instanceof ArrayBuffer) {
                    buffer = Buffer.from(data);
                } else if (Array.isArray(data)) {
                    buffer = Buffer.concat(data);
                } else {
                    buffer = Buffer.from(data as any);
                }
                
                // Only log non-framebuffer update requests to reduce spam
                if (buffer[0] !== 3) {
                    this._logger.info({
                        message: 'Raw WebSocket message received',
                        clientId: clientId,
                        dataLength: buffer.length,
                        isBinary: isBinary,
                        dataType: typeof data,
                        dataHex: buffer.toString('hex').substring(0, 32)
                    }, "RAW_WEBSOCKET_MESSAGE");
                }
            });

            let handshakeState = 0;
            ws.on('message', (msg: Buffer) => {
                // Only log non-framebuffer update requests to reduce spam
                if (msg[0] !== 3 || !clientInfo.authenticated) {
                    this._logger.info({
                        message: 'Received client message',
                        clientId: clientId,
                        handshakeState: handshakeState,
                        authenticated: clientInfo.authenticated,
                        messageLength: msg.length,
                        messageHex: msg.toString('hex').substring(0, 32)
                    }, "CLIENT_MESSAGE");
                }

                if (!clientInfo.authenticated) {
                    // Version Agreement
                    if (handshakeState === 0 && msg.length >= 12) {
                        const versionRequested = msg.toString();
                        this._logger.info({
                            message: 'Client version received',
                            versionRequested: versionRequested.trim()
                        }, "CLIENT_VERSION");
                        
                        if(versionRequested !== "RFB 003.008\n" && versionRequested !== "RFB 003.007\n"){
                            ws.close(1002, 'Unsupported protocol version');
                            return;
                        }
                        
                        // Only supports no VNC Authentication
                        const securityRules = Buffer.from([1, 1]);
                        this._logger.info({
                            message: 'Sending security types',
                            securityRules: securityRules
                        }, "SENDING_SECURITY_TYPES");
                        ws.send(securityRules);
                        handshakeState = 1;
                        return;
                    }

                    // Security Type Agreement
                    if (handshakeState === 1 && msg.length === 1) {
                        const securityType = msg[0];
                        this._logger.info({
                            message: 'Client security type received',
                            securityType: securityType
                        }, "CLIENT_SECURITY_TYPE");
                        
                        if(securityType !== 1) {
                            ws.close(1002, 'Unsupported security type');
                            return;
                        }

                        // Send security result (success)
                        const securityResult = Buffer.from([0, 0, 0, 0]);
                        this._logger.info({
                            message: 'Sending security result',
                            securityResult: securityResult
                        }, "SENDING_SECURITY_RESULT");
                        ws.send(securityResult);
                        handshakeState = 2;
                        return;
                    }

                    // Initialization
                    if (handshakeState === 2 && msg.length >= 1) {
                        const sharedFlag = msg[0];
                        this._logger.info({
                            message: 'Client shared flag',
                            sharedFlag: sharedFlag
                        }, "CLIENT_SHARED_FLAG");

                        // Only send server init if we have real VNC server data
                        if (!this._vncConnected || !this._realPixelFormat) {
                            this._logger.error({}, "VNC_SERVER_NOT_READY");
                            ws.close();
                            return;
                        }
                        
                        // Extract server name from real server init
                        const realNameLength = this._vncServerInit!.readUInt32BE(20);
                        const realServerName = this._vncServerInit!.toString('utf8', 24, 24 + realNameLength);
                        
                        // Send server init with actual data from VNC server
                        const serverInit = Buffer.alloc(24 + realServerName.length);
                        
                        // Use REAL dimensions from VNC server
                        serverInit.writeUInt16BE(this._realWidth, 0);
                        serverInit.writeUInt16BE(this._realHeight, 2);
                        
                        // Use REAL pixel format from VNC server
                        serverInit.writeUInt8(this._realPixelFormat.bitsPerPixel, 4);
                        serverInit.writeUInt8(this._realPixelFormat.depth, 5);
                        serverInit.writeUInt8(this._realPixelFormat.bigEndianFlag, 6);
                        serverInit.writeUInt8(this._realPixelFormat.trueColorFlag, 7);
                        serverInit.writeUInt16BE(this._realPixelFormat.redMax, 8);
                        serverInit.writeUInt16BE(this._realPixelFormat.greenMax, 10);
                        serverInit.writeUInt16BE(this._realPixelFormat.blueMax, 12);
                        serverInit.writeUInt8(this._realPixelFormat.redShift, 14);
                        serverInit.writeUInt8(this._realPixelFormat.greenShift, 15);
                        serverInit.writeUInt8(this._realPixelFormat.blueShift, 16);
                        // padding
                        serverInit.writeUInt8(0, 17);
                        serverInit.writeUInt8(0, 18);
                        serverInit.writeUInt8(0, 19);
                        // name-length
                        serverInit.writeUInt32BE(realServerName.length, 20);
                        // name
                        serverInit.write(realServerName, 24);
                        
                        ws.send(serverInit);
                        clientInfo.authenticated = true;
                        handshakeState = 3;
                        clearTimeout(handshakeTimeout);
                        this._logger.info({
                            message: 'Client authenticated successfully',
                            clientId: clientId,
                            width: this._realWidth,
                            height: this._realHeight,
                            serverName: realServerName
                        }, "CLIENT_AUTHENTICATED");
                    }
                    return;
                }

                // Handle VNC protocol messages
                const messageType = msg[0];

                // Handle SetPixelFormat (type 0) - Forward to VNC server
                if (messageType === 0) {
                    // Forward pixel format to VNC server so it knows client's preference
                    if (this._vncSocket && this._vncConnected) {
                        this._vncSocket.write(msg);
                        this._logger.debug({ 
                            clientId,
                            msgLength: msg.length 
                        }, "SET_PIXEL_FORMAT_FORWARDED");
                    }
                    return;
                }

                // Handle SetEncodings (type 2) - Forward to VNC server
                // This is critical for performance! Without this, x11vnc uses Raw encoding
                if (messageType === 2) {
                    // Parse the encodings for logging
                    const numEncodings = msg.readUInt16BE(2);
                    const encodings: number[] = [];
                    for (let i = 0; i < numEncodings; i++) {
                        encodings.push(msg.readInt32BE(4 + (i * 4)));
                    }
                    
                    // Forward to VNC server so it uses efficient encodings (Tight, ZRLE, etc.)
                    if (this._vncSocket && this._vncConnected) {
                        this._vncSocket.write(msg);
                        this._logger.info({ 
                            clientId,
                            numEncodings,
                            encodings: encodings.slice(0, 10) // Log first 10 for debugging
                        }, "SET_ENCODINGS_FORWARDED");
                    }
                    return;
                }

                // Handle FramebufferUpdateRequest (type 3)
                if (messageType === 3) {
                    // Forward the framebuffer update request to VNC server
                    if (this._vncSocket) {
                        this._vncSocket.write(msg);
                    }
                    return;
                }

                // Handle other VNC messages (pointer events, key events, etc.)
                // These should be handled by our internal VNC client
                if (messageType === 5) { // PointerEvent
                    // Only process pointer events if this client is the current controller
                    if (!clientInfo.hasControl) {
                        return;
                    }
                    
                    // Forward the entire message to VNC server
                    if (this._vncSocket) {
                        this._vncSocket.write(msg);
                    }
                } else if (messageType === 4) { // KeyEvent
                    // Only process key events if this client is the current controller
                    if (!clientInfo.hasControl) {
                        return;
                    }
                    
                    // Forward the entire message to VNC server
                    if (this._vncSocket) {
                        this._vncSocket.write(msg);
                    }
                } else if (messageType === 6) { // ClientCutText
                    // Only process clipboard updates if this client is the current controller
                    if (!clientInfo.hasControl) {
                        return;
                    }
                    // Forward the entire message to VNC server
                    if (this._vncSocket) {
                        this._vncSocket.write(msg);
                    }
                } else {
                    // Forward any other VNC protocol messages to VNC server
                    if (this._vncSocket && clientInfo.hasControl) {
                        this._vncSocket.write(msg);
                    }
                }
            });

            ws.on('close', () => {
                this._logger.info({
                    message: 'Client disconnected',
                    clientId: clientId
                }, "CLIENT_DISCONNECTED");
                this.removeClient(clientId);
            });

            ws.on('error', (error) => {
                this._logger.error({
                    message: 'WebSocket error',
                    error: error
                }, "WEBSOCKET_ERROR");
                this.removeClient(clientId);
            });
        });
    }  

    // Assign control to a client (able to send pointer and key events)
    private assignControl(clientId: string): void {
        const client = this._clients.get(clientId);
        if (!client) return;

        // Release control from current controller
        if (this._currentController) {
            this.releaseControl(this._currentController);
        }

        // Assign control to new client
        client.hasControl = true;
        this._currentController = clientId;
    }

    // Release control from a client
    private releaseControl(clientId: string): void {
        const client = this._clients.get(clientId);
        if (!client || !client.hasControl) return;

        client.hasControl = false;
        this._currentController = null;
    }

    // Remove a client from the list
    private removeClient(clientId: string): void {
        const client = this._clients.get(clientId);
        if (!client) return;

        // If this client was the controller, release control
        if (client.hasControl) {
            this.releaseControl(clientId);
        }

        this._clients.delete(clientId);
    }

    /**
     * Encrypt VNC authentication challenge using DES
     */
    private _encryptVNCChallenge(challenge: Buffer, password: string): Buffer {
        // VNC password is limited to 8 characters and padded with nulls
        const key = Buffer.alloc(8);
        const passwordBuffer = Buffer.from(password.substring(0, 8), 'utf8');
        passwordBuffer.copy(key);
        
        // VNC uses DES with bits reversed in each byte of the key
        const reversedKey = Buffer.alloc(8);
        for (let i = 0; i < 8; i++) {
            let byte = key[i];
            let reversed = 0;
            for (let bit = 0; bit < 8; bit++) {
                reversed = (reversed << 1) | (byte & 1);
                byte >>= 1;
            }
            reversedKey[i] = reversed;
        }
        
        // Create DES cipher and encrypt the challenge
        const cipher = crypto.createCipheriv('des-ecb', reversedKey, null);
        cipher.setAutoPadding(false);
        
        const encrypted = Buffer.concat([
            cipher.update(challenge),
            cipher.final()
        ]);
        
        return encrypted;
    }

    /**
     * Request a full (non-incremental) framebuffer update from the VNC server
     * This is used when starting recording to capture the initial screen state
     */
    private _requestFullFramebuffer(): void {
        if (!this._vncSocket || !this._vncConnected) {
            this._logger.warn({}, 'Cannot request framebuffer - VNC not connected');
            return;
        }
        
        // FramebufferUpdateRequest message format:
        // Byte 0: message-type (3)
        // Byte 1: incremental (0 for full frame, 1 for incremental)
        // Bytes 2-3: x-position (0)
        // Bytes 4-5: y-position (0)
        // Bytes 6-7: width
        // Bytes 8-9: height
        const request = Buffer.alloc(10);
        request.writeUInt8(3, 0);  // message-type = FramebufferUpdateRequest
        request.writeUInt8(0, 1);  // incremental = 0 (full update)
        request.writeUInt16BE(0, 2);  // x-position = 0
        request.writeUInt16BE(0, 4);  // y-position = 0
        request.writeUInt16BE(this._realWidth, 6);  // width
        request.writeUInt16BE(this._realHeight, 8);  // height
        
        this._vncSocket.write(request);
        this._logger.info({ 
            width: this._realWidth, 
            height: this._realHeight 
        }, 'FULL_FRAMEBUFFER_REQUESTED');
    }

    /**
     * Send SetEncodings message to VNC server to enable efficient compression
     * This tells x11vnc what encodings we support (Tight, ZRLE, Hextile, etc.)
     * Without this, x11vnc defaults to Raw encoding which is very slow
     */
    private _sendEncodingsToVnc(): void {
        if (!this._vncSocket || !this._vncConnected) {
            this._logger.warn({}, 'Cannot send encodings - VNC not connected');
            return;
        }
        
        if (this._encodingsSentToVnc) {
            return; // Already sent
        }
        
        // VNC encoding types (in order of preference)
        const encodings = [
            16,     // ZRLE - efficient compression
            7,      // Tight - good compression with quality levels
            6,      // zlib - compressed
            5,      // Hextile - reasonable compression
            2,      // RRE - run-length encoding
            1,      // CopyRect - efficient for scrolling
            0,      // Raw - fallback (no compression)
            // Pseudo-encodings
            -223,   // DesktopSize
            -224,   // LastRect
            -239,   // Cursor
            -32,    // Compression level (0 = -256, 9 = -247) - we use level 6
            -250,   // Compression level 6
            -23,    // Quality level (0 = -32, 9 = -23) - we use level 9 (best)
        ];
        
        // SetEncodings message format:
        // Byte 0: message-type (2)
        // Byte 1: padding
        // Bytes 2-3: number-of-encodings
        // Then 4 bytes per encoding (signed 32-bit big-endian)
        const msgLength = 4 + (encodings.length * 4);
        const msg = Buffer.alloc(msgLength);
        
        msg.writeUInt8(2, 0);  // message-type = SetEncodings
        msg.writeUInt8(0, 1);  // padding
        msg.writeUInt16BE(encodings.length, 2);  // number-of-encodings
        
        // Write each encoding
        for (let i = 0; i < encodings.length; i++) {
            msg.writeInt32BE(encodings[i], 4 + (i * 4));
        }
        
        this._vncSocket.write(msg);
        this._encodingsSentToVnc = true;
        
        this._logger.info({ 
            encodings,
            encodingCount: encodings.length
        }, 'ENCODINGS_SENT_TO_VNC');
    }

    /**
     * Get human-readable name for VNC encoding type
     */
    private _getEncodingName(encoding: number): string {
        switch (encoding) {
            case 0: return 'Raw';
            case 1: return 'CopyRect';
            case 2: return 'RRE';
            case 4: return 'CoRRE';
            case 5: return 'Hextile';
            case 6: return 'zlib';
            case 7: return 'Tight';
            case 8: return 'zlibhex';
            case 16: return 'ZRLE';
            case 17: return 'ZYWRLE';
            case -223: return 'DesktopSize';
            case -224: return 'LastRect';
            case -239: return 'Cursor';
            case -240: return 'XCursor';
            default: return `Unknown(${encoding})`;
        }
    }

    /**
     * Broadcast VNC data to all connected WebSocket clients
     */
    private _broadcastToClients(data: Buffer): void {
        this._clients.forEach(client => {
            if (client.authenticated && client.socket.readyState === WebSocket.OPEN) {
                try {
                    client.socket.send(data);
                } catch (error) {
                    this._logger.error({ 
                        clientId: client.id, 
                        error 
                    }, "BROADCAST_ERROR");
                }
            }
        });
    }

    // Start the server
    public start(port: number): void {
        this._httpServer.listen(port, () => {
            this._logger.info({
                port: port,
                targetPort: this._port,
                targetHost: this._host,
                maxConnections: this._maxConnections
            }, 'MAIN_STARTED');
        });
    }
}

// CLI command configuration and argument parsing
interface IAppOptions {
    port: string;
    targetPort: string;
    targetHost: string;
    password?: string;
    maxConnections: string;
    apiKey?: string;
}
program
    .option('--port <number>', 'Port to listen on', '15900')
    .requiredOption('--target-port <port>', 'VNC server port')
    .requiredOption('--target-host <host>', 'VNC server host')
    .option('--password <password>', 'VNC server password')
    .option('--max-connections <number>', 'Maximum number of concurrent connections', '10')
    .option('--api-key <key>', 'Pre-register an API key for client connections')
    .parse();

const options = program.opts<IAppOptions>();
const vncManager = new VNCManager(
    options.targetHost,
    parseInt(options.targetPort, 10),
    parseInt(options.port, 10),
    options.password,
    parseInt(options.maxConnections, 10),
    options.apiKey
);
vncManager.start(parseInt(options.port, 10));