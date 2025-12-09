import BetterSqlite3 from 'better-sqlite3';

// ==================== Types ====================

export type ActionType = 'keyboard' | 'mouse' | 'scroll' | 'drag';

export interface SystemAction {
    id?: number;
    sessionId: string;
    actionType: ActionType;
    timestamp: number;
    data: string; // JSON stringified action data
}

export interface NetworkRequest {
    id?: number;
    sessionId: string;
    timestamp: number;
    requestId: string;
    url: string;
    method: string;
    requestHeaders: string; // JSON stringified
    requestBody: string | null;
    responseStatus: number | null;
    responseHeaders: string | null; // JSON stringified
    responseBody: string | null;
    resourceType: string;
    timing: string | null; // JSON stringified timing data
    cookiesSent: string | null; // JSON array of {name, domain} sent with request
    cookiesSet: string | null; // JSON array of {name, domain, action} set by response
}

// Cookie reference for tracking (lightweight - just identifiers)
export interface CookieRef {
    name: string;
    domain: string;
    action?: 'created' | 'updated' | 'deleted'; // For Set-Cookie tracking
}

export interface CDPEvent {
    id?: number;
    sessionId: string;
    timestamp: number;
    method: string;
    params: string; // JSON stringified
    direction: 'sent' | 'received';
}

export interface SessionSummary {
    sessionId: string;
    startTime: number;
    endTime: number | null;
    totalActions: number;
    totalNetworkRequests: number;
    totalCDPEvents: number;
}

// ==================== Database Initialization ====================

export function initDataCollectionTables(db: BetterSqlite3.Database): void {
    // System Actions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS system_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId TEXT NOT NULL,
            actionType TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_system_actions_session ON system_actions(sessionId);
        CREATE INDEX IF NOT EXISTS idx_system_actions_timestamp ON system_actions(timestamp);
    `);

    // Network Requests table
    db.exec(`
        CREATE TABLE IF NOT EXISTS network_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            requestId TEXT NOT NULL,
            url TEXT NOT NULL,
            method TEXT NOT NULL,
            requestHeaders TEXT,
            requestBody TEXT,
            responseStatus INTEGER,
            responseHeaders TEXT,
            responseBody TEXT,
            resourceType TEXT,
            timing TEXT,
            cookiesSent TEXT,
            cookiesSet TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_network_requests_session ON network_requests(sessionId);
        CREATE INDEX IF NOT EXISTS idx_network_requests_timestamp ON network_requests(timestamp);
    `);

    // CDP Events table
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

    // Session Summary table
    db.exec(`
        CREATE TABLE IF NOT EXISTS session_summary (
            sessionId TEXT PRIMARY KEY,
            startTime INTEGER NOT NULL,
            endTime INTEGER,
            totalActions INTEGER DEFAULT 0,
            totalNetworkRequests INTEGER DEFAULT 0,
            totalCDPEvents INTEGER DEFAULT 0
        );
    `);
}

// ==================== System Actions ====================

export function insertSystemAction(
    db: BetterSqlite3.Database,
    action: SystemAction
): number {
    const stmt = db.prepare(`
        INSERT INTO system_actions (sessionId, actionType, timestamp, data)
        VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(action.sessionId, action.actionType, action.timestamp, action.data);
    
    // Update session summary
    updateSessionActionCount(db, action.sessionId);
    
    return result.lastInsertRowid as number;
}

export function getSystemActions(
    db: BetterSqlite3.Database,
    sessionId: string,
    startTime?: number,
    endTime?: number
): SystemAction[] {
    let query = 'SELECT * FROM system_actions WHERE sessionId = ?';
    const params: (string | number)[] = [sessionId];
    
    if (startTime !== undefined) {
        query += ' AND timestamp >= ?';
        params.push(startTime);
    }
    if (endTime !== undefined) {
        query += ' AND timestamp <= ?';
        params.push(endTime);
    }
    query += ' ORDER BY timestamp ASC';
    
    const stmt = db.prepare(query);
    return stmt.all(...params) as SystemAction[];
}

// ==================== Network Requests ====================

export function insertNetworkRequest(
    db: BetterSqlite3.Database,
    request: NetworkRequest
): number {
    const stmt = db.prepare(`
        INSERT INTO network_requests (
            sessionId, timestamp, requestId, url, method,
            requestHeaders, requestBody, responseStatus, responseHeaders,
            responseBody, resourceType, timing, cookiesSent, cookiesSet
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        request.sessionId,
        request.timestamp,
        request.requestId,
        request.url,
        request.method,
        request.requestHeaders,
        request.requestBody,
        request.responseStatus,
        request.responseHeaders,
        request.responseBody,
        request.resourceType,
        request.timing,
        request.cookiesSent,
        request.cookiesSet
    );
    
    // Update session summary
    updateSessionNetworkCount(db, request.sessionId);
    
    return result.lastInsertRowid as number;
}

export function updateNetworkResponse(
    db: BetterSqlite3.Database,
    sessionId: string,
    requestId: string,
    responseStatus: number,
    responseHeaders: string,
    responseBody: string | null,
    timing: string | null,
    cookiesSet: string | null = null
): void {
    const stmt = db.prepare(`
        UPDATE network_requests
        SET responseStatus = ?, responseHeaders = ?, responseBody = ?, timing = ?, cookiesSet = ?
        WHERE sessionId = ? AND requestId = ?
    `);
    stmt.run(responseStatus, responseHeaders, responseBody, timing, cookiesSet, sessionId, requestId);
}

// ==================== Cookie Parsing Helpers ====================

/**
 * Parse cookies from the Cookie request header
 * Returns array of {name, domain} for each cookie sent
 */
export function parseCookieHeader(cookieHeader: string | undefined, requestUrl: string): CookieRef[] {
    if (!cookieHeader) return [];
    
    try {
        const url = new URL(requestUrl);
        const domain = url.hostname;
        
        return cookieHeader.split(';').map(cookie => {
            const [name] = cookie.trim().split('=');
            return { name: name.trim(), domain };
        }).filter(c => c.name);
    } catch {
        return [];
    }
}

/**
 * Parse Set-Cookie headers from response
 * Returns array of {name, domain, action} for each cookie set
 */
export function parseSetCookieHeaders(headers: Record<string, string>, requestUrl: string): CookieRef[] {
    const cookies: CookieRef[] = [];
    
    try {
        const url = new URL(requestUrl);
        const defaultDomain = url.hostname;
        
        // Set-Cookie can be a single value or array (combined with comma in some cases)
        const setCookieValue = headers['set-cookie'] || headers['Set-Cookie'];
        if (!setCookieValue) return [];
        
        // Handle multiple Set-Cookie headers (may be comma-separated)
        const cookieStrings = setCookieValue.split(/,(?=\s*[^;,]+=[^;,]+)/);
        
        for (const cookieStr of cookieStrings) {
            const parts = cookieStr.trim().split(';');
            if (parts.length === 0) continue;
            
            // First part is name=value
            const [nameValue] = parts;
            const eqIndex = nameValue.indexOf('=');
            if (eqIndex === -1) continue;
            
            const name = nameValue.substring(0, eqIndex).trim();
            const value = nameValue.substring(eqIndex + 1).trim();
            
            // Check for domain in attributes
            let domain = defaultDomain;
            let action: 'created' | 'updated' | 'deleted' = 'created'; // Default assume created/updated
            
            for (const part of parts.slice(1)) {
                const [attr, attrValue] = part.split('=').map(s => s.trim().toLowerCase());
                if (attr === 'domain' && attrValue) {
                    domain = attrValue.replace(/^\./, ''); // Remove leading dot
                }
                // Check for deletion (max-age=0 or expires in past)
                if (attr === 'max-age' && attrValue === '0') {
                    action = 'deleted';
                }
            }
            
            // Empty value often means deletion
            if (!value || value === '""' || value === "''") {
                action = 'deleted';
            }
            
            cookies.push({ name, domain, action });
        }
    } catch {
        // Silently ignore parsing errors
    }
    
    return cookies;
}

export function getNetworkRequests(
    db: BetterSqlite3.Database,
    sessionId: string
): NetworkRequest[] {
    const stmt = db.prepare(`
        SELECT * FROM network_requests WHERE sessionId = ? ORDER BY timestamp ASC
    `);
    return stmt.all(sessionId) as NetworkRequest[];
}

// ==================== CDP Events ====================

export function insertCDPEvent(
    db: BetterSqlite3.Database,
    event: CDPEvent
): number {
    const stmt = db.prepare(`
        INSERT INTO cdp_events (sessionId, timestamp, method, params, direction)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        event.sessionId,
        event.timestamp,
        event.method,
        event.params,
        event.direction
    );
    
    // Update session summary
    updateSessionCDPCount(db, event.sessionId);
    
    return result.lastInsertRowid as number;
}

export function getCDPEvents(
    db: BetterSqlite3.Database,
    sessionId: string
): CDPEvent[] {
    const stmt = db.prepare(`
        SELECT * FROM cdp_events WHERE sessionId = ? ORDER BY timestamp ASC
    `);
    return stmt.all(sessionId) as CDPEvent[];
}

// ==================== Session Summary ====================

export function createSession(
    db: BetterSqlite3.Database,
    sessionId: string
): void {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO session_summary (sessionId, startTime)
        VALUES (?, ?)
    `);
    stmt.run(sessionId, Date.now());
}

export function endSession(
    db: BetterSqlite3.Database,
    sessionId: string
): void {
    const stmt = db.prepare(`
        UPDATE session_summary SET endTime = ? WHERE sessionId = ?
    `);
    stmt.run(Date.now(), sessionId);
}

export function getSessionSummary(
    db: BetterSqlite3.Database,
    sessionId: string
): SessionSummary | null {
    const stmt = db.prepare(`
        SELECT * FROM session_summary WHERE sessionId = ?
    `);
    return stmt.get(sessionId) as SessionSummary | null;
}

function updateSessionActionCount(db: BetterSqlite3.Database, sessionId: string): void {
    const stmt = db.prepare(`
        UPDATE session_summary SET totalActions = totalActions + 1 WHERE sessionId = ?
    `);
    stmt.run(sessionId);
}

function updateSessionNetworkCount(db: BetterSqlite3.Database, sessionId: string): void {
    const stmt = db.prepare(`
        UPDATE session_summary SET totalNetworkRequests = totalNetworkRequests + 1 WHERE sessionId = ?
    `);
    stmt.run(sessionId);
}

function updateSessionCDPCount(db: BetterSqlite3.Database, sessionId: string): void {
    const stmt = db.prepare(`
        UPDATE session_summary SET totalCDPEvents = totalCDPEvents + 1 WHERE sessionId = ?
    `);
    stmt.run(sessionId);
}

// ==================== Export All Data ====================

export interface SessionData {
    summary: SessionSummary | null;
    systemActions: SystemAction[];
    networkRequests: NetworkRequest[];
    cdpEvents: CDPEvent[];
}

export function exportSessionData(
    db: BetterSqlite3.Database,
    sessionId: string
): SessionData {
    const summary = getSessionSummary(db, sessionId);
    const systemActions = getSystemActions(db, sessionId);
    const networkRequests = getNetworkRequests(db, sessionId);
    const cdpEvents = getCDPEvents(db, sessionId);
    
    return {
        summary,
        systemActions,
        networkRequests,
        cdpEvents
    };
}

// ==================== Cleanup ====================

export function deleteSessionData(
    db: BetterSqlite3.Database,
    sessionId: string
): void {
    const tables = ['system_actions', 'network_requests', 'cdp_events', 'session_summary'];
    for (const table of tables) {
        const stmt = db.prepare(`DELETE FROM ${table} WHERE sessionId = ?`);
        stmt.run(sessionId);
    }
}

