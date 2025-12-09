import BetterSqlite3 from 'better-sqlite3';
import { LOGGER } from '../base/logger';
import {
    initDataCollectionTables,
    insertSystemAction,
    createSession,
    endSession,
    exportSessionData,
    deleteSessionData,
    ActionType,
    SessionData
} from '../db/modules/dataCollection';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// ==================== Types ====================

export interface KeyboardActionData {
    key?: string;
    text?: string;
    modifiers?: string[];
    type?: 'keydown' | 'keyup' | 'type';
}

export interface MouseActionData {
    x?: number;
    y?: number;
    click?: 'left' | 'right' | 'middle';
    doubleClick?: boolean;
    move?: boolean;
    action?: 'mousedown' | 'mouseup';
    button?: 'left' | 'right' | 'middle';
}

export interface ScrollActionData {
    scrollBy: number;
    direction?: 'up' | 'down';
}

export interface DragActionData {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    button?: 'left' | 'right' | 'middle';
    duration?: number;
}

// ==================== Data Collector Class ====================
// Handles system actions only (keyboard, mouse, scroll, drag)
// CDP and Network interception are handled separately

export class DataCollector {
    private static instance: DataCollector | null = null;
    
    private db: BetterSqlite3.Database | null = null;
    private dbPath: string = '/home/user/data_collection.sqlite3';
    private sessionId: string | null = null;
    private isRecording: boolean = false;
    private cdpInterceptorProcess: ChildProcess | null = null;
    
    private constructor() {}
    
    public static getInstance(): DataCollector {
        if (!DataCollector.instance) {
            DataCollector.instance = new DataCollector();
        }
        return DataCollector.instance;
    }
    
    // ==================== Initialization ====================
    
    public initialize(dbPath: string = '/home/user/data_collection.sqlite3'): void {
        if (this.db) {
            return;
        }
        
        this.dbPath = dbPath;
        
        try {
            this.db = new BetterSqlite3(dbPath);
            initDataCollectionTables(this.db);
            LOGGER.info('Data collection database initialized', { dbPath });
        } catch (error) {
            LOGGER.error('Failed to initialize data collection database', { error });
            throw error;
        }
    }
    
    public startRecording(sessionId: string): void {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        
        this.sessionId = sessionId;
        this.isRecording = true;
        createSession(this.db, sessionId);
        
        LOGGER.info('Started recording session', { sessionId });
    }
    
    public stopRecording(): SessionData | null {
        if (!this.db || !this.sessionId) {
            return null;
        }
        
        this.isRecording = false;
        endSession(this.db, this.sessionId);
        
        // Stop CDP interceptor subprocess
        this.stopCDPInterceptor();
        
        const data = exportSessionData(this.db, this.sessionId);
        LOGGER.info('Stopped recording session', { 
            sessionId: this.sessionId,
            summary: data.summary 
        });
        
        this.sessionId = null;
        
        return data;
    }
    
    public isActive(): boolean {
        return this.isRecording && this.sessionId !== null;
    }
    
    public getSessionId(): string | null {
        return this.sessionId;
    }
    
    public getDbPath(): string {
        return this.dbPath;
    }
    
    // ==================== System Actions Recording ====================
    
    public recordKeyboard(data: KeyboardActionData): void {
        if (!this.shouldRecord()) return;
        this.recordAction('keyboard', data);
    }
    
    public recordMouse(data: MouseActionData): void {
        if (!this.shouldRecord()) return;
        this.recordAction('mouse', data);
    }
    
    public recordScroll(data: ScrollActionData): void {
        if (!this.shouldRecord()) return;
        this.recordAction('scroll', data);
    }
    
    public recordDrag(data: DragActionData): void {
        if (!this.shouldRecord()) return;
        this.recordAction('drag', data);
    }
    
    private recordAction(actionType: ActionType, data: unknown): void {
        if (!this.db || !this.sessionId) return;
        
        try {
            insertSystemAction(this.db, {
                sessionId: this.sessionId,
                actionType,
                timestamp: Date.now(),
                data: JSON.stringify(data)
            });
        } catch (error) {
            LOGGER.error('Failed to record system action', { actionType, error });
        }
    }
    
    // ==================== CDP Interceptor Subprocess ====================
    // The CDP proxy sits between socat and the browser:
    // External (19222) -> socat -> Proxy (9222) -> Browser (9223)
    
    public startCDPInterceptor(listenPort: number = 9222, targetPort: number = 9223): void {
        if (!this.sessionId || !this.dbPath) {
            LOGGER.error('Cannot start CDP interceptor without session');
            return;
        }
        
        if (this.cdpInterceptorProcess) {
            LOGGER.warn('CDP interceptor already running');
            return;
        }
        
        try {
            const cdpInterceptorPath = path.join('/home/user/app', 'cdp-interceptor', 'build', 'main.js');
            
            this.cdpInterceptorProcess = spawn('node', [
                cdpInterceptorPath,
                '--listen', listenPort.toString(),
                '--target', targetPort.toString(),
                '--db', this.dbPath,
                '--session', this.sessionId
            ], {
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            this.cdpInterceptorProcess.stdout?.on('data', (data: Buffer) => {
                LOGGER.info(`CDP Interceptor: ${data.toString().trim()}`);
            });
            
            this.cdpInterceptorProcess.stderr?.on('data', (data: Buffer) => {
                LOGGER.error(`CDP Interceptor Error: ${data.toString().trim()}`);
            });
            
            this.cdpInterceptorProcess.on('exit', (code) => {
                LOGGER.info('CDP interceptor exited', { code });
                this.cdpInterceptorProcess = null;
            });
            
            LOGGER.info('CDP interceptor started', { 
                sessionId: this.sessionId,
                listenPort,
                targetPort,
                pid: this.cdpInterceptorProcess.pid 
            });
        } catch (error) {
            LOGGER.error('Failed to start CDP interceptor', { error });
        }
    }
    
    public stopCDPInterceptor(): void {
        if (this.cdpInterceptorProcess) {
            try {
                this.cdpInterceptorProcess.kill('SIGTERM');
                this.cdpInterceptorProcess = null;
                LOGGER.info('CDP interceptor stopped');
            } catch (error) {
                LOGGER.error('Failed to stop CDP interceptor', { error });
            }
        }
    }
    
    // ==================== Data Export ====================
    
    public getRecordedData(): SessionData | null {
        if (!this.db || !this.sessionId) return null;
        return exportSessionData(this.db, this.sessionId);
    }
    
    public clearSessionData(sessionId?: string): void {
        if (!this.db) return;
        
        const targetSession = sessionId || this.sessionId;
        if (!targetSession) return;
        
        deleteSessionData(this.db, targetSession);
        LOGGER.info('Session data cleared', { sessionId: targetSession });
    }
    
    // ==================== Cleanup ====================
    
    public cleanup(): void {
        this.stopCDPInterceptor();
        
        this.isRecording = false;
        this.sessionId = null;
        
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    
    // ==================== Helpers ====================
    
    private shouldRecord(): boolean {
        return this.isRecording && this.sessionId !== null && this.db !== null;
    }
}

// Export singleton instance
export const dataCollector = DataCollector.getInstance();
