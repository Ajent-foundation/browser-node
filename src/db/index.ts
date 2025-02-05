import BetterSqlite3 from 'better-sqlite3';

export function init() : BetterSqlite3.Database {
    const db = new BetterSqlite3('/home/user/db.sqlite3');
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fileID TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            path TEXT NOT NULL
        );
    `);

    return db;
}