import "server-only";

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cookies } from "next/headers";

const DATA_DIRECTORY = path.resolve(process.env.READER_DATA_DIR?.trim() || path.join(process.cwd(), "data"));
const FILE_DIRECTORY = path.join(DATA_DIRECTORY, "files");
const DATABASE_PATH = path.join(DATA_DIRECTORY, "reader.sqlite");
const SESSION_COOKIE = "reader_session";
const SESSION_DURATION_MS = Number.parseInt(process.env.READER_SESSION_DURATION_MS || "2592000000", 10);

export type LocalUser = { id: string; email: string; active: number };
export type LocalSession = { user: LocalUser; csrfToken: string };
export type LocalBookRow = {
    id: string;
    owner_id: string;
    title: string;
    author: string;
    format: "pdf" | "epub";
    storage_path: string;
    cover_storage_path: string | null;
    file_size: number;
    mime_type: string;
    cover_size: number | null;
    cover_mime_type: string | null;
    tags_json: string;
    notes: string;
    created_at: number;
    updated_at: number;
};

type SessionRow = LocalUser & { csrf_token: string };

declare global {
    // Keep one connection per Next.js server process during development reloads.
    // eslint-disable-next-line no-var
    var __readerLocalDatabase: Database.Database | undefined;
}

const initialise = (database: Database.Database) => {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            csrf_token TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            format TEXT NOT NULL CHECK (format IN ('pdf', 'epub')),
            storage_path TEXT NOT NULL UNIQUE,
            cover_storage_path TEXT UNIQUE,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            cover_size INTEGER,
            cover_mime_type TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            notes TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS books_owner_created_idx ON books(owner_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS progress (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            location_json TEXT NOT NULL,
            percentage REAL,
            last_read INTEGER NOT NULL,
            PRIMARY KEY (user_id, book_id)
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            data_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bookmarks_user_book_idx ON bookmarks(user_id, book_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS highlights (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            data_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS highlights_user_book_idx ON highlights(user_id, book_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS reader_settings (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('epub', 'pdf')),
            data_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, kind)
        );
    `);
};

export const getLocalDb = () => {
    if (!global.__readerLocalDatabase) {
        if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
            throw new Error("SESSION_SECRET must be at least 32 characters in production.");
        }
        // The directory is created synchronously only once while the server starts.
        mkdirSync(DATA_DIRECTORY, { recursive: true });
        mkdirSync(FILE_DIRECTORY, { recursive: true });
        const database = new Database(DATABASE_PATH);
        initialise(database);
        global.__readerLocalDatabase = database;
    }
    return global.__readerLocalDatabase;
};

export const getLocalDataDirectory = () => DATA_DIRECTORY;
export const getLocalDatabasePath = () => DATABASE_PATH;
export const getSessionCookieName = () => SESSION_COOKIE;

export const normaliseEmail = (value: string) => value.trim().toLowerCase();
export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const sessionSecret = process.env.SESSION_SECRET?.trim() || "development-only-session-secret";
const sha256 = (value: string) => createHash("sha256").update(sessionSecret).update("\0").update(value).digest("hex");
const constantTimeMatch = (left: string, right: string) => {
    const leftBytes = Buffer.from(left, "utf8");
    const rightBytes = Buffer.from(right, "utf8");
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

export const hashPassword = (password: string) => {
    if (password.length < 12) throw new Error("Passwords must contain at least 12 characters.");
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
};

export const verifyPassword = (password: string, stored: string) => {
    const [scheme, salt, expected] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const actual = scryptSync(password, salt, 64).toString("hex");
    return constantTimeMatch(actual, expected);
};

export const createUser = (emailInput: string, password: string) => {
    const email = normaliseEmail(emailInput);
    if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
    const now = Date.now();
    const user: LocalUser = { id: randomUUID(), email, active: 1 };
    getLocalDb().prepare(
        "INSERT INTO users (id, email, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(user.id, user.email, hashPassword(password), user.active, now, now);
    return user;
};

export const findUserByEmail = (emailInput: string) => getLocalDb().prepare(
    "SELECT id, email, password_hash, active FROM users WHERE email = ?"
).get(normaliseEmail(emailInput)) as (LocalUser & { password_hash: string }) | undefined;

export const setUserActive = (emailInput: string, active: boolean) => {
    const result = getLocalDb().prepare("UPDATE users SET active = ?, updated_at = ? WHERE email = ?")
        .run(active ? 1 : 0, Date.now(), normaliseEmail(emailInput));
    if (result.changes !== 1) throw new Error("User not found.");
    if (!active) getLocalDb().prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(normaliseEmail(emailInput));
};

export const resetUserPassword = (emailInput: string, password: string) => {
    const result = getLocalDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?")
        .run(hashPassword(password), Date.now(), normaliseEmail(emailInput));
    if (result.changes !== 1) throw new Error("User not found.");
    getLocalDb().prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(normaliseEmail(emailInput));
};

export const createSession = (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const now = Date.now();
    const duration = Number.isFinite(SESSION_DURATION_MS) && SESSION_DURATION_MS > 0 ? SESSION_DURATION_MS : 2592000000;
    getLocalDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    getLocalDb().prepare(
        "INSERT INTO sessions (token_hash, csrf_token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(sha256(token), csrfToken, userId, now, now + duration);
    return { token, csrfToken, expiresAt: now + duration };
};

export const removeSession = (token: string | undefined) => {
    if (token) getLocalDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
};

const sessionForToken = (token: string | undefined): SessionRow | undefined => {
    if (!token) return undefined;
    return getLocalDb().prepare(`
        SELECT users.id, users.email, users.active, sessions.csrf_token
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
    `).get(sha256(token), Date.now()) as SessionRow | undefined;
};

export const getCurrentSession = async (): Promise<LocalSession | null> => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = sessionForToken(token);
    if (!session) return null;
    return { user: { id: session.id, email: session.email, active: session.active }, csrfToken: session.csrf_token };
};

export const getSessionForToken = (token: string | undefined): LocalSession | null => {
    const session = sessionForToken(token);
    if (!session) return null;
    return { user: { id: session.id, email: session.email, active: session.active }, csrfToken: session.csrf_token };
};

export const assertCsrf = (token: string | undefined, csrfToken: string | null) => {
    const session = sessionForToken(token);
    if (!session) return null;
    if (!csrfToken) return null;
    const supplied = Buffer.from(csrfToken);
    const expected = Buffer.from(session.csrf_token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return { user: { id: session.id, email: session.email, active: session.active }, csrfToken: session.csrf_token };
};

export const sessionCookieOptions = (expiresAt?: number) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    ...(expiresAt ? { expires: new Date(expiresAt) } : { maxAge: 0 }),
});

export const parseTags = (value: unknown) => {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
        .map((item) => item.trim()).filter(Boolean).slice(0, 30).map((item) => item.slice(0, 80));
    if (typeof value !== "string") return [];
    try {
        return parseTags(JSON.parse(value));
    } catch {
        return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30).map((item) => item.slice(0, 80));
    }
};

export const boundedString = (value: unknown, label: string, maxLength: number, required = false) => {
    if (typeof value !== "string") {
        if (required) throw new Error(`${label} is required.`);
        return "";
    }
    const result = value.trim();
    if (required && !result) throw new Error(`${label} is required.`);
    if (result.length > maxLength) throw new Error(`${label} is too long.`);
    return result;
};

export const ownedBook = (userId: string, bookId: string) => getLocalDb().prepare(
    "SELECT * FROM books WHERE id = ? AND owner_id = ?"
).get(bookId, userId) as LocalBookRow | undefined;

const extensionFor = (format: "pdf" | "epub", contentType: string) => {
    if (format === "pdf") return "pdf";
    if (contentType === "application/epub+zip") return "epub";
    return "epub";
};

export const writeUploadedFile = async (kind: "books" | "covers", userId: string, file: Blob, extension: string) => {
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10) || "bin";
    const storagePath = `${kind}/${userId}/${randomUUID()}.${safeExtension}`;
    const outputPath = getStorageFilePath(storagePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${randomUUID()}.upload`;
    await writeFile(temporaryPath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    await rename(temporaryPath, outputPath);
    return storagePath;
};

export const getStorageFilePath = (storagePath: string) => {
    if (!/^(books|covers)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(storagePath)) {
        throw new Error("Invalid local storage path.");
    }
    const outputPath = path.resolve(FILE_DIRECTORY, storagePath);
    if (!outputPath.startsWith(`${FILE_DIRECTORY}${path.sep}`)) throw new Error("Invalid local storage path.");
    return outputPath;
};

export const removeStorageFile = async (storagePath: string | null | undefined) => {
    if (!storagePath) return;
    await rm(getStorageFilePath(storagePath), { force: true });
};

export const storageStream = (storagePath: string, range?: { start: number; end: number }) => createReadStream(
    getStorageFilePath(storagePath), range ? { start: range.start, end: range.end } : undefined
);

export const publicBook = (book: LocalBookRow) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    storagePath: book.storage_path,
    coverStoragePath: book.cover_storage_path || undefined,
    url: `/api/v1/books/${encodeURIComponent(book.id)}/file`,
    coverUrl: book.cover_storage_path ? `/api/v1/books/${encodeURIComponent(book.id)}/cover` : undefined,
    fileSize: book.file_size,
    mimeType: book.mime_type,
    coverSize: book.cover_size || undefined,
    coverMimeType: book.cover_mime_type || undefined,
    uploadedBy: book.owner_id,
    createdAt: book.created_at,
    tags: JSON.parse(book.tags_json) as string[],
    notes: book.notes,
});

export const verifyBookFile = async (format: "pdf" | "epub", file: Blob) => {
    const header = Buffer.from(await file.slice(0, 8).arrayBuffer());
    const isPdf = header.subarray(0, 5).toString("ascii") === "%PDF-";
    const isZip = header.subarray(0, 2).toString("ascii") === "PK";
    if ((format === "pdf" && !isPdf) || (format === "epub" && !isZip)) {
        throw new Error(`The uploaded file is not a valid ${format.toUpperCase()} file.`);
    }
};

export const contentTypeForBook = (format: "pdf" | "epub") => format === "pdf" ? "application/pdf" : "application/epub+zip";
export const fileExtensionForBook = extensionFor;
