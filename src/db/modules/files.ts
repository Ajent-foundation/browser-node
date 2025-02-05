import BetterSqlite3 from 'better-sqlite3';

export interface UploadedFile {
    id?: number
    fileID: string
    name: string
    path: string
}

export async function listALLFiles(
    db: BetterSqlite3.Database
): Promise<UploadedFile[]> {
    const stmt = db.prepare(`
        SELECT * FROM files
    `);

    // Get all the uploaded files
    const uploadedFiles = stmt.all();
    return uploadedFiles as UploadedFile[];
}

export async function getFileByID(
    db: BetterSqlite3.Database, 
    fileID: string
): Promise<UploadedFile | null> {
    const stmt = db.prepare(`
        SELECT * FROM files WHERE fileID = ?
    `);

    // Get the uploaded file by its ID
    const uploadedFile = stmt.get(fileID);
    if(!uploadedFile) {
        return null;
    } else {
        return uploadedFile as UploadedFile;
    }
}

export async function insertFile(
    db: BetterSqlite3.Database, 
    file: UploadedFile
): Promise<null> {
    const stmt = db.prepare(`
        INSERT INTO files (fileID, name, path) VALUES (?, ?, ?)
    `);

    // Insert the file into the database
    stmt.run(file.fileID, file.name, file.path);
    return null;
}